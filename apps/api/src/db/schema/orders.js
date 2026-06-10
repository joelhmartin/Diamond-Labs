import { pgTable, varchar, text, numeric, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Local record of a guest catalog order. The customer's card has ALREADY been
 * charged by the time a row lands here (see POST /payments/checkout) — this
 * table is the authoritative local source of truth for the sale, independent of
 * any downstream Seazona push.
 *
 * `orderNumber` replaces the old `DOL-<last8 ts>` scheme. It is the single
 * identifier used end-to-end: generated BEFORE the charge, sent to Authorize.net
 * as the transaction `invoiceNumber`, and persisted here. Collision-resistant by
 * construction (a cuid2-derived suffix) and enforced unique at the DB level.
 *
 * Seazona push columns capture the outcome of the (gated) `createOrder` write.
 * A failed or skipped push NEVER fails checkout — the money is already taken, so
 * the local order stands and the push outcome is recorded for later reconcile.
 *   seazonaPushStatus:
 *     pending                 — eligible, push in flight / not yet attempted
 *     skipped_not_production  — AUTHORIZE_NET_ENV !== "production" (no live write)
 *     skipped_no_user         — SEAZONA_ORDER_USER_ID not configured
 *     not_applicable_guest    — order has no Seazona clientId; createOrder requires
 *                               one, so a pure guest order cannot be pushed
 *     pushed                  — createOrder succeeded; seazonaOrderId populated
 *     failed                  — createOrder returned null / threw; see push error
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

  // Seazona createOrder push outcome (nullable until/unless a push runs).
  seazonaClientId: varchar("seazona_client_id", { length: 100 }),
  seazonaOrderId: varchar("seazona_order_id", { length: 128 }),
  seazonaPushStatus: varchar("seazona_push_status", { length: 40 }).notNull().default("pending"),
  seazonaPushError: text("seazona_push_error"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("orders_order_number_idx").on(table.orderNumber),
  index("orders_email_idx").on(table.email),
  index("orders_transaction_id_idx").on(table.transactionId),
  index("orders_seazona_push_status_idx").on(table.seazonaPushStatus),
]);
