import { and, lte, ne, sql } from "drizzle-orm";
import { invoices, labOrders } from "../db/schema/index.js";
import { recordNumber, INVOICE_NUMBER_FIELDS, ORDER_NUMBER_FIELDS } from "./seazona-records.js";
import { ImportRefusal } from "./import-errors.js";

/**
 * Number seeds (spec "Number seeds"): imported history keeps Seazona's
 * numbers; new invoices and lab orders continue from INVOICE_NUMBER_START /
 * LAB_ORDER_NUMBER_START (allocation is max(existing + 1, start)). A production
 * load is refused unless both starts are above Seazona's highest numbers, and
 * any load is refused when a number this system already issued sits in
 * Seazona's range. `starts` are the values set on Cloud Run, passed as flags.
 */
const highest = (summaries, fields) =>
  summaries.reduce((m, s) => {
    const n = recordNumber(s.payload, fields);
    return n != null && (m == null || n > m) ? n : m;
  }, null);

export function seazonaMaxNumbers({ invoiceSummaries, orderSummaries }) {
  return { invoice: highest(invoiceSummaries, INVOICE_NUMBER_FIELDS), order: highest(orderSummaries, ORDER_NUMBER_FIELDS) };
}

const ENV_NAME = { invoice: "INVOICE_NUMBER_START", order: "LAB_ORDER_NUMBER_START" };

export function checkSeeds({ target, max, starts = {}, liveAtOrBelow }) {
  const errors = [];
  const warnings = [];
  for (const kind of ["invoice", "order"]) {
    const top = max[kind];
    if (top == null) continue;
    const start = starts[kind];
    if (target === "production" && !Number.isSafeInteger(start)) {
      errors.push(`--${kind}-start is required for a production load (the ${ENV_NAME[kind]} set on Cloud Run; at least ${top + 1}).`);
    } else if (Number.isSafeInteger(start) && start <= top) {
      (target === "production" ? errors : warnings).push(`${ENV_NAME[kind]} (${start}) must be above Seazona's highest ${kind} number (${top}): set it to ${top + 1}.`);
    }
    if (liveAtOrBelow[kind] > 0) {
      errors.push(`${liveAtOrBelow[kind]} ${kind}(s) created in this system already hold a number at or below Seazona's highest (${top}). Stop: they collide with imported history.`);
    }
  }
  return { errors, warnings };
}

export async function liveNumbersAtOrBelow(db, max) {
  const [inv] = await db.select({ n: sql`count(*)` }).from(invoices)
    .where(and(ne(invoices.kind, "legacy"), lte(invoices.invoiceNumber, max.invoice ?? 0)));
  const [ord] = await db.select({ n: sql`count(*)` }).from(labOrders)
    .where(and(ne(labOrders.source, "legacy"), lte(labOrders.orderNumber, max.order ?? 0)));
  return { invoice: Number(inv?.n ?? 0), order: Number(ord?.n ?? 0) };
}

export async function enforceSeeds({ raw, db, target, live, starts = {}, invoiceSummaries, orderSummaries }) {
  const max = seazonaMaxNumbers({
    invoiceSummaries: invoiceSummaries ?? (await raw.records("invoice")),
    orderSummaries: orderSummaries ?? (await raw.records("order")),
  });
  const liveAtOrBelow = await liveNumbersAtOrBelow(db, max);
  const { errors, warnings } = checkSeeds({ target, max, starts, liveAtOrBelow });
  if (live && errors.length) throw new ImportRefusal(`Number seeds: ${errors.join(" ")}`);
  return { max, errors, warnings, summary: { seazonaMax: max, starts, liveAtOrBelow, errors, warnings } };
}
