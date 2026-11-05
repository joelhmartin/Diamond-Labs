import { sql } from "drizzle-orm";
import { pgTable, varchar, integer, boolean, timestamp, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";

// Generic notifications module tables. Re-exported from db/schema/index.js so
// drizzle-kit sees them. No DB foreign keys (repo convention); ids are
// createId() varchar(128); every time is timestamptz.
//
// Nothing here holds free text from a record: titles are built only from the
// validated `data` (data-guard.js), and addresses are masked in the log.

/** In-app alerts. One unread row per (user, collapse_key): a burst bumps `count`. */
export const notifications = pgTable("notifications", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  event: varchar("event", { length: 80 }).notNull(),
  recordType: varchar("record_type", { length: 40 }),
  recordId: varchar("record_id", { length: 128 }),
  title: varchar("title", { length: 160 }).notNull(),
  link: varchar("link", { length: 300 }),
  // `${event}:${recordType}:${recordId}`
  collapseKey: varchar("collapse_key", { length: 200 }).notNull(),
  count: integer("count").notNull().default(1),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("notifications_user_read_updated_idx").on(t.userId, t.readAt, t.updatedAt.desc()),
  // store.js upsertInApp's ON CONFLICT names this predicate verbatim.
  uniqueIndex("notifications_user_collapse_unread_uq").on(t.userId, t.collapseKey).where(sql`read_at is null`),
]);

/** A user's override of an event's default for their kind. A missing row means the default. */
export const notificationPreferences = pgTable("notification_preferences", {
  userId: varchar("user_id", { length: 128 }).notNull(),
  event: varchar("event", { length: 80 }).notNull(),
  // in_app | email
  channel: varchar("channel", { length: 20 }).notNull(),
  enabled: boolean("enabled").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.event, t.channel] })]);

/** Static per-event recipient list (an SMS number or a shared mailbox). */
export const notificationRecipients = pgTable("notification_recipients", {
  id: varchar("id", { length: 128 }).primaryKey(),
  event: varchar("event", { length: 80 }).notNull(),
  // sms | email
  channel: varchar("channel", { length: 20 }).notNull(),
  // E.164 for sms
  address: varchar("address", { length: 320 }).notNull(),
  label: varchar("label", { length: 80 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id", { length: 128 }),
}, (t) => [uniqueIndex("notification_recipients_event_channel_address_uq").on(t.event, t.channel, t.address)]);

/** One row per email or SMS attempt. Pruned to 90 days by pruneDeliveries(). */
export const notificationDeliveries = pgTable("notification_deliveries", {
  id: varchar("id", { length: 128 }).primaryKey(),
  event: varchar("event", { length: 80 }).notNull(),
  channel: varchar("channel", { length: 20 }).notNull(),
  userId: varchar("user_id", { length: 128 }),
  targetMasked: varchar("target_masked", { length: 40 }),
  // sent | failed | skipped | suppressed
  status: varchar("status", { length: 20 }).notNull(),
  reason: varchar("reason", { length: 200 }),
  recordType: varchar("record_type", { length: 40 }),
  recordId: varchar("record_id", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("notification_deliveries_created_idx").on(t.createdAt.desc())]);
