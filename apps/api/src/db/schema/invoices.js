import { pgTable, varchar, text, integer, boolean, date, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// Invoices (own-the-lab piece 3): what each client owes. One per lab order
// (kind "order"), one per paid shop order (kind "shop") and, from piece 5's
// import, one per historical Seazona invoice (kind "legacy").
//
// Money is integer cents. Totals are recomputed from the lines by
// services/billing/invoice-rules.js computeTotals on every draft change and
// never edited directly. Paid and balance are DERIVED from invoice_payments
// (services/billing/ledger.service.js + invoice-rules deriveBalance), never stored.
//
// notes, voidReason and invoice_lines.priceNote are staff free text that can
// name a patient: encrypted at rest (services/billing/invoice-crypto.js).
//
// No DB foreign keys (repo convention).

export const invoices = pgTable("invoices", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // Continues the legacy numbering from INVOICE_NUMBER_START (allocated under
  // an advisory lock, services/sequence.service.js).
  invoiceNumber: integer("invoice_number").notNull(),
  // order | shop | legacy
  kind: varchar("kind", { length: 10 }).notNull(),
  // The doctor billed. Null only for a guest's shop invoice (never on a statement).
  clientUserId: varchar("client_user_id", { length: 128 }),
  labOrderId: varchar("lab_order_id", { length: 128 }),
  // Piece 5's import key.
  legacySeazonaInvoiceId: varchar("legacy_seazona_invoice_id", { length: 128 }),
  // draft | issued | void
  status: varchar("status", { length: 10 }).notNull().default("draft"),
  // Optimistic concurrency, as on lab orders: every change increments it.
  version: integer("version").notNull().default(1),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  dueDate: date("due_date", { mode: "string" }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  shippingCents: integer("shipping_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  // Staff-only, encrypted.
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("invoices_invoice_number_idx").on(t.invoiceNumber),
  // Postgres unique indexes ignore NULLs: one invoice per lab order / legacy invoice when set.
  uniqueIndex("invoices_lab_order_idx").on(t.labOrderId),
  uniqueIndex("invoices_legacy_seazona_idx").on(t.legacySeazonaInvoiceId),
  index("invoices_client_idx").on(t.clientUserId),
  index("invoices_status_idx").on(t.status),
]);

export const invoiceLines = pgTable("invoice_lines", {
  id: varchar("id", { length: 128 }).primaryKey(),
  invoiceId: varchar("invoice_id", { length: 128 }).notNull(),
  position: integer("position").notNull().default(0),
  // item | shipping | fee | adjustment. Shipping lines make up shippingCents;
  // only an adjustment may be negative.
  kind: varchar("kind", { length: 12 }).notNull().default("item"),
  variantId: varchar("variant_id", { length: 128 }),
  code: varchar("code", { length: 60 }),
  description: text("description").notNull(),
  qty: integer("qty").notNull().default(1),
  unitCents: integer("unit_cents").notNull(),
  lineCents: integer("line_cents").notNull(),
  taxable: boolean("taxable").notNull().default(false),
  // client | base | manual | remake | unpriced | shipment
  priceSource: varchar("price_source", { length: 10 }).notNull(),
  // Why staff overrode the price. Encrypted.
  priceNote: text("price_note"),
  labOrderLineId: varchar("lab_order_line_id", { length: 128 }),
  // The shipment that added this shipping line (piece 4), so voiding the label removes exactly it.
  shipmentId: varchar("shipment_id", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId), index("invoice_lines_shipment_idx").on(t.shipmentId)]);
