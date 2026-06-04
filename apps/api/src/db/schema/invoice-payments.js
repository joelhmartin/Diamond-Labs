import { pgTable, varchar, timestamp, numeric, index } from "drizzle-orm/pg-core";

/**
 * Local ledger of how each Authorize.net charge was allocated across Seazona
 * invoices. Seazona payments are recorded at the client-account level (no
 * invoice-level payment API), so this table is our own source of truth for
 * which invoice each slice of a payment was applied to.
 *
 * One charge can produce multiple rows (one per invoice it was split across).
 */
export const invoicePayments = pgTable("invoice_payments", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  seazonaClientId: varchar("seazona_client_id", { length: 100 }),
  seazonaInvoiceId: varchar("seazona_invoice_id", { length: 128 }).notNull(),
  invoiceNumber: varchar("invoice_number", { length: 50 }),
  appliedAmount: numeric("applied_amount", { precision: 12, scale: 2 }).notNull(),
  transactionId: varchar("transaction_id", { length: 100 }).notNull(),
  seazonaPaymentId: varchar("seazona_payment_id", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("invoice_payments_user_id_idx").on(table.userId),
  index("invoice_payments_seazona_invoice_id_idx").on(table.seazonaInvoiceId),
  index("invoice_payments_transaction_id_idx").on(table.transactionId),
]);
