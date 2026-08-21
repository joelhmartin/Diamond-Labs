import { pgTable, varchar, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";

// The editable order derived from a submitted prescription.
//
// Line items used to be computed on the fly at push time and thrown away. Staff
// can now correct them before pushing, so they have to persist.
//
// `origin: "manual"` marks a line a human added or edited. Re-resolving from the
// prescription recomputes "auto" lines and leaves "manual" ones alone — without
// that flag a re-resolve would silently discard someone's correction.
//
// `noteOnly` marks a doctor selection the lab has ruled is a build instruction
// rather than a charged product. It travels in the order notes, not as a line,
// and does not block the push.
export const rxCaseLines = pgTable("rx_case_lines", {
  id: varchar("id", { length: 128 }).primaryKey(),
  caseId: varchar("case_id", { length: 128 }).notNull(),
  position: integer("position").notNull().default(0),
  seazonaCode: varchar("seazona_code", { length: 60 }),
  seazonaProductId: varchar("seazona_product_id", { length: 128 }),
  name: varchar("name", { length: 255 }),
  arch: varchar("arch", { length: 20 }),
  // Which mapping slot produced this line; also the rx_code_overrides key.
  mapKey: varchar("map_key", { length: 200 }),
  // confirmed | proposed | open
  status: varchar("status", { length: 20 }).notNull().default("open"),
  // auto | manual
  origin: varchar("origin", { length: 20 }).notNull().default("auto"),
  noteOnly: boolean("note_only").notNull().default(false),
  // The doctor's literal selection, kept so an unresolved line can say what it was.
  sourceLabel: text("source_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rx_case_lines_case_id_idx").on(t.caseId)]);
