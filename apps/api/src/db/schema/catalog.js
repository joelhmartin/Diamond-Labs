import { pgTable, varchar, text, boolean, integer, timestamp, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";

// Our own product catalog. Replaces the Seazona mirror in `products`, which
// stays read-only on this branch as the import source until cutover.
//
//   family  — what a doctor or shopper recognises ("Olmos Night")
//   option  — an axis on a family ("Design", "Material")
//   variant — the sellable SKU: one lab code, one base price. A family with
//             no options has exactly one variant.
//
// No DB foreign keys (repo convention); services/catalog.service.js holds
// integrity inside transactions.

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const productFamilies = pgTable("product_families", {
  id: varchar("id", { length: 128 }).primaryKey(),
  slug: varchar("slug", { length: 120 }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }),
  imageUrl: text("image_url"),
  // shop = sold online; rx = billed by the lab on cases; both
  channel: varchar("channel", { length: 10 }).notNull().default("shop"),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  ...stamps,
}, (t) => [uniqueIndex("product_families_slug_idx").on(t.slug)]);

export const productOptions = pgTable("product_options", {
  id: varchar("id", { length: 128 }).primaryKey(),
  familyId: varchar("family_id", { length: 128 }).notNull(),
  name: varchar("name", { length: 60 }).notNull(),
  position: integer("position").notNull().default(0),
}, (t) => [index("product_options_family_idx").on(t.familyId)]);

export const productOptionValues = pgTable("product_option_values", {
  id: varchar("id", { length: 128 }).primaryKey(),
  optionId: varchar("option_id", { length: 128 }).notNull(),
  value: varchar("value", { length: 120 }).notNull(),
  position: integer("position").notNull().default(0),
}, (t) => [index("product_option_values_option_idx").on(t.optionId)]);

export const productVariants = pgTable("product_variants", {
  id: varchar("id", { length: 128 }).primaryKey(),
  familyId: varchar("family_id", { length: 128 }).notNull(),
  // The lab's product code ("2119"). Kept so invoice history and the
  // technicians' vocabulary carry over. Nullable for brand-new items.
  code: varchar("code", { length: 60 }),
  name: text("name").notNull(),
  // null = not priced yet → not sellable.
  basePriceCents: integer("base_price_cents"),
  taxable: boolean("taxable").notNull().default(false),
  active: boolean("active").notNull().default(true),
  // Legacy shop SKU id from data/catalog.js ("16").
  catalogId: varchar("catalog_id", { length: 100 }),
  // Retired in piece 5 with the rest of Seazona.
  legacySeazonaProductId: varchar("legacy_seazona_product_id", { length: 100 }),
  ...stamps,
}, (t) => [
  index("product_variants_family_idx").on(t.familyId),
  uniqueIndex("product_variants_code_idx").on(t.code),
  uniqueIndex("product_variants_catalog_id_idx").on(t.catalogId),
  uniqueIndex("product_variants_legacy_idx").on(t.legacySeazonaProductId),
]);

export const productVariantOptionValues = pgTable("product_variant_option_values", {
  variantId: varchar("variant_id", { length: 128 }).notNull(),
  optionValueId: varchar("option_value_id", { length: 128 }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.variantId, t.optionValueId] }),
  index("product_variant_option_values_value_idx").on(t.optionValueId),
]);
