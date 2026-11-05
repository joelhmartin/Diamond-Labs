import { sql } from "drizzle-orm";
import { pgTable, varchar, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// Named price lists (piece 10). A list is a template of per-variant prices;
// clients are assigned lists in precedence order (position 0 first). A
// client's own client_prices row beats every list, and an archived list stops
// applying (it resolves as if unassigned). Resolution: lib/pricing.js
// resolveClientPrices, loaded by services/pricing.service.js.
export const priceLists = pgTable("price_lists", {
  id: varchar("id", { length: 128 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: varchar("created_by", { length: 128 }),
}, (t) => [
  uniqueIndex("price_lists_name_lower_idx").on(sql`lower(${t.name})`),
]);

export const priceListItems = pgTable("price_list_items", {
  id: varchar("id", { length: 128 }).primaryKey(),
  priceListId: varchar("price_list_id", { length: 128 }).notNull(),
  variantId: varchar("variant_id", { length: 128 }).notNull(),
  priceCents: integer("price_cents").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: varchar("updated_by", { length: 128 }),
}, (t) => [
  uniqueIndex("price_list_items_list_variant_idx").on(t.priceListId, t.variantId),
  index("price_list_items_variant_idx").on(t.variantId),
]);

export const clientPriceLists = pgTable("client_price_lists", {
  id: varchar("id", { length: 128 }).primaryKey(),
  clientUserId: varchar("client_user_id", { length: 128 }).notNull(),
  priceListId: varchar("price_list_id", { length: 128 }).notNull(),
  position: integer("position").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  assignedBy: varchar("assigned_by", { length: 128 }),
}, (t) => [
  uniqueIndex("client_price_lists_client_list_idx").on(t.clientUserId, t.priceListId),
  index("client_price_lists_list_idx").on(t.priceListId),
]);
