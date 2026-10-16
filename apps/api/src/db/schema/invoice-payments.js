import { pgTable, varchar, timestamp, integer, date, text, index } from "drizzle-orm/pg-core";

/**
 * The invoice ledger: how money was applied to invoices. One row per invoice a
 * payment was split across. Paid = SUM(applied_cents) per invoice; balance is
 * derived (services/billing/invoice-rules.js deriveBalance), never stored.
 *
 * Sign: payments and credits are POSITIVE (they reduce the balance); refund and
 * void reversals are NEGATIVE rows carrying `refundsTransactionId` = the
 * ORIGINAL charge's transaction id (the double-refund guard and the
 * reconciliation link). The row's own `transactionId` is the gateway's id, an
 * `OFFLINE-<id>` sentinel for a manual payment, `credit:<rowId>` for a staff
 * credit, or the checkout's id for a shop order.
 *
 * Seazona-era rows (before own-the-lab piece 3) carry `seazonaClientId` /
 * `seazonaInvoiceId` and no `invoiceId`; piece 5's import fills `invoiceId`.
 */
export const invoicePayments = pgTable("invoice_payments", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // Who paid (attribution, not ownership). Null for a guest's shop payment.
  userId: varchar("user_id", { length: 128 }),
  // The local invoice (own-the-lab piece 3).
  invoiceId: varchar("invoice_id", { length: 128 }),
  // Legacy (Seazona) keys, kept for history.
  seazonaClientId: varchar("seazona_client_id", { length: 100 }),
  seazonaInvoiceId: varchar("seazona_invoice_id", { length: 128 }),
  invoiceNumber: varchar("invoice_number", { length: 50 }),
  // Integer cents (sign rule in the header).
  appliedCents: integer("applied_cents").notNull(),
  transactionId: varchar("transaction_id", { length: 100 }).notNull(),
  seazonaPaymentId: varchar("seazona_payment_id", { length: 128 }),
  // Set only on refund/void reversal rows → the ORIGINAL charge's transaction id.
  refundsTransactionId: varchar("refunds_transaction_id", { length: 100 }),
  // doctor_card | doctor_hosted | admin_card | autopay | refund | shop_card |
  // admin_check | admin_cash | admin_ach | admin_other | credit
  // (admin_offline on Seazona-era rows; null on rows older than the column).
  source: varchar("source", { length: 32 }),
  // The day a manual payment was received (staff-entered). Null → the row's lab-local created date.
  paidOn: date("paid_on", { mode: "string" }),
  // Check number / ACH trace a manual payment carries.
  reference: varchar("reference", { length: 100 }),
  // A credit's reason. Staff free text: encrypted.
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("invoice_payments_user_id_idx").on(table.userId),
  index("invoice_payments_invoice_id_idx").on(table.invoiceId),
  index("invoice_payments_seazona_invoice_id_idx").on(table.seazonaInvoiceId),
  index("invoice_payments_transaction_id_idx").on(table.transactionId),
  index("invoice_payments_refunds_transaction_id_idx").on(table.refundsTransactionId),
]);
