import { pgTable, varchar, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// A client's negotiated price for one variant. The billing client is the user
// carrying the Seazona client link — the same key invoice_payments uses.
//   source: manual   — entered by staff
//           imported — from a Seazona price-list export
//           inferred — last price actually billed (filled by the piece-5
//                      migration); used, but flagged until reviewedAt is set
export const clientPrices = pgTable("client_prices", {
  id: varchar("id", { length: 128 }).primaryKey(),
  clientUserId: varchar("client_user_id", { length: 128 }).notNull(),
  variantId: varchar("variant_id", { length: 128 }).notNull(),
  priceCents: integer("price_cents").notNull(),
  source: varchar("source", { length: 12 }).notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: varchar("reviewed_by", { length: 128 }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("client_prices_client_variant_idx").on(t.clientUserId, t.variantId),
  index("client_prices_variant_idx").on(t.variantId),
]);
