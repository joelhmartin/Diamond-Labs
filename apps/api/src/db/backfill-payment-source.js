/**
 * One-off backfill for invoice_payments.source.
 *
 * Origin used to be encoded only in the transactionId prefix. Derive the new
 * column from those prefixes so historical rows are classifiable alongside new
 * ones. Idempotent — only touches rows where source IS NULL.
 *
 *   DRY_RUN=1 pnpm db:backfill-payment-source
 */
import { db, queryClient } from "../config/database.js";
import { invoicePayments } from "./schema/index.js";
import { isNull, sql } from "drizzle-orm";

const DRY_RUN = process.env.DRY_RUN === "1";

const rows = await db
  .select({ id: invoicePayments.id, transactionId: invoicePayments.transactionId, refunds: invoicePayments.refundsTransactionId })
  .from(invoicePayments)
  .where(isNull(invoicePayments.source));

function classify(row) {
  if (row.refunds) return "refund";
  const tx = String(row.transactionId || "");
  if (tx.startsWith("OFFLINE-")) return "admin_offline";
  if (tx.startsWith("REFUND-PENDING-")) return "refund";
  // Everything else predates AutoPay and admin charging, so it came from a
  // doctor-initiated charge. We cannot distinguish saved-card from hosted
  // retroactively; doctor_card is the honest umbrella.
  return "doctor_card";
}

const counts = {};
for (const row of rows) {
  const source = classify(row);
  counts[source] = (counts[source] || 0) + 1;
  if (!DRY_RUN) {
    await db.execute(sql`update invoice_payments set source = ${source} where id = ${row.id}`);
  }
}

console.log(`${DRY_RUN ? "[dry run] would set" : "set"} source on ${rows.length} rows:`, counts);
await queryClient.end();
