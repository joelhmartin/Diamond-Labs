import { pgTable, varchar, text, integer, jsonb, timestamp, date, index } from "drizzle-orm/pg-core";

// Pickups (piece 8, lab glue): a practice asks the lab's own driver to collect
// boxes; staff schedule, assign, complete or cancel. Vocabulary and moves:
// packages/shared lab/logistics.js. Rules: services/lab/pickup-rules.js.
//
// party_key is the practice key (services/practice.js) of the client at
// request time; doctors see every pickup of partyKeysFor(user).
// notes and cancel_reason are sealed free text (lib/crypto.js fieldSealer).
// address is the practice address snapshot, the same shape as shipments.ship_to.
// No DB foreign keys (repo convention).

export const pickups = pgTable("pickups", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // Allocated under advisory lock 7300480 (pickups.service.js), from 1.
  pickupNumber: integer("pickup_number").notNull().unique(),
  clientUserId: varchar("client_user_id", { length: 128 }).notNull(),
  partyKey: varchar("party_key", { length: 160 }).notNull(),
  requestedByUserId: varchar("requested_by_user_id", { length: 128 }).notNull(),
  earliestDate: date("earliest_date", { mode: "string" }).notNull(),
  latestDate: date("latest_date", { mode: "string" }).notNull(),
  // am | pm | any
  timePreference: varchar("time_preference", { length: 8 }).notNull(),
  boxCount: integer("box_count").notNull(),
  notes: text("notes"),
  address: jsonb("address"),
  // requested | scheduled | completed | cancelled
  status: varchar("status", { length: 20 }).notNull().default("requested"),
  scheduledDate: date("scheduled_date", { mode: "string" }),
  assigneeUserId: varchar("assignee_user_id", { length: 128 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedByUserId: varchar("completed_by_user_id", { length: 128 }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  // portal (a doctor asked) | staff (entered for a client)
  source: varchar("source", { length: 10 }).notNull().default("portal"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pickups_status_scheduled_idx").on(t.status, t.scheduledDate),
  index("pickups_party_created_idx").on(t.partyKey, t.createdAt.desc()),
]);
