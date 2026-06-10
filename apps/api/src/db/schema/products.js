import { pgTable, varchar, text, boolean, numeric, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Local mirror of Seazona products. Seazona is the system of record — there is
 * NO product-create API there (`GET v1/products/` is read-only), so this table
 * is populated by a one-way Seazona→local sync (see db/sync-seazona-products.js).
 *
 * Two distinct groups of columns:
 *   - Seazona-authoritative (`code`, `name`, `taxable`, `price`): overwritten on
 *     every sync. These reflect the lab's source of truth.
 *   - Shop-presentation (`imageUrl`, `description`, `purchasable`, `category`):
 *     our own local data, edited by admins. The sync job must NEVER clobber
 *     these. A product is not shoppable until an admin sets `purchasable=true`.
 */
export const products = pgTable("products", {
  // Seazona's product `id` is the primary key (varchar, matching how other
  // Seazona ids are stored on `users`).
  seazonaProductId: varchar("seazona_product_id", { length: 100 }).primaryKey(),

  // Seazona-authoritative fields (overwritten on each sync).
  code: varchar("code", { length: 100 }),
  name: text("name"),
  taxable: boolean("taxable").notNull().default(false),
  price: numeric("price", { precision: 12, scale: 2 }),

  // Shop-presentation fields (local-only — preserved across syncs).
  imageUrl: text("image_url"),
  description: text("description"),
  purchasable: boolean("purchasable").notNull().default(false),
  category: varchar("category", { length: 100 }),

  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("products_code_idx").on(table.code),
  index("products_purchasable_idx").on(table.purchasable),
]);
