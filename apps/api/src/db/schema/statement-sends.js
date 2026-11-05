import { pgTable, varchar, char, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// One row per (client, month) statement notice (piece 10, R6). The monthly run
// claims the row (status "sending") BEFORE it emails, so a crash, a retry or a
// double-click can never send the same month twice; a "failed" or "no_email"
// row is re-taken by the next run. The single per-client action re-sends
// explicitly and overwrites sent_at. Service: services/billing/statement-run.service.js.
//   status: sending | sent | failed | no_email
export const STATEMENT_SEND_STATUSES = ["sending", "sent", "failed", "no_email"];

export const statementSends = pgTable("statement_sends", {
  id: varchar("id", { length: 128 }).primaryKey(),
  clientUserId: varchar("client_user_id", { length: 128 }).notNull(),
  month: char("month", { length: 7 }).notNull(), // YYYY-MM
  closingCents: integer("closing_cents"),
  status: varchar("status", { length: 10 }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentBy: varchar("sent_by", { length: 128 }),
  runId: varchar("run_id", { length: 128 }), // null for a single send
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("statement_sends_client_month_idx").on(t.clientUserId, t.month),
]);
