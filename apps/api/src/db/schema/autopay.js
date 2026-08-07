import { sql } from "drizzle-orm";
import { pgTable, varchar, boolean, integer, numeric, timestamp, date, jsonb, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";

export const autopayStatusEnum = pgEnum("autopay_status", ["active", "paused", "completed"]);
export const autopayAttemptStatusEnum = pgEnum("autopay_attempt_status", [
  "skipped",
  "would_charge",
  "succeeded",
  "failed",
]);

/**
 * One enrollment per doctor. ABSENCE of a row means not enrolled — nothing may
 * create rows implicitly (no migration, backfill, seed, or import). `enabled`
 * defaults false so even a created row does not charge until opted in.
 */
export const autopayEnrollments = pgTable("autopay_enrollments", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  dayOfMonth: integer("day_of_month").notNull(),
  paymentProfileId: varchar("payment_profile_id", { length: 100 }).notNull(),
  status: autopayStatusEnum("status").notNull().default("active"),
  pausedReason: varchar("paused_reason", { length: 255 }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  // Admin-set per-doctor floor override. NULL = use AUTOPAY_MIN_AMOUNT.
  minAmountOverride: numeric("min_amount_override", { precision: 12, scale: 2 }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastChargedAt: timestamp("last_charged_at", { withTimezone: true }),
  createdByUserId: varchar("created_by_user_id", { length: 128 }),
  updatedByUserId: varchar("updated_by_user_id", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("autopay_enrollments_user_id_idx").on(table.userId),
  index("autopay_enrollments_enabled_day_idx").on(table.enabled, table.dayOfMonth),
]);

/** One row per doctor per run — the audit trail and the dry-run output. */
export const autopayAttempts = pgTable("autopay_attempts", {
  id: varchar("id", { length: 128 }).primaryKey(),
  enrollmentId: varchar("enrollment_id", { length: 128 }).notNull(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  jobRunId: varchar("job_run_id", { length: 128 }),
  // The cycle this attempt belongs to, e.g. "2026-08" — one success per cycle.
  cycleKey: varchar("cycle_key", { length: 16 }).notNull(),
  scheduledFor: date("scheduled_for").notNull(),
  status: autopayAttemptStatusEnum("status").notNull(),
  amountAttempted: numeric("amount_attempted", { precision: 12, scale: 2 }),
  amountCharged: numeric("amount_charged", { precision: 12, scale: 2 }),
  transactionId: varchar("transaction_id", { length: 100 }),
  allocations: jsonb("allocations"),
  failureReason: varchar("failure_reason", { length: 500 }),
  dryRun: boolean("dry_run").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("autopay_attempts_enrollment_idx").on(table.enrollmentId),
  index("autopay_attempts_user_idx").on(table.userId),
  index("autopay_attempts_cycle_idx").on(table.enrollmentId, table.cycleKey),
  index("autopay_attempts_job_run_idx").on(table.jobRunId),
  // CRITICAL 2 — DB-level backstop for "at most one successful, real charge
  // per doctor per cycle." Keyed on user_id (NOT enrollment_id) so it holds
  // across a delete-and-re-enroll within the same month, which mints a new
  // enrollment_id and would otherwise dodge a guard scoped to the old one.
  // The application-level check in autopay-runner.service.js (a fresh read
  // inside the per-invoice lock, right before charging) is the primary
  // guard; this partial unique index is what makes a violation impossible
  // even under a bug or a race the application check missed — Postgres
  // rejects the second `succeeded, dry_run=false` row outright rather than
  // relying on app code never getting it wrong twice in the same millisecond.
  uniqueIndex("autopay_attempts_user_cycle_success_idx")
    .on(table.userId, table.cycleKey)
    .where(sql`status = 'succeeded' AND dry_run = false`),
]);
