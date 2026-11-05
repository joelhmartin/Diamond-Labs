import { pgTable, varchar, text, integer, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

// Generic messaging module tables. Re-exported from db/schema/index.js so
// drizzle-kit sees them. No DB foreign keys (repo convention); ids are
// createId() varchar(128); every time is timestamptz. `subject` and `body` are
// sealed (enc:v1) by the service, never stored as plain text.

/** One conversation between the host and one party, optionally about a record. */
export const messageThreads = pgTable("message_threads", {
  id: varchar("id", { length: 128 }).primaryKey(),
  recordType: varchar("record_type", { length: 40 }),
  recordId: varchar("record_id", { length: 128 }),
  partyKey: varchar("party_key", { length: 160 }).notNull(),
  subject: text("subject"),
  createdByUserId: varchar("created_by_user_id", { length: 128 }).notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
  // host | party
  lastMessageSide: varchar("last_message_side", { length: 10 }).notNull(),
  messageCount: integer("message_count").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedByUserId: varchar("completed_by_user_id", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("message_threads_party_last_idx").on(t.partyKey, t.lastMessageAt.desc()),
  index("message_threads_record_idx").on(t.recordType, t.recordId),
  index("message_threads_completed_last_idx").on(t.completedAt, t.lastMessageAt.desc()),
]);

/** Per-user read state and folder. Anyone who posts or opens a thread gets a row. */
export const messageParticipants = pgTable("message_participants", {
  threadId: varchar("thread_id", { length: 128 }).notNull(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  side: varchar("side", { length: 10 }).notNull(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.threadId, t.userId] })]);

export const messages = pgTable("messages", {
  id: varchar("id", { length: 128 }).primaryKey(),
  threadId: varchar("thread_id", { length: 128 }).notNull(),
  authorUserId: varchar("author_user_id", { length: 128 }).notNull(),
  authorSide: varchar("author_side", { length: 10 }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("messages_thread_created_idx").on(t.threadId, t.createdAt)]);
