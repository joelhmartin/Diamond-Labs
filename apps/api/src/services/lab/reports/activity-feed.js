/**
 * Pulse's live activity feed (spec "Dashboards (lab glue)"): the latest status
 * moves, holds, shipments and, for admins only, payments recorded, newest
 * first. The feed tile polls it every 30 s (the dashboard's one-tile refresh).
 *
 * No PHI and no free text: a line is built only from the order number, the
 * client's name, the shared status labels, the carrier and the amount. No query
 * selects a note column (lab_order_events.note, invoice_payments.note), a hold
 * reason or a payment reference.
 *
 * - status / hold: lab_order_events of type status or hold. A move to Shipped
 *   is left out when the order has a shipment: its shipment line (which names
 *   the carrier) is that order's one shipped line. An order shipped with no
 *   shipment record (imported history) keeps its status line.
 * - shipment: each order on a shipment (label bought or hand-off recorded; voided
 *   labels are left out), at the shipment's purchased_at.
 * - payment: invoice_payments rows with applied_cents > 0 (charges, not refunds
 *   or reversals), at created_at.
 */
import { sql } from "drizzle-orm";
import { CARRIER_LABELS, LAB_STATUS_LABELS, LAB_TIMEZONE, formatCell } from "@my-app/shared";
import { labOrders, labOrderEvents, shipments, invoicePayments, invoices } from "../../../db/schema/index.js";
import { clientName, num, rowsOf } from "./lab-metrics.js";
import { optionalClientJoin } from "./report-helpers.js";

export const FEED_LIMIT = 50;
/** How far back the feed looks. */
export const FEED_DAYS = 7;
const DAY_MS = 86400000;

const after = (col, since) => sql`${col} >= ${since.toISOString()}::timestamptz`;

const statusLabel = (s) => LAB_STATUS_LABELS[s] ?? s;
/** "Order #1041 · Acme Dental" (parts that are missing are left out). */
const subject = (r) => [r.orderNumber != null ? `Order #${r.orderNumber}` : null, r.client || null].filter(Boolean).join(" · ");
const orderHref = (r) => (r.labOrderId ? `/lab/orders/${encodeURIComponent(r.labOrderId)}` : null);
const iso = (v) => new Date(v).toISOString();

async function orderEvents(db, since, limit) {
  const raw = await rowsOf(db, sql`
    select ${labOrderEvents.id} as "id", ${labOrderEvents.type} as "kind", ${labOrderEvents.from} as "fromStatus", ${labOrderEvents.to} as "toStatus",
      ${labOrderEvents.at} as "at", ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber", ${clientName} as "client"
    from ${labOrderEvents}
    join ${labOrders} on ${labOrders.id} = ${labOrderEvents.labOrderId}
    ${optionalClientJoin(labOrders.clientUserId)}
    where ${labOrderEvents.type} in ('status', 'hold') and ${after(labOrderEvents.at, since)}
      and not (${labOrderEvents.to} = 'shipped' and ${labOrders.shipmentId} is not null)
    order by ${labOrderEvents.at} desc, ${labOrderEvents.id} desc limit ${limit}`);
  return raw.map((r) => {
    const hold = r.kind === "hold";
    const move = hold ? "put on hold" : [r.fromStatus ? statusLabel(r.fromStatus) : null, statusLabel(r.toStatus)].filter(Boolean).join(" → ");
    return { at: iso(r.at), kind: hold ? "hold" : "status", text: `${subject(r)}: ${move}`, href: orderHref(r) };
  });
}

async function shipmentEvents(db, since, limit) {
  const raw = await rowsOf(db, sql`
    select ${shipments.id} as "id", ${shipments.carrier} as "carrier", ${shipments.purchasedAt} as "at",
      ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber", ${clientName} as "client"
    from ${shipments}
    join ${labOrders} on ${labOrders.shipmentId} = ${shipments.id}
    ${optionalClientJoin(labOrders.clientUserId)}
    where ${shipments.status} <> 'voided' and ${after(shipments.purchasedAt, since)}
    order by ${shipments.purchasedAt} desc, ${labOrders.id} desc limit ${limit}`);
  return raw.map((r) => ({
    at: iso(r.at), kind: "shipment", text: `${subject(r)}: ${CARRIER_LABELS[r.carrier] ?? r.carrier} shipment`, href: orderHref(r),
  }));
}

async function paymentEvents(db, since, limit) {
  const raw = await rowsOf(db, sql`
    select ${invoicePayments.id} as "id", ${invoicePayments.appliedCents} as "cents", ${invoicePayments.createdAt} as "at",
      ${invoicePayments.invoiceId} as "invoiceId", ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber", ${clientName} as "client"
    from ${invoicePayments}
    left join ${invoices} on ${invoices.id} = ${invoicePayments.invoiceId}
    left join ${labOrders} on ${labOrders.id} = ${invoices.labOrderId}
    ${optionalClientJoin(invoices.clientUserId)}
    where ${invoicePayments.appliedCents} > 0 and ${after(invoicePayments.createdAt, since)}
    order by ${invoicePayments.createdAt} desc, ${invoicePayments.id} desc limit ${limit}`);
  return raw.map((r) => ({
    at: iso(r.at), kind: "payment",
    text: [`Payment ${formatCell({ type: "money" }, num(r.cents))}`, subject(r)].filter(Boolean).join(" · "),
    href: r.invoiceId ? `/admin/invoices/${encodeURIComponent(r.invoiceId)}` : null,
  }));
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Newest first; equal times by kind, then text, then href, so the order never depends on query order. */
const newestFirst = (a, b) => cmp(b.at, a.at) || cmp(a.kind, b.kind) || cmp(a.text, b.text) || cmp(a.href ?? "", b.href ?? "");

/**
 * `[{ at, kind: "status" | "hold" | "shipment" | "payment", text, href }]`,
 * newest first, at most `limit`, from `since` (a Date). Payments only when
 * `includeMoney`.
 */
export async function activityFeed(db, { since, limit = FEED_LIMIT, includeMoney = false }) {
  const parts = [await orderEvents(db, since, limit), await shipmentEvents(db, since, limit)];
  if (includeMoney) parts.push(await paymentEvents(db, since, limit));
  return parts.flat().sort(newestFirst).slice(0, limit);
}

/**
 * The feed as a report (the Pulse feed tile's source). Staff; payments only for
 * admins. It depends on the actor's role only, so the per-role tile cache is safe.
 */
export const activityFeedReport = {
  key: "ops.activity-feed", group: "operations", unlisted: true, title: "Live activity",
  description: `Status moves, holds, shipments and (admins) payments recorded in the last ${FEED_DAYS} days, newest first.`,
  params: [],
  columns: [{ id: "at", label: "When", type: "datetime", timeZone: LAB_TIMEZONE }, { id: "text", label: "What", type: "text" }],
  async run(tx, _params, actor, ctx) {
    const now = ctx?.now ?? new Date();
    const since = new Date(now.getTime() - FEED_DAYS * DAY_MS);
    return { rows: await activityFeed(tx, { since, limit: FEED_LIMIT, includeMoney: actor?.role === "admin" }) };
  },
};
