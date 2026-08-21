import { pgTable, varchar, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Admin-confirmed Seazona product code for a single mapping slot. A DB override
// WINS over the table/resolver defaults in services/rx/catalog-map/. `mapKey` identifies the slot:
//   primary:<deviceKey>:<material|"default">  |  mod:<label>  |  lab:<serviceKey>
//
// seazonaCode is nullable: a "noteOnly" ruling (the lab decided a selection is
// a build instruction, not a charged product) is also confirmed permanently via
// this table, and that confirmation has no product code — inventing one would
// misrepresent the ruling. See admin-rx-cases.routes.js's overrideRowFor.
export const rxCodeOverrides = pgTable("rx_code_overrides", {
  id: varchar("id", { length: 128 }).primaryKey(),
  mapKey: varchar("map_key", { length: 200 }).notNull(),
  seazonaCode: varchar("seazona_code", { length: 60 }),
  seazonaProductId: varchar("seazona_product_id", { length: 128 }),
  seazonaName: varchar("seazona_name", { length: 255 }),
  note: text("note"),
  confirmedBy: varchar("confirmed_by", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("rx_code_overrides_map_key_idx").on(t.mapKey)]);
