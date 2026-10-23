import { inArray, sql } from "drizzle-orm";
import { invoicePayments } from "../../db/schema/index.js";

/**
 * THE paid-cents sum: an invoice's paid amount is the SUM of its
 * invoice_payments rows (payments and credits positive, refunds negative).
 * Db-free (the database is a required argument) so the import tools, which
 * must not load config/database.js, share the very same query with
 * ledger.service.js `paidCentsByInvoice`.
 *
 * @returns {Promise<Map<string, number>>} invoiceId → paid cents
 */
export async function paidCentsFor(invoiceIds, database) {
  const ids = [...new Set(invoiceIds.map(String))];
  if (ids.length === 0) return new Map();
  const rows = await database
    .select({ invoiceId: invoicePayments.invoiceId, paid: sql`coalesce(sum(${invoicePayments.appliedCents}), 0)` })
    .from(invoicePayments)
    .where(inArray(invoicePayments.invoiceId, ids))
    .groupBy(invoicePayments.invoiceId);
  return new Map(rows.map((r) => [r.invoiceId, Number(r.paid)]));
}
