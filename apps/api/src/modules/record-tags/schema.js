import { sql } from "drizzle-orm";
import { pgTable, varchar, integer, boolean, timestamp, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";

// Generic labels + per-user stars on any (recordType, recordId). No DB foreign
// keys (repo convention); the service holds integrity. Definitions are
// deactivated, never deleted, so already-applied tags keep their meaning.

export const tagDefinitions = pgTable("tag_definitions", {
  id: varchar("id", { length: 128 }).primaryKey(),
  recordType: varchar("record_type", { length: 40 }).notNull(),
  label: varchar("label", { length: 40 }).notNull(),
  color: varchar("color", { length: 20 }).notNull().default("slate"),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("tag_definitions_type_label_idx").on(t.recordType, sql`lower(${t.label})`)]);

export const recordTags = pgTable("record_tags", {
  id: varchar("id", { length: 128 }).primaryKey(),
  recordType: varchar("record_type", { length: 40 }).notNull(),
  recordId: varchar("record_id", { length: 128 }).notNull(),
  tagId: varchar("tag_id", { length: 128 }).notNull(),
  createdBy: varchar("created_by", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("record_tags_record_tag_idx").on(t.recordType, t.recordId, t.tagId),
  index("record_tags_tag_idx").on(t.tagId),
]);

export const recordStars = pgTable("record_stars", {
  recordType: varchar("record_type", { length: 40 }).notNull(),
  recordId: varchar("record_id", { length: 128 }).notNull(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.recordType, t.recordId, t.userId] })]);
