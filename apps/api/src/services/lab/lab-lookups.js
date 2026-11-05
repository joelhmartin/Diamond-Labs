import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { LAB_STATUS_LABELS, isTerminalLabStatus } from "@my-app/shared";
import { db } from "../../config/database.js";
import { labOrders, rxCases, users, invoices } from "../../db/schema/index.js";
import { createLookupRegistry } from "../../modules/barcode-lookup/index.js";

/** The lab's scan-box registry. Imported once from routes/lab-desk.routes.js. */
export const labLookups = createLookupRegistry({ log: console });

const client = alias(users, "client");
const PAN_SHIPPED_WINDOW_DAYS = 14;
const PAN_MAX_HITS = 10;
const DIGITS = /^#?(\d{1,9})$/;
const PAN = /^[A-Za-z0-9-]{1,30}$/;

/** Order number, practice and status only: never a patient. */
export function orderHit(row) {
  return {
    recordType: "lab_order",
    recordId: row.id,
    title: `#${row.orderNumber}`,
    subtitle: [row.practice, LAB_STATUS_LABELS[row.status] ?? row.status].filter(Boolean).join(" · "),
    href: `/lab/orders/${row.id}`,
  };
}

/**
 * Pan scan ranking: open orders first, then orders shipped in the last 14
 * days; older shipped and cancelled orders drop out. Newest order first
 * within each group; at most 10.
 */
export function rankPanHits(rows, now = new Date()) {
  const cutoff = now.getTime() - PAN_SHIPPED_WINDOW_DAYS * 86_400_000;
  const open = [];
  const shipped = [];
  for (const r of rows) {
    if (!isTerminalLabStatus(r.status)) open.push(r);
    else if (r.status === "shipped" && r.shippedAt && new Date(r.shippedAt).getTime() >= cutoff) shipped.push(r);
  }
  const newestFirst = (a, b) => b.orderNumber - a.orderNumber;
  return [...open.sort(newestFirst), ...shipped.sort(newestFirst)].slice(0, PAN_MAX_HITS);
}

function selectOrders(database, where) {
  return database
    .select({
      id: labOrders.id,
      orderNumber: labOrders.orderNumber,
      status: labOrders.status,
      shippedAt: labOrders.shippedAt,
      practice: sql`coalesce(${rxCases.practiceName}, ${client.name})`,
    })
    .from(labOrders)
    .leftJoin(rxCases, and(eq(labOrders.source, "rx_case"), eq(rxCases.id, labOrders.sourceId)))
    .leftJoin(client, eq(client.id, labOrders.clientUserId))
    .where(where);
}

labLookups.defineResolver({
  key: "order",
  match: (code) => DIGITS.exec(code)?.[1] ?? null,
  resolve: async (digits, database = db) =>
    (await selectOrders(database, eq(labOrders.orderNumber, Number(digits)))).map(orderHit),
});

labLookups.defineResolver({
  key: "invoice",
  match: (code) => DIGITS.exec(code)?.[1] ?? null,
  resolve: async (digits, database = db) => {
    const found = await database
      .select({ labOrderId: invoices.labOrderId })
      .from(invoices)
      .where(eq(invoices.invoiceNumber, Number(digits)));
    const ids = found.map((r) => r.labOrderId).filter(Boolean);
    if (!ids.length) return [];
    return (await selectOrders(database, inArray(labOrders.id, ids))).map(orderHit);
  },
});

labLookups.defineResolver({
  key: "pan",
  match: (code) => (PAN.test(code) ? code.toLowerCase() : null),
  resolve: async (pan, database = db) => {
    const rows = await selectOrders(database, sql`lower(${labOrders.panNumber}) = ${pan}`);
    return rankPanHits(rows).map(orderHit);
  },
});
