import { pgTable, varchar, text, numeric, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Local record of a guest catalog order. The customer's card has ALREADY been
 * charged by the time a row lands here (see POST /payments/checkout) — this
 * table is the authoritative local source of truth for the sale, independent of
 * anything downstream.
 *
 * `orderNumber` replaces the old `DOL-<last8 ts>` scheme. It is the single
 * identifier used end-to-end: generated BEFORE the charge, sent to Authorize.net
 * as the transaction `invoiceNumber`, and persisted here. Collision-resistant by
 * construction (a cuid2-derived suffix) and enforced unique at the DB level.
 *
 * The seazona* columns are legacy: the Seazona createOrder push that wrote
 * them was retired in own-the-lab piece 2 and they are no longer written
 * (piece 5 drops them). The job for the bench is the lab order
 * (lab_orders.source = "shop_order", sourceId = orders.id).
 */
export const orders = pgTable("orders", {
  id: varchar("id", { length: 128 }).primaryKey(),

  // Authoritative human-facing order id — also the Authorize.net invoiceNumber.
  orderNumber: varchar("order_number", { length: 32 }).notNull(),

  // Customer / shipping snapshot.
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  shipping: jsonb("shipping").notNull(),

  // Money snapshot (immutable record of what was charged).
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  tax: numeric("tax", { precision: 12, scale: 2 }).notNull(),
  shippingCost: numeric("shipping_cost", { precision: 12, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),

  // Authorize.net charge result.
  transactionId: varchar("transaction_id", { length: 100 }).notNull(),
  authCode: varchar("auth_code", { length: 50 }),

  // Order lifecycle state. A row only exists after a successful capture, so this
  // starts at "paid".
  status: varchar("status", { length: 30 }).notNull().default("paid"),

  // Whose negotiated prices the order was charged at (pricingClientFor at
  // checkout); null = guest/base pricing.
  pricedForUserId: varchar("priced_for_user_id", { length: 128 }),

  // Legacy Seazona push outcome — see header.
  seazonaClientId: varchar("seazona_client_id", { length: 100 }),
  seazonaOrderId: varchar("seazona_order_id", { length: 128 }),
  // Legacy — see header.
  seazonaPushStatus: varchar("seazona_push_status", { length: 40 }),
  seazonaPushError: text("seazona_push_error"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("orders_order_number_idx").on(table.orderNumber),
  index("orders_email_idx").on(table.email),
  index("orders_transaction_id_idx").on(table.transactionId),
  index("orders_seazona_push_status_idx").on(table.seazonaPushStatus),
]);
