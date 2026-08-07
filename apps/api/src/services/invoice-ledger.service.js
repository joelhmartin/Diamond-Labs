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
 * Both helpers fail SOFT (degrade to 0 / empty map) on a DB error — consistent
 * with the original invoice.routes.js behavior — rather than propagating a 500.
 */

/**
 * Sum of applied portal payments per Seazona invoice for one user.
 * @param {string} userId
 * @returns {Promise<Record<string, number>>} { [seazonaInvoiceId]: sumAppliedAmount }
 */
export async function getPortalPaidMap(userId) {
  try {
    const rows = await db
      .select({
        seazonaInvoiceId: invoicePayments.seazonaInvoiceId,
        totalPaid: sql`sum(${invoicePayments.appliedAmount})`.as("total_paid"),
      })
      .from(invoicePayments)
      .where(eq(invoicePayments.userId, userId))
      .groupBy(invoicePayments.seazonaInvoiceId);

    const map = {};
    for (const row of rows) {
      map[row.seazonaInvoiceId] = parseFloat(row.totalPaid || 0);
    }
    return map;
  } catch (err) {
    console.error("[invoiceLedger] getPortalPaidMap DB error — degrading to empty map:", err);
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
 * Sum of applied portal payments for a single Seazona invoice + user.
 * THROWS on a database error — callers that use this figure as a guard must
 * fail closed.
 * @returns {Promise<number>}
 */
export async function getInvoicePortalPaidStrict(userId, seazonaInvoiceId) {
  const [row] = await db
    .select({
      totalPaid: sql`sum(${invoicePayments.appliedAmount})`.as("total_paid"),
    })
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.userId, userId),
        eq(invoicePayments.seazonaInvoiceId, String(seazonaInvoiceId))
      )
    );
  return parseFloat(row?.totalPaid || 0);
}

/**
 * Soft-fail variant for DISPLAY ONLY: on a database error it degrades to 0,
 * which renders an invoice as unpaid.
 *
 * Never use this to enforce an over-payment cap. "Paid so far = 0" makes
 * `remaining = invoice.total`, so a transient DB blip would re-open the full
 * balance on an already-paid invoice and let it be charged again — the guard
 * would fail OPEN. Money paths must call `getInvoicePortalPaidStrict`.
 * @returns {Promise<number>}
 */
export async function getInvoicePortalPaid(userId, seazonaInvoiceId) {
  try {
    return await getInvoicePortalPaidStrict(userId, seazonaInvoiceId);
  } catch (err) {
    console.error(
      `[invoiceLedger] getInvoicePortalPaid DB error for invoice ${seazonaInvoiceId} — degrading to 0:`,
      err
    );
    return 0;
  }
}
