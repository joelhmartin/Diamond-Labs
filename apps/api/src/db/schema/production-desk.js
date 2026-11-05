import { sql } from "drizzle-orm";
import { pgTable, varchar, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// Production-desk tables (piece 6). No DB foreign keys (repo convention).

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * The pick-list behind remake reasons and invoice discounts. `discountPercent`
 * is the reason's default (0-100, null = none); a remake priced from a reason
 * uses it (null = 100% off). Deactivated, never deleted: orders point at them.
 * Seeded by the custom migration seed_adjustment_reasons.
 */
export const adjustmentReasons = pgTable("adjustment_reasons", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // remake | discount | both
  appliesTo: varchar("applies_to", { length: 10 }).notNull(),
  label: varchar("label", { length: 80 }).notNull(),
  discountPercent: integer("discount_percent"),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  ...stamps,
}, (t) => [uniqueIndex("adjustment_reasons_label_idx").on(sql`lower(${t.label})`)]);

/**
 * Materials and lot numbers recorded against one bench line. Plain text naming
 * products, not people (spec ruling), so not sealed. Replaced as a list.
 */
export const labOrderLineMaterials = pgTable("lab_order_line_materials", {
  id: varchar("id", { length: 128 }).primaryKey(),
  labOrderId: varchar("lab_order_id", { length: 128 }).notNull(),
  labOrderLineId: varchar("lab_order_line_id", { length: 128 }).notNull(),
  position: integer("position").notNull().default(0),
  material: varchar("material", { length: 120 }).notNull(),
  lotNumber: varchar("lot_number", { length: 60 }),
  createdBy: varchar("created_by", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("lab_order_line_materials_order_idx").on(t.labOrderId),
  index("lab_order_line_materials_material_idx").on(t.material),
]);
