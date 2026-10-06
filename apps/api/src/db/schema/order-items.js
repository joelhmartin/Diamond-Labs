import { pgTable, varchar, text, numeric, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";

/**
 * One line per catalog item on a guest order. Everything is SNAPSHOTTED at the
 * moment of sale (name, unit price, taxable flag, the mapped Seazona product id)
 * so the order record stays immutable even if the `products` mirror later changes
 * price, name, or its SKU→Seazona mapping.
 *
 * `seazonaProductId` is the id used for a Seazona createOrder push; it is carried
 * here so a deferred / retried push doesn't need to re-resolve the catalog.
 */
export const orderItems = pgTable("order_items", {
  id: varchar("id", { length: 128 }).primaryKey(),
  orderId: varchar("order_id", { length: 128 }).notNull().references(() => orders.id),

  // Legacy shop SKU id; null when the variant has none.
  catalogId: varchar("catalog_id", { length: 100 }),
  // The catalog variant sold (own-the-lab). Null on orders placed before it.
  variantId: varchar("variant_id", { length: 128 }),
  seazonaProductId: varchar("seazona_product_id", { length: 100 }),
  name: text("name").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  qty: integer("qty").notNull(),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  taxable: boolean("taxable").notNull().default(false),
  // Where unitPrice came from: "client" (negotiated) | "base". Null on orders
  // placed before the pricing service.
  priceSource: varchar("price_source", { length: 10 }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("order_items_order_id_idx").on(table.orderId),
]);
