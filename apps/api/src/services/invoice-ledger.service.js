import { db } from "../config/database.js";
import { invoicePayments } from "../db/schema/index.js";
import { and, eq, sql } from "drizzle-orm";
import { summarizePayments } from "../lib/payment-summary.js";

/**
 * Local portal-payment ledger reads. Seazona records payments only at the
 * client-account level (no invoice-level payment API), so the
 * `invoice_payments` table is our own source of truth for how much of each
 * invoice has been paid through the portal. Extracted here so both the invoice
 * routes (display) and the payment routes (the C1 over-allocation cap) read the
 * SAME aggregation, with no behavior drift.
 *
 * "How much of this invoice is paid" is keyed by SEAZONA CLIENT + invoice, never
 * by portal user. Several portal logins can share one seazonaClientId (one
 * practice), and the invoice belongs to the practice: a per-user sum let a second
 * login see — and pay — the full balance again after the first login paid it.
 * The ledger row's `userId` is attribution (who paid), not ownership.
 *
 * The display reads fail SOFT (degrade to 0 / empty map) on a DB error. The cap
 * read (`getInvoicePaidStrict`) THROWS, because a guard must fail closed.
 */

/** WHERE clause for "ledger rows applied to this client's invoice". Exported for tests. */
export function invoicePaidWhere({ seazonaClientId, seazonaInvoiceId }) {
  // Missing either key would silently widen or empty the sum — refuse instead.
  if (!seazonaClientId || !seazonaInvoiceId) {
    throw new Error("invoice ledger: seazonaClientId and seazonaInvoiceId are both required");
  }
  return and(
    eq(invoicePayments.seazonaClientId, String(seazonaClientId)),
    eq(invoicePayments.seazonaInvoiceId, String(seazonaInvoiceId))
  );
}

/**
 * Sum of applied portal payments per Seazona invoice for one Seazona client
 * (every portal login of that practice). DISPLAY ONLY — fails soft.
 * @param {string} seazonaClientId
 * @returns {Promise<Record<string, number>>} { [seazonaInvoiceId]: sumAppliedAmount }
 */
export async function getClientPaidMap(seazonaClientId) {
  try {
    if (!seazonaClientId) return {};
    const rows = await db
      .select({
        seazonaInvoiceId: invoicePayments.seazonaInvoiceId,
        totalPaid: sql`sum(${invoicePayments.appliedAmount})`.as("total_paid"),
      })
      .from(invoicePayments)
      .where(eq(invoicePayments.seazonaClientId, String(seazonaClientId)))
      .groupBy(invoicePayments.seazonaInvoiceId);

    const map = {};
    for (const row of rows) {
      map[row.seazonaInvoiceId] = parseFloat(row.totalPaid || 0);
    }
    return map;
  } catch (err) {
    console.error("[invoiceLedger] getClientPaidMap DB error — degrading to empty map:", err);
    return {};
  }
}

/**
 * Applied totals for EVERY invoice across all users, keyed by seazonaInvoiceId.
 * The admin invoice list needs balances for many doctors at once; calling
 * getPortalPaidMap per user would be N queries. Soft-fails to {} — this is a
 * display path, never a guard.
 * @returns {Promise<Record<string, number>>} { [seazonaInvoiceId]: sumAppliedAmount }
 */
export async function getGlobalPortalPaidMap() {
  try {
    const rows = await db
      .select({
        seazonaInvoiceId: invoicePayments.seazonaInvoiceId,
        totalPaid: sql`sum(${invoicePayments.appliedAmount})`.as("total_paid"),
      })
      .from(invoicePayments)
      .groupBy(invoicePayments.seazonaInvoiceId);
    return Object.fromEntries(rows.map((r) => [String(r.seazonaInvoiceId), parseFloat(r.totalPaid || 0)]));
  } catch (err) {
    console.error("[invoiceLedger] getGlobalPortalPaidMap failed — degrading to empty:", err);
    return {};
  }
}

/**
 * Transaction-level payment history for one user (the doctor's own payments).
 * Fails SOFT to an empty list on a DB error, consistent with the other reads.
 * @param {string} userId
 * @returns {Promise<Array<object>>}
 */
export async function listPaymentsForUser(userId) {
  try {
    const rows = await db.select().from(invoicePayments).where(eq(invoicePayments.userId, userId));
    return summarizePayments(rows);
  } catch (err) {
    console.error("[invoiceLedger] listPaymentsForUser DB error — degrading to empty list:", err);
    return [];
  }
}

/**
 * Transaction-level payment history across all users (admin view). Optionally
 * scoped to a single user. Name/email enrichment is the route's job. Fails SOFT.
 * @param {{ userId?: string }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function listAllPayments({ userId } = {}) {
  try {
    const rows = userId
      ? await db.select().from(invoicePayments).where(eq(invoicePayments.userId, userId))
      : await db.select().from(invoicePayments);
    return summarizePayments(rows);
  } catch (err) {
    console.error("[invoiceLedger] listAllPayments DB error — degrading to empty list:", err);
    return [];
  }
}

/**
 * Sum of applied portal payments for one Seazona client's invoice, across every
 * portal login linked to that client. This is the figure the over-allocation
 * caps subtract from the invoice total.
 *
 * THROWS on a database error (and on a missing key) — callers use this as a
 * guard and must fail closed.
 * @param {{ seazonaClientId: string, seazonaInvoiceId: string }} keys
 * @returns {Promise<number>}
 */
export async function getInvoicePaidStrict({ seazonaClientId, seazonaInvoiceId }) {
  const where = invoicePaidWhere({ seazonaClientId, seazonaInvoiceId });
  const [row] = await db
    .select({
      totalPaid: sql`sum(${invoicePayments.appliedAmount})`.as("total_paid"),
    })
    .from(invoicePayments)
    .where(where);
  return parseFloat(row?.totalPaid || 0);
}

/**
 * Soft-fail variant for DISPLAY ONLY: on a database error it degrades to 0,
 * which renders an invoice as unpaid.
 *
 * Never use this to enforce an over-payment cap. "Paid so far = 0" makes
 * `remaining = invoice.total`, so a transient DB blip would re-open the full
 * balance on an already-paid invoice and let it be charged again — the guard
 * would fail OPEN. Money paths must call `getInvoicePaidStrict`.
 * @param {{ seazonaClientId: string, seazonaInvoiceId: string }} keys
 * @returns {Promise<number>}
 */
export async function getInvoicePaid({ seazonaClientId, seazonaInvoiceId }) {
  try {
    return await getInvoicePaidStrict({ seazonaClientId, seazonaInvoiceId });
  } catch (err) {
    console.error(
      `[invoiceLedger] getInvoicePaid DB error for invoice ${seazonaInvoiceId} — degrading to 0:`,
      err
    );
    return 0;
  }
}
