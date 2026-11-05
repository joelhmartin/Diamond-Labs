import { pgTable, varchar, integer, timestamp, index } from "drizzle-orm/pg-core";

// Private attachments on any (recordType, recordId). The object lives in the
// private bucket; storage_url is internal and is never returned to clients.
// No DB foreign keys (repo convention); the service holds integrity.

export const recordFiles = pgTable("record_files", {
  id: varchar("id", { length: 128 }).primaryKey(),
  recordType: varchar("record_type", { length: 40 }).notNull(),
  recordId: varchar("record_id", { length: 128 }).notNull(),
  kind: varchar("kind", { length: 40 }).notNull(),
  originalName: varchar("original_name", { length: 500 }).notNull(),
  storageUrl: varchar("storage_url", { length: 1000 }).notNull(),
  contentType: varchar("content_type", { length: 200 }),
  size: integer("size").notNull(),
  createdBy: varchar("created_by", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("record_files_record_idx").on(t.recordType, t.recordId)]);
