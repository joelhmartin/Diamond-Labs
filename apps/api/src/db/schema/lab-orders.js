import { sql } from "drizzle-orm";
import { pgTable, varchar, text, integer, boolean, date, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// Lab orders: one job on the bench. Every Rx case released to the lab and
// every paid shop order produces exactly one (a remake adds another, flagged
// isRemake). Patient data is NOT copied here — a lab order references its
// case (source = "rx_case", sourceId = rx_cases.id) and reads PHI from there.
//
// Free text staff type (holdReason, labNotes, event notes) is encrypted at
// rest by services/lab/lab-orders.service.js (enc:v1:, lib/crypto.js), the
// same treatment rx_cases.manualNote got in B4.
//
// No DB foreign keys (repo convention); services/lab holds integrity inside
// transactions.

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** The lab's own rooms/benches. Deactivated, never deleted (orders point at them). */
export const labDepartments = pgTable("lab_departments", {
  id: varchar("id", { length: 128 }).primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  ...stamps,
}, (t) => [uniqueIndex("lab_departments_name_idx").on(t.name)]);

export const labOrders = pgTable("lab_orders", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // Continues the lab's paperwork numbering from LAB_ORDER_NUMBER_START
  // (lab-orders.service allocateOrderNumber, under an advisory lock).
  orderNumber: integer("order_number").notNull(),
  // rx_case | shop_order
  source: varchar("source", { length: 20 }).notNull(),
  sourceId: varchar("source_id", { length: 128 }).notNull(),
  // The doctor (Rx) or the approved doctor the shop order was priced for;
  // null for a guest shop order.
  clientUserId: varchar("client_user_id", { length: 128 }),
  // packages/shared lab-order-status.js owns the vocabulary and every move.
  status: varchar("status", { length: 30 }).notNull().default("received"),
  // Where an on_hold order resumes.
  heldFrom: varchar("held_from", { length: 30 }),
  departmentId: varchar("department_id", { length: 128 }),
  assigneeUserId: varchar("assignee_user_id", { length: 128 }),
  dueDate: date("due_date", { mode: "string" }),
  rush: boolean("rush").notNull().default(false),
  rushTier: varchar("rush_tier", { length: 40 }),
  isRemake: boolean("is_remake").notNull().default(false),
  remakeOfOrderId: varchar("remake_of_order_id", { length: 128 }),
  // Encrypted free text (see header).
  holdReason: text("hold_reason"),
  labNotes: text("lab_notes"),
  // Optimistic concurrency: every mutation increments it; a client that saw
  // an older version gets 409 "This order changed — reload".
  version: integer("version").notNull().default(1),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  ...stamps,
}, (t) => [
  uniqueIndex("lab_orders_order_number_idx").on(t.orderNumber),
  // One ORIGINAL lab order per case / shop order. Remakes share the source.
  uniqueIndex("lab_orders_source_idx").on(t.source, t.sourceId).where(sql`is_remake = false`),
  index("lab_orders_source_lookup_idx").on(t.source, t.sourceId),
  index("lab_orders_status_idx").on(t.status),
  index("lab_orders_client_idx").on(t.clientUserId),
]);

/** Snapshotted at release: later catalog or case edits never change a job on the bench. */
export const labOrderLines = pgTable("lab_order_lines", {
  id: varchar("id", { length: 128 }).primaryKey(),
  labOrderId: varchar("lab_order_id", { length: 128 }).notNull(),
  position: integer("position").notNull().default(0),
  variantId: varchar("variant_id", { length: 128 }),
  // The lab's product code the bench reads ("2608"). Null on instruction lines.
  code: varchar("code", { length: 60 }),
  name: text("name").notNull(),
  arch: varchar("arch", { length: 20 }),
  qty: integer("qty").notNull().default(1),
  // A build instruction, not a product (rx_case_lines.noteOnly).
  noteOnly: boolean("note_only").notNull().default(false),
  sourceLabel: text("source_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("lab_order_lines_order_idx").on(t.labOrderId)]);

/** Append-only history; drives the timeline. type: status | assign | department | due | note | hold | release */
export const labOrderEvents = pgTable("lab_order_events", {
  id: varchar("id", { length: 128 }).primaryKey(),
  labOrderId: varchar("lab_order_id", { length: 128 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  from: varchar("from_value", { length: 128 }),
  to: varchar("to_value", { length: 128 }),
  // Null for system actions (checkout, auto-release).
  byUserId: varchar("by_user_id", { length: 128 }),
  // Encrypted free text.
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("lab_order_events_order_idx").on(t.labOrderId, t.at)]);
