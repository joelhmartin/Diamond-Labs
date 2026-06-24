import { db } from "../config/database.js";
import { invoicePayments } from "../db/schema/index.js";
import { and, eq, sql } from "drizzle-orm";

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
 * Sum of applied portal payments for a single Seazona invoice + user.
 * @returns {Promise<number>}
 */
export async function getInvoicePortalPaid(userId, seazonaInvoiceId) {
  try {
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
  } catch (err) {
    console.error(
      `[invoiceLedger] getInvoicePortalPaid DB error for invoice ${seazonaInvoiceId} — degrading to 0:`,
      err
    );
    return 0;
  }
}
