import { pgTable, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

// A pending drop of files that a person turns into a record (or discards).
// `hints` and `discard_reason` are sealed (encrypted) free text. No DB foreign
// keys (repo convention); the files live in record_files under record type
// "intake" until a promote relinks them to the new record.

export const intakes = pgTable("intakes", {
  id: varchar("id", { length: 128 }).primaryKey(),
  channel: varchar("channel", { length: 40 }).notNull().default("upload"),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | promoted | discarded
  parserKey: varchar("parser_key", { length: 40 }).notNull().default("generic"),
  hints: text("hints"), // sealed JSON
  promotedRecordType: varchar("promoted_record_type", { length: 40 }),
  promotedRecordId: varchar("promoted_record_id", { length: 128 }),
  createdBy: varchar("created_by", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy: varchar("decided_by", { length: 128 }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  discardReason: text("discard_reason"), // sealed
}, (t) => [index("intakes_status_created_idx").on(t.status, t.createdAt)]);
