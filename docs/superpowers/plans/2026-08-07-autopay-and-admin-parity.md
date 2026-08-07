# AutoPay + Admin Payment Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let doctors enroll in AutoPay (a fixed monthly amount charged to a card on file until their invoices are paid off), give admins the same abilities on behalf of any doctor plus oversight, and build the repo's first scheduled-job subsystem to run it.

**Architecture:** A provider-agnostic job registry (`apps/api/src/jobs/`) where a job is a named async function and the trigger is a swappable adapter — Cloud Run Job in production, in-process tick in dev. AutoPay is its first consumer. All charging reuses the existing spine (`verifyAllocations` → `withInvoiceLocks` → `withIdempotency` → `chargeCustomerProfile` → `recordPaymentAndAllocations`) with the target doctor loaded from the DB instead of `request.user`.

**Tech Stack:** Fastify v5, Drizzle ORM (PostgreSQL), Zod (via `@my-app/shared`), Vitest, React + Vite, Authorize.net CIM (hosted iframe only), Seazona REST.

## Global Constraints

- **Nobody is enrolled and nothing charges in this phase.** No migration, backfill, seed, or import may create an `autopay_enrollments` row. `enabled` defaults `false`. `AUTOPAY_LIVE_RUN` defaults `false`.
- **`AUTOPAY_MIN_AMOUNT` default `200`** (dollars). `AUTOPAY_TIMEZONE` default `America/Chicago`. `AUTOPAY_MAX_FAILURES` default `3`.
- **Enrollment requires a card on file** — validated server-side against the gateway on both doctor and admin routes.
- **All new card entry uses the hosted Authorize.net iframe.** Accept.js is inert in production (`apps/api/Dockerfile:22-25` declares the `VITE_AUTHORIZE_NET_*` args; `cloudbuild.yaml` passes no `--build-arg`). Never add a form that touches a PAN in our DOM.
- **Seazona must be called serially with ~110 ms spacing.** Concurrency 8 failed 448/476 requests.
- **Never refactor the Seazona payment write into per-invoice payments.** One account-level `createPayment` per charge, or reconciliation breaks.
- **Money guards fail closed.** Use `getInvoicePortalPaidStrict`, never `getInvoicePortalPaid`, for any cap.
- **Every new admin route gets an explicit authorization test.** `/payments/test/*` shipped guard-less; do not trust, verify.
- Branch: `feat/autopay-and-admin-parity`, stacked on `fix/security-critical-auth-payments` (PR #36).
- Run tests with `pnpm --filter @my-app/api test`. Migrations: `cd apps/api && pnpm db:generate && pnpm db:migrate`.

---

## File Structure

**Create:**
- `apps/api/src/db/schema/autopay.js` — `autopayEnrollments`, `autopayAttempts` tables + enums
- `apps/api/src/db/schema/job-runs.js` — `jobRuns` table + enums
- `apps/api/src/lib/autopay-allocation.js` — pure allocation maths (oldest-first, payoff rule)
- `apps/api/src/lib/autopay-allocation.test.js`
- `apps/api/src/lib/autopay-schedule.js` — day-of-month clamping, next-run, cycle keys
- `apps/api/src/lib/autopay-schedule.test.js`
- `apps/api/src/jobs/registry.js` — `defineJob`, `getJob`, `listJobs`
- `apps/api/src/jobs/runner.js` — `runJob` lifecycle + per-job lock
- `apps/api/src/jobs/runner.test.js`
- `apps/api/src/jobs/cli.js` — Cloud Run Job entrypoint
- `apps/api/src/jobs/triggers/http.js` — `/internal/jobs/:name/run`
- `apps/api/src/jobs/triggers/interval.js` — dev-only tick
- `apps/api/src/jobs/definitions/autopay.job.js` — the sweep
- `apps/api/src/jobs/definitions/autopay.job.test.js`
- `apps/api/src/services/autopay.service.js` — enrollment CRUD + validation
- `apps/api/src/services/autopay.service.test.js`
- `apps/api/src/services/card.service.js` — `ensureCustomerProfile`, `listCardsForUser`, shared by doctor + admin
- `apps/api/src/services/payment-recording.service.js` — `verifyAllocations` + `recordPaymentAndAllocations`, moved out of the route file so services and jobs can use them
- `apps/api/src/routes/autopay.routes.js` — doctor routes
- `apps/api/src/routes/admin-payment.routes.js` — admin cards, charge, autopay
- `apps/api/src/routes/__tests__/admin-payment.authz.test.js`
- `apps/api/src/routes/__tests__/autopay.schema.test.js`
- `apps/api/src/db/backfill-payment-source.js` — one-off backfill
- `packages/shared/src/schemas/autopay.schema.js`
- `apps/web/src/pages/doctor/AutoPayPage.jsx`
- `apps/web/src/pages/app/AdminAutoPayPage.jsx`
- `apps/web/src/pages/app/AdminJobsPage.jsx`
- `apps/web/src/components/admin/DoctorPaymentDrawer.jsx`

**Modify:**
- `apps/api/src/config/env.js` — AutoPay + jobs config
- `apps/api/src/db/schema/index.js` — export new tables
- `apps/api/src/db/schema/invoice-payments.js` — add `source`
- `apps/api/src/db/schema/users.js` — index `seazonaClientId`
- `apps/api/src/routes/payment.routes.js` — extract `ensureCustomerProfile`, pass `source`
- `apps/api/src/routes/invoice.routes.js` — pass `source`, fix `/admin/invoices` balances
- `apps/api/src/index.js` — register new routes + dev trigger
- `apps/api/src/services/email.service.js` — decline + pause notices
- `packages/shared/src/index.js`, `apps/web/src/App.jsx`, `apps/web/src/config/routes.js`
- `cloudbuild.yaml` — jobs Cloud Run Job

---

## Task 1: Schema — AutoPay tables, job runs, payment source

**Files:**
- Create: `apps/api/src/db/schema/autopay.js`, `apps/api/src/db/schema/job-runs.js`
- Modify: `apps/api/src/db/schema/index.js`, `apps/api/src/db/schema/invoice-payments.js`, `apps/api/src/db/schema/users.js`

**Interfaces:**
- Produces: `autopayEnrollments`, `autopayAttempts`, `jobRuns` Drizzle tables; `invoicePayments.source` column; `users_seazona_client_id_idx`.

- [ ] **Step 1: Create `apps/api/src/db/schema/autopay.js`**

```js
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
]);
```

- [ ] **Step 2: Create `apps/api/src/db/schema/job-runs.js`**

```js
import { pgTable, varchar, boolean, timestamp, jsonb, text, pgEnum, index } from "drizzle-orm/pg-core";

export const jobRunStatusEnum = pgEnum("job_run_status", ["running", "succeeded", "failed"]);
export const jobRunTriggerEnum = pgEnum("job_run_trigger", ["schedule", "manual", "interval", "cli"]);

export const jobRuns = pgTable("job_runs", {
  id: varchar("id", { length: 128 }).primaryKey(),
  jobName: varchar("job_name", { length: 100 }).notNull(),
  trigger: jobRunTriggerEnum("trigger").notNull(),
  status: jobRunStatusEnum("status").notNull().default("running"),
  dryRun: boolean("dry_run").notNull().default(true),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  summary: jsonb("summary"),
  error: text("error"),
  actorUserId: varchar("actor_user_id", { length: 128 }),
}, (table) => [
  index("job_runs_job_name_idx").on(table.jobName),
  index("job_runs_started_at_idx").on(table.startedAt),
]);
```

- [ ] **Step 3: Add `source` to `invoice_payments`**

In `apps/api/src/db/schema/invoice-payments.js`, add after `refundsTransactionId`:

```js
  // Payment origin. Additive and nullable: existing rows stay NULL and
  // summarizePayments is unaffected. Before this, origin was encoded only in a
  // transactionId prefix (OFFLINE-, REFUND-PENDING-), which made AutoPay charges
  // indistinguishable from manual ones in every admin view.
  // Values: doctor_card | doctor_hosted | admin_offline | admin_card | autopay | refund
  source: varchar("source", { length: 32 }),
```

- [ ] **Step 4: Index `users.seazonaClientId`**

In `apps/api/src/db/schema/users.js`, add to the index array:

```js
  index("users_seazona_client_id_idx").on(table.seazonaClientId),
```

Ensure `index` is imported from `drizzle-orm/pg-core`.

- [ ] **Step 5: Export from `apps/api/src/db/schema/index.js`**

```js
export { autopayEnrollments, autopayAttempts, autopayStatusEnum, autopayAttemptStatusEnum } from "./autopay.js";
export { jobRuns, jobRunStatusEnum, jobRunTriggerEnum } from "./job-runs.js";
```

- [ ] **Step 6: Generate and apply the migration**

```bash
cd apps/api && pnpm db:generate && pnpm db:migrate
```

Expected: a new `00NN_*.sql` in `apps/api/src/db/migrations/` creating three tables, four enums, one column, and the indexes. **Read the generated SQL** and confirm it contains no `INSERT` — nothing may create an enrollment.

- [ ] **Step 7: Verify the schema landed**

```bash
psql "$DATABASE_URL" -c "\d autopay_enrollments" -c "\d autopay_attempts" -c "\d job_runs"
psql "$DATABASE_URL" -c "select count(*) from autopay_enrollments;"
```

Expected: tables exist; count is **0**.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/schema apps/api/src/db/migrations
git commit -m "feat(autopay): schema for enrollments, attempts, job runs, payment source"
```

---

## Task 2: Environment configuration

**Files:**
- Modify: `apps/api/src/config/env.js`, `.env.example`

**Interfaces:**
- Produces: `env.AUTOPAY_LIVE_RUN` (boolean), `env.AUTOPAY_MIN_AMOUNT` (number), `env.AUTOPAY_TIMEZONE` (string), `env.AUTOPAY_MAX_FAILURES` (number), `env.JOBS_TRIGGER_SECRET` (string|undefined).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/config/env.autopay.test.js`:

```js
import { describe, it, expect } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { env } = await import("./env.js");

describe("AutoPay configuration defaults", () => {
  it("defaults AUTOPAY_LIVE_RUN to false so the sweep cannot charge", () => {
    expect(env.AUTOPAY_LIVE_RUN).toBe(false);
  });

  it("defaults the enrollment floor to $200", () => {
    expect(env.AUTOPAY_MIN_AMOUNT).toBe(200);
  });

  it("defaults the timezone to lab time", () => {
    expect(env.AUTOPAY_TIMEZONE).toBe("America/Chicago");
  });

  it("defaults the failure threshold to 3", () => {
    expect(env.AUTOPAY_MAX_FAILURES).toBe(3);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @my-app/api exec vitest run src/config/env.autopay.test.js`
Expected: FAIL — `expected undefined to be false`.

- [ ] **Step 3: Add the schema entries**

In `apps/api/src/config/env.js`, inside `envSchema`, after the Authorize.net block:

```js
  // ── AutoPay ──
  // LIVE-CHARGE GATE. When false (the default) the sweep resolves balances,
  // computes allocations, and records what it WOULD charge — without touching a
  // card. Same gated-dark pattern as RX_LIVE_PUSH. Flip only after reading a
  // dry run's `would_charge` attempts.
  AUTOPAY_LIVE_RUN: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // Enrollment floor in dollars. An admin may override it per doctor.
  AUTOPAY_MIN_AMOUNT: z.coerce.number().positive().default(200),
  // What "the 15th" means. The lab is in San Antonio.
  AUTOPAY_TIMEZONE: z.string().default("America/Chicago"),
  // Consecutive declines before an enrollment is paused.
  AUTOPAY_MAX_FAILURES: z.coerce.number().int().positive().default(3),
  // Shared secret for the HTTP job trigger. Required in production only.
  JOBS_TRIGGER_SECRET: z.string().optional(),
```

- [ ] **Step 4: Run the test again**

Run: `pnpm --filter @my-app/api exec vitest run src/config/env.autopay.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Document in `.env.example`**

```
# ── AutoPay ──
# false = compute and record, charge nothing. Flip only after reviewing a dry run.
AUTOPAY_LIVE_RUN=false
AUTOPAY_MIN_AMOUNT=200
AUTOPAY_TIMEZONE=America/Chicago
AUTOPAY_MAX_FAILURES=3
# Shared secret Cloud Scheduler presents to the HTTP job trigger.
JOBS_TRIGGER_SECRET=
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/env.js apps/api/src/config/env.autopay.test.js .env.example
git commit -m "feat(autopay): configuration with live-run gated off by default"
```

---

## Task 3: Allocation maths

**Files:**
- Create: `apps/api/src/lib/autopay-allocation.js`, `apps/api/src/lib/autopay-allocation.test.js`

**Interfaces:**
- Produces: `allocateOldestFirst(invoices, chargeAmount) -> { allocations: Array<{invoiceId, invoiceNumber, amount}>, totalAllocated: number }` and `resolveChargeAmount({ enrolledAmount, totalBalance }) -> number`.
- `invoices` items: `{ id, invoiceNumber, balance, dueDate }`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { allocateOldestFirst, resolveChargeAmount } from "./autopay-allocation.js";

const inv = (id, balance, dueDate, invoiceNumber = `IN-${id}`) => ({ id, balance, dueDate, invoiceNumber });

describe("resolveChargeAmount", () => {
  it("charges the enrolled amount when the balance exceeds it", () => {
    expect(resolveChargeAmount({ enrolledAmount: 500, totalBalance: 1200 })).toBe(500);
  });

  // The payoff rule: the floor governs ENROLLMENT, not the final payment.
  // A $500 enrollment against a $180 balance charges $180 and completes, even
  // though $180 is under AUTOPAY_MIN_AMOUNT.
  it("charges only the remaining balance when it is below the enrolled amount", () => {
    expect(resolveChargeAmount({ enrolledAmount: 500, totalBalance: 180 })).toBe(180);
  });

  it("returns 0 when nothing is owed", () => {
    expect(resolveChargeAmount({ enrolledAmount: 500, totalBalance: 0 })).toBe(0);
  });

  it("never returns a negative amount", () => {
    expect(resolveChargeAmount({ enrolledAmount: 500, totalBalance: -12 })).toBe(0);
  });

  it("rounds to cents", () => {
    expect(resolveChargeAmount({ enrolledAmount: 500, totalBalance: 180.005 })).toBe(180.01);
  });
});

describe("allocateOldestFirst", () => {
  it("fills the oldest invoice first, then spills into the next", () => {
    const { allocations, totalAllocated } = allocateOldestFirst(
      [inv("b", 300, "2026-03-01"), inv("a", 200, "2026-01-01"), inv("c", 400, "2026-05-01")],
      600
    );
    expect(allocations).toEqual([
      { invoiceId: "a", invoiceNumber: "IN-a", amount: 200 },
      { invoiceId: "b", invoiceNumber: "IN-b", amount: 300 },
      { invoiceId: "c", invoiceNumber: "IN-c", amount: 100 },
    ]);
    expect(totalAllocated).toBe(600);
  });

  it("stops at the total balance when the charge exceeds it", () => {
    const { allocations, totalAllocated } = allocateOldestFirst(
      [inv("a", 50, "2026-01-01"), inv("b", 25, "2026-02-01")],
      500
    );
    expect(totalAllocated).toBe(75);
    expect(allocations).toHaveLength(2);
  });

  it("omits invoices that receive nothing", () => {
    const { allocations } = allocateOldestFirst(
      [inv("a", 200, "2026-01-01"), inv("b", 300, "2026-02-01")],
      200
    );
    expect(allocations).toEqual([{ invoiceId: "a", invoiceNumber: "IN-a", amount: 200 }]);
  });

  it("skips zero and negative balances", () => {
    const { allocations } = allocateOldestFirst(
      [inv("a", 0, "2026-01-01"), inv("b", -5, "2026-02-01"), inv("c", 100, "2026-03-01")],
      100
    );
    expect(allocations).toEqual([{ invoiceId: "c", invoiceNumber: "IN-c", amount: 100 }]);
  });

  it("returns nothing for a zero charge", () => {
    expect(allocateOldestFirst([inv("a", 100, "2026-01-01")], 0)).toEqual({
      allocations: [],
      totalAllocated: 0,
    });
  });

  it("does not drift on cent-level splits", () => {
    const { allocations, totalAllocated } = allocateOldestFirst(
      [inv("a", 33.33, "2026-01-01"), inv("b", 33.33, "2026-02-01"), inv("c", 33.34, "2026-03-01")],
      100
    );
    expect(totalAllocated).toBe(100);
    expect(allocations.reduce((s, a) => s + a.amount, 0)).toBe(100);
  });

  it("orders by due date, falling back to invoice number when dates tie", () => {
    const { allocations } = allocateOldestFirst(
      [inv("b", 100, "2026-01-01", "IN-2"), inv("a", 100, "2026-01-01", "IN-1")],
      100
    );
    expect(allocations[0].invoiceNumber).toBe("IN-1");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @my-app/api exec vitest run src/lib/autopay-allocation.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```js
/** Round to cents consistently (avoids FP drift). */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * How much this cycle actually charges.
 *
 * The payoff rule: AUTOPAY_MIN_AMOUNT governs what a doctor may ENROLL at, not
 * what the final payment may be. If the outstanding balance is less than the
 * enrolled amount — even less than the floor — we charge the balance and close
 * the account out rather than stranding money that can never be collected.
 */
export function resolveChargeAmount({ enrolledAmount, totalBalance }) {
  const balance = round2(totalBalance);
  if (!(balance > 0)) return 0;
  return round2(Math.min(round2(enrolledAmount), balance));
}

/**
 * Spread `chargeAmount` across open invoices, oldest first, spilling into the
 * next once one is filled. Standard AR convention, and the same ordering the
 * doctor-facing pay modal already uses.
 *
 * @param {Array<{id: string, invoiceNumber?: string|number, balance: number, dueDate?: string}>} invoices
 * @param {number} chargeAmount
 * @returns {{allocations: Array<{invoiceId: string, invoiceNumber: string|null, amount: number}>, totalAllocated: number}}
 */
export function allocateOldestFirst(invoices, chargeAmount) {
  let remaining = round2(chargeAmount);
  if (!(remaining > 0)) return { allocations: [], totalAllocated: 0 };

  const ordered = [...(invoices || [])]
    .filter((i) => round2(i.balance) > 0)
    .sort((a, b) => {
      const da = a.dueDate ? String(a.dueDate) : "";
      const db = b.dueDate ? String(b.dueDate) : "";
      if (da !== db) return da < db ? -1 : 1;
      // Deterministic tiebreak so a run is reproducible.
      return String(a.invoiceNumber ?? a.id) < String(b.invoiceNumber ?? b.id) ? -1 : 1;
    });

  const allocations = [];
  for (const invoice of ordered) {
    if (remaining <= 0) break;
    const amount = round2(Math.min(round2(invoice.balance), remaining));
    if (amount <= 0) continue;
    allocations.push({
      invoiceId: String(invoice.id),
      invoiceNumber: invoice.invoiceNumber != null ? String(invoice.invoiceNumber) : null,
      amount,
    });
    remaining = round2(remaining - amount);
  }

  const totalAllocated = round2(allocations.reduce((sum, a) => sum + a.amount, 0));
  return { allocations, totalAllocated };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @my-app/api exec vitest run src/lib/autopay-allocation.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/autopay-allocation.js apps/api/src/lib/autopay-allocation.test.js
git commit -m "feat(autopay): oldest-first allocation with payoff rule"
```

---

## Task 4: Schedule maths

**Files:**
- Create: `apps/api/src/lib/autopay-schedule.js`, `apps/api/src/lib/autopay-schedule.test.js`

**Interfaces:**
- Produces: `resolveChargeDay(year, month, dayOfMonth) -> number`, `isDueOn(dayOfMonth, date, timeZone) -> boolean`, `cycleKeyFor(date, timeZone) -> string` (e.g. `"2026-08"`), `zonedParts(date, timeZone) -> { year, month, day }`.
- `month` is 1-based throughout.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { resolveChargeDay, isDueOn, cycleKeyFor, zonedParts } from "./autopay-schedule.js";

const TZ = "America/Chicago";

describe("resolveChargeDay", () => {
  it("returns the chosen day when the month is long enough", () => {
    expect(resolveChargeDay(2026, 8, 15)).toBe(15);
  });

  it("clamps the 31st to February 28 in a common year", () => {
    expect(resolveChargeDay(2026, 2, 31)).toBe(28);
  });

  it("clamps the 31st to February 29 in a leap year", () => {
    expect(resolveChargeDay(2028, 2, 31)).toBe(29);
  });

  it("clamps the 31st to 30 in a 30-day month", () => {
    expect(resolveChargeDay(2026, 4, 31)).toBe(30);
  });

  it("leaves the 1st alone", () => {
    expect(resolveChargeDay(2026, 2, 1)).toBe(1);
  });
});

describe("isDueOn", () => {
  it("is due on the matching day in lab time", () => {
    expect(isDueOn(15, new Date("2026-08-15T12:00:00Z"), TZ)).toBe(true);
  });

  it("is not due on a different day", () => {
    expect(isDueOn(15, new Date("2026-08-16T12:00:00Z"), TZ)).toBe(false);
  });

  // 2026-08-15T02:00Z is still 2026-08-14 21:00 in Chicago. "The 15th" must
  // mean the 15th at the lab, not in UTC, or a whole cohort charges a day early.
  it("uses lab time, not UTC, at the day boundary", () => {
    expect(isDueOn(15, new Date("2026-08-15T02:00:00Z"), TZ)).toBe(false);
    expect(isDueOn(14, new Date("2026-08-15T02:00:00Z"), TZ)).toBe(true);
  });

  it("fires on the clamped day for a doctor who chose the 31st", () => {
    expect(isDueOn(31, new Date("2026-02-28T15:00:00Z"), TZ)).toBe(true);
  });

  it("does not fire twice when the month has 31 days", () => {
    expect(isDueOn(31, new Date("2026-03-28T15:00:00Z"), TZ)).toBe(false);
    expect(isDueOn(31, new Date("2026-03-31T15:00:00Z"), TZ)).toBe(true);
  });
});

describe("cycleKeyFor", () => {
  it("returns a year-month key in lab time", () => {
    expect(cycleKeyFor(new Date("2026-08-15T12:00:00Z"), TZ)).toBe("2026-08");
  });

  it("zero-pads single-digit months", () => {
    expect(cycleKeyFor(new Date("2026-03-02T12:00:00Z"), TZ)).toBe("2026-03");
  });

  it("attributes a UTC-rollover instant to the lab's month", () => {
    expect(cycleKeyFor(new Date("2026-09-01T03:00:00Z"), TZ)).toBe("2026-08");
  });
});

describe("zonedParts", () => {
  it("extracts lab-local calendar parts", () => {
    expect(zonedParts(new Date("2026-08-15T02:00:00Z"), TZ)).toEqual({ year: 2026, month: 8, day: 14 });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @my-app/api exec vitest run src/lib/autopay-schedule.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```js
/**
 * Calendar maths for AutoPay, evaluated in the LAB's timezone.
 *
 * Uses Intl rather than a date library — the repo has no date dependency and
 * this needs exactly one thing: what day is it where the lab is. Doing this in
 * UTC would charge a whole cohort a day early for any run before ~05:00 UTC.
 */

/** Lab-local calendar parts for an instant. `month` is 1-based. */
export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

/** Days in a 1-based month. Day 0 of the next month is the last of this one. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The day this month that a `dayOfMonth` preference actually charges on.
 * A doctor who picked the 31st is charged on Feb 28 (29 in a leap year) rather
 * than skipped — otherwise short months would silently miss a cycle.
 */
export function resolveChargeDay(year, month, dayOfMonth) {
  return Math.min(Number(dayOfMonth), daysInMonth(year, month));
}

/** Is an enrollment due on this instant, in lab time? */
export function isDueOn(dayOfMonth, date, timeZone) {
  const { year, month, day } = zonedParts(date, timeZone);
  return day === resolveChargeDay(year, month, dayOfMonth);
}

/**
 * The billing cycle an instant belongs to, e.g. "2026-08". One successful
 * charge per enrollment per cycle — this is the idempotency anchor.
 */
export function cycleKeyFor(date, timeZone) {
  const { year, month } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @my-app/api exec vitest run src/lib/autopay-schedule.test.js`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/autopay-schedule.js apps/api/src/lib/autopay-schedule.test.js
git commit -m "feat(autopay): day-of-month clamping and cycle keys in lab time"
```

---

## Task 5: Job registry and runner

**Files:**
- Create: `apps/api/src/jobs/registry.js`, `apps/api/src/jobs/runner.js`, `apps/api/src/jobs/runner.test.js`

**Interfaces:**
- Consumes: `jobRuns` (Task 1), `redis` from `apps/api/src/config/redis.js`.
- Produces:
  - `defineJob({ name, description, handler }) -> void`; handler signature `({ dryRun, log, runId }) => Promise<object>` (the resolved object becomes `job_runs.summary`).
  - `getJob(name) -> job | undefined`, `listJobs() -> Array<{name, description}>`, `clearRegistry()` (tests only).
  - `runJob(name, { dryRun = true, trigger = "manual", actorUserId = null, log }) -> Promise<{ runId, status, summary, error }>`.
  - `JobLockedError` (exported class).

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const inserted = [];
const updated = [];
vi.mock("../config/database.js", () => ({
  db: {
    insert: () => ({ values: async (v) => { inserted.push(v); } }),
    update: () => ({ set: (v) => ({ where: async () => { updated.push(v); } }) }),
  },
}));

const store = new Map();
vi.mock("../config/redis.js", () => ({
  redis: {
    async set(key, val, _ex, _ttl, nx) {
      if (nx && store.has(key)) return null;
      store.set(key, val);
      return "OK";
    },
    async del(key) { store.delete(key); return 1; },
    async get(key) { return store.get(key) ?? null; },
  },
}));

const { defineJob, getJob, listJobs, clearRegistry } = await import("./registry.js");
const { runJob, JobLockedError } = await import("./runner.js");

beforeEach(() => {
  clearRegistry();
  inserted.length = 0;
  updated.length = 0;
  store.clear();
});

describe("registry", () => {
  it("registers and retrieves a job", () => {
    const handler = async () => ({ ok: true });
    defineJob({ name: "demo", description: "d", handler });
    expect(getJob("demo").handler).toBe(handler);
    expect(listJobs()).toEqual([{ name: "demo", description: "d" }]);
  });

  it("rejects a duplicate name", () => {
    defineJob({ name: "demo", description: "d", handler: async () => ({}) });
    expect(() => defineJob({ name: "demo", description: "d", handler: async () => ({}) })).toThrow(/already registered/i);
  });

  it("rejects a job with no handler", () => {
    expect(() => defineJob({ name: "x", description: "d" })).toThrow(/handler/i);
  });
});

describe("runJob", () => {
  it("records a run row and returns the handler summary", async () => {
    defineJob({ name: "demo", description: "d", handler: async () => ({ charged: 0 }) });
    const result = await runJob("demo", { dryRun: true, trigger: "manual" });

    expect(result.status).toBe("succeeded");
    expect(result.summary).toEqual({ charged: 0 });
    expect(inserted[0]).toMatchObject({ jobName: "demo", trigger: "manual", dryRun: true, status: "running" });
    expect(updated[0]).toMatchObject({ status: "succeeded" });
  });

  it("passes dryRun through to the handler", async () => {
    let seen;
    defineJob({ name: "demo", description: "d", handler: async (ctx) => { seen = ctx.dryRun; return {}; } });
    await runJob("demo", { dryRun: false, trigger: "cli" });
    expect(seen).toBe(false);
  });

  it("defaults to a dry run when not told otherwise", async () => {
    let seen;
    defineJob({ name: "demo", description: "d", handler: async (ctx) => { seen = ctx.dryRun; return {}; } });
    await runJob("demo");
    expect(seen).toBe(true);
  });

  it("records failure without throwing into the trigger", async () => {
    defineJob({ name: "boom", description: "d", handler: async () => { throw new Error("kaboom"); } });
    const result = await runJob("boom", { trigger: "schedule" });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/kaboom/);
    expect(updated[0]).toMatchObject({ status: "failed" });
  });

  it("throws for an unknown job", async () => {
    await expect(runJob("nope")).rejects.toThrow(/unknown job/i);
  });

  it("refuses to run the same job concurrently", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    defineJob({ name: "slow", description: "d", handler: async () => { await gate; return {}; } });

    const first = runJob("slow", { trigger: "schedule" });
    await expect(runJob("slow", { trigger: "manual" })).rejects.toThrow(JobLockedError);
    release();
    await first;
  });

  it("releases the lock after a run so the next one can proceed", async () => {
    defineJob({ name: "demo", description: "d", handler: async () => ({}) });
    await runJob("demo");
    await expect(runJob("demo")).resolves.toMatchObject({ status: "succeeded" });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @my-app/api exec vitest run src/jobs/runner.test.js`
Expected: FAIL — cannot find module `./registry.js`.

- [ ] **Step 3: Implement the registry**

```js
/**
 * Job registry — deliberately knows nothing about how a job is triggered.
 *
 * A job is a named async function. Cloud Run Jobs, Cloud Scheduler, an HTTP
 * call, and a dev-only interval are all just callers of runJob(). Swapping
 * execution providers means writing a new trigger adapter, not touching jobs.
 */
const jobs = new Map();

export function defineJob({ name, description, handler }) {
  if (!name) throw new Error("defineJob requires a name");
  if (typeof handler !== "function") throw new Error(`defineJob("${name}") requires a handler function`);
  if (jobs.has(name)) throw new Error(`Job "${name}" is already registered`);
  jobs.set(name, { name, description: description || "", handler });
}

export function getJob(name) {
  return jobs.get(name);
}

export function listJobs() {
  return [...jobs.values()].map(({ name, description }) => ({ name, description }));
}

/** Test-only: reset registration between cases. */
export function clearRegistry() {
  jobs.clear();
}
```

- [ ] **Step 4: Implement the runner**

```js
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { jobRuns } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { getJob } from "./registry.js";

const JOB_LOCK_TTL = 60 * 60; // 1h — longer than any sweep should take

export class JobLockedError extends Error {
  constructor(name) {
    super(`Job "${name}" is already running`);
    this.name = "JobLockedError";
  }
}

/**
 * Run a registered job, recording its lifecycle in `job_runs`.
 *
 * Never throws for a handler failure — a trigger (Cloud Scheduler, an admin
 * click) should get a recorded outcome, not a stack trace. It DOES throw for
 * programmer errors: unknown job, or a concurrent run.
 *
 * The lock is kv_store-backed, and because config/redis.js is Postgres-backed
 * that makes it durable and multi-instance-safe — two overlapping invocations
 * cannot both sweep.
 */
export async function runJob(name, { dryRun = true, trigger = "manual", actorUserId = null, log } = {}) {
  const job = getJob(name);
  if (!job) throw new Error(`Unknown job "${name}"`);

  const lockKey = `job:lock:${name}`;
  const locked = await redis.set(lockKey, "1", "EX", JOB_LOCK_TTL, "NX");
  if (!locked) throw new JobLockedError(name);

  const runId = createId();
  await db.insert(jobRuns).values({
    id: runId,
    jobName: name,
    trigger,
    status: "running",
    dryRun,
    actorUserId,
  });

  try {
    const summary = (await job.handler({ dryRun, log, runId })) ?? {};
    await db
      .update(jobRuns)
      .set({ status: "succeeded", finishedAt: new Date(), summary })
      .where(eq(jobRuns.id, runId));
    return { runId, status: "succeeded", summary, error: null };
  } catch (err) {
    const message = err?.stack || err?.message || String(err);
    await db
      .update(jobRuns)
      .set({ status: "failed", finishedAt: new Date(), error: message })
      .where(eq(jobRuns.id, runId));
    log?.error?.({ err, job: name }, "job failed");
    return { runId, status: "failed", summary: null, error: message };
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @my-app/api exec vitest run src/jobs/runner.test.js`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/jobs
git commit -m "feat(jobs): provider-agnostic job registry and runner"
```

---

## Task 6: Job triggers — CLI, HTTP, dev interval

**Files:**
- Create: `apps/api/src/jobs/cli.js`, `apps/api/src/jobs/triggers/http.js`, `apps/api/src/jobs/triggers/interval.js`, `apps/api/src/jobs/definitions/index.js`
- Modify: `apps/api/src/index.js`, `apps/api/package.json`

**Interfaces:**
- Consumes: `runJob`, `listJobs`, `JobLockedError` (Task 5).
- Produces: `registerJobTriggerRoutes(fastify)`, `startIntervalTrigger({ log })`, `registerAllJobs()`, npm script `jobs:run`.

- [ ] **Step 1: Create the definitions barrel**

`apps/api/src/jobs/definitions/index.js` — the single place jobs get registered, so every trigger sees the same set:

```js
import "./autopay.job.js";

/** Importing this module registers every job. Kept as a function for clarity
 *  at call sites and so tests can assert it was invoked. */
export function registerAllJobs() {
  // Registration happens via the imports above (defineJob runs at module load).
}
```

Note: `autopay.job.js` arrives in Task 12. Until then create it as a stub that registers a job returning `{ pending: true }`, so triggers are testable now:

```js
// apps/api/src/jobs/definitions/autopay.job.js  (temporary — replaced in Task 12)
import { defineJob } from "../registry.js";

defineJob({
  name: "autopay",
  description: "Charge enrolled doctors their monthly AutoPay amount",
  handler: async () => ({ pending: true }),
});
```

- [ ] **Step 2: Create the CLI entrypoint**

`apps/api/src/jobs/cli.js` — what the Cloud Run Job executes:

```js
/**
 * Job CLI — the entrypoint the Cloud Run Job executes.
 *
 *   node src/jobs/cli.js autopay             # dry run (default)
 *   node src/jobs/cli.js autopay --live      # actually charge
 *   node src/jobs/cli.js --list
 *
 * Exits non-zero on failure so Cloud Run marks the execution failed.
 */
import { registerAllJobs } from "./definitions/index.js";
import { runJob } from "./runner.js";
import { listJobs } from "./registry.js";

registerAllJobs();

const args = process.argv.slice(2);

if (args.includes("--list") || args.length === 0) {
  for (const job of listJobs()) console.log(`${job.name}\t${job.description}`);
  process.exit(0);
}

const name = args[0];
// Dry run is the default. Charging requires BOTH --live here and
// AUTOPAY_LIVE_RUN=true in the environment — two independent switches.
const dryRun = !args.includes("--live");

const result = await runJob(name, { dryRun, trigger: "cli" });
console.log(JSON.stringify({ job: name, ...result }, null, 2));
process.exit(result.status === "succeeded" ? 0 : 1);
```

- [ ] **Step 3: Add the npm script**

In `apps/api/package.json` scripts:

```json
    "jobs:run": "node --env-file=.env src/jobs/cli.js",
```

- [ ] **Step 4: Create the HTTP trigger**

`apps/api/src/jobs/triggers/http.js`:

```js
import { runJob, JobLockedError } from "../runner.js";
import { listJobs } from "../registry.js";
import { env } from "../../config/env.js";

/**
 * HTTP trigger for schedulers that invoke over the network.
 *
 * Guarded by a shared secret rather than session auth — the caller is Cloud
 * Scheduler, not a person. Mounted OUTSIDE /api/v1 under /internal so it is
 * never confused with the public API surface.
 */
export function registerJobTriggerRoutes(fastify) {
  fastify.post("/internal/jobs/:name/run", async (request, reply) => {
    const secret = env.JOBS_TRIGGER_SECRET;
    if (!secret) {
      return reply.code(503).send({ error: { code: "TRIGGER_DISABLED", message: "Job trigger is not configured." } });
    }
    const presented = request.headers["x-jobs-trigger-secret"];
    // Length-independent comparison is unnecessary here (the secret is not
    // user-derived), but a strict equality check on a missing header must fail.
    if (!presented || presented !== secret) {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid trigger secret." } });
    }

    const name = String(request.params.name);
    // Dry run unless explicitly told otherwise, so a misconfigured scheduler
    // cannot charge anyone.
    const dryRun = request.body?.dryRun !== false;

    try {
      const result = await runJob(name, { dryRun, trigger: "schedule", log: request.log });
      return { data: result };
    } catch (err) {
      if (err instanceof JobLockedError) {
        return reply.code(409).send({ error: { code: "JOB_RUNNING", message: err.message } });
      }
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: err.message } });
    }
  });

  fastify.get("/internal/jobs", async () => ({ data: { jobs: listJobs() } }));
}
```

- [ ] **Step 5: Create the dev interval trigger**

`apps/api/src/jobs/triggers/interval.js`:

```js
import { runJob, JobLockedError } from "../runner.js";
import { env } from "../../config/env.js";

const TICK_MS = 60 * 1000;

/**
 * In-process trigger for LOCAL DEVELOPMENT ONLY.
 *
 * Never registered in production: a setInterval inside the API breaks with more
 * than one Cloud Run instance and dies on cold start, which is not acceptable
 * for money movement. Production uses Cloud Scheduler -> Cloud Run Job.
 * Always dry-runs.
 */
export function startIntervalTrigger({ log } = {}) {
  if (env.NODE_ENV === "production") {
    throw new Error("The interval trigger must never run in production — use the Cloud Run Job.");
  }

  const timer = setInterval(async () => {
    try {
      await runJob("autopay", { dryRun: true, trigger: "interval", log });
    } catch (err) {
      if (!(err instanceof JobLockedError)) log?.error?.({ err }, "interval trigger failed");
    }
  }, TICK_MS);

  timer.unref?.();
  log?.info?.("AutoPay interval trigger started (dev only, dry-run)");
  return () => clearInterval(timer);
}
```

- [ ] **Step 6: Wire into `apps/api/src/index.js`**

Register jobs and the HTTP trigger before the static/SPA block:

```js
import { registerAllJobs } from "./jobs/definitions/index.js";
import { registerJobTriggerRoutes } from "./jobs/triggers/http.js";

registerAllJobs();
registerJobTriggerRoutes(fastify);
```

Do **not** start the interval trigger automatically — it is opt-in via `JOBS_DEV_INTERVAL=true` so a developer's machine does not run sweeps unasked. Add to `env.js`:

```js
  JOBS_DEV_INTERVAL: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
```

and after `fastify.listen`:

```js
if (env.JOBS_DEV_INTERVAL && env.NODE_ENV !== "production") {
  const { startIntervalTrigger } = await import("./jobs/triggers/interval.js");
  startIntervalTrigger({ log: fastify.log });
}
```

- [ ] **Step 7: Verify the CLI works**

```bash
cd apps/api && node --env-file=.env src/jobs/cli.js --list
node --env-file=.env src/jobs/cli.js autopay
```

Expected: `--list` prints `autopay`; the run prints JSON with `"status": "succeeded"` and `"dryRun": true`.

- [ ] **Step 8: Verify the HTTP trigger rejects a bad secret**

With the API running and `JOBS_TRIGGER_SECRET=devsecret`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/internal/jobs/autopay/run
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/internal/jobs/autopay/run -H 'x-jobs-trigger-secret: wrong'
curl -s -X POST localhost:3000/internal/jobs/autopay/run -H 'x-jobs-trigger-secret: devsecret'
```

Expected: `401`, `401`, then JSON with `"status": "succeeded"`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/jobs apps/api/src/index.js apps/api/src/config/env.js apps/api/package.json
git commit -m "feat(jobs): CLI, HTTP, and dev-interval triggers"
```

---

## Task 7: Shared card service

**Files:**
- Create: `apps/api/src/services/card.service.js`
- Modify: `apps/api/src/routes/payment.routes.js` (import from the service, delete the local copy)

**Interfaces:**
- Produces:
  - `ensureCustomerProfile(user) -> Promise<string>` — user needs `{ id, email, name, authorizeNetCustomerProfileId }`; persists a newly created profile and mutates the passed object.
  - `listCardsForUser(user) -> Promise<Array<{ paymentProfileId, cardNumber, cardType, expirationDate, isDefault }>>`
  - `assertCardExists(user, paymentProfileId) -> Promise<void>` — throws `CardNotFoundError`.
  - `CardNotFoundError` (exported class).

- [ ] **Step 1: Create the service**

Move `ensureCustomerProfile` verbatim from `payment.routes.js:318-332` (it already takes a plain user object, so it needs no changes to serve admin routes), and add the two new helpers:

```js
import { db } from "../config/database.js";
import { users } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import * as authorizenetService from "./authorizenet.service.js";

export class CardNotFoundError extends Error {
  constructor(paymentProfileId) {
    super(`Payment profile ${paymentProfileId} was not found on this account.`);
    this.name = "CardNotFoundError";
  }
}

/**
 * Return the user's CIM customer profile id, creating and persisting one on
 * first use. Takes a plain user object rather than reading request.user, so
 * admin routes acting on behalf of a doctor can reuse it by SELECTing the
 * target user first.
 */
export async function ensureCustomerProfile(user) {
  let customerProfileId = user.authorizeNetCustomerProfileId;
  if (!customerProfileId) {
    customerProfileId = await authorizenetService.createCustomerProfile({
      email: user.email,
      description: `Doctor: ${user.name}`,
    });
    await db
      .update(users)
      .set({ authorizeNetCustomerProfileId: customerProfileId, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    user.authorizeNetCustomerProfileId = customerProfileId;
  }
  return customerProfileId;
}

/** Cards on file, newest gateway state, with the user's default flagged. */
export async function listCardsForUser(user) {
  if (!user.authorizeNetCustomerProfileId) return [];
  const profiles = await authorizenetService.listPaymentProfiles(user.authorizeNetCustomerProfileId);
  return (profiles || []).map((p) => ({
    ...p,
    isDefault: String(p.paymentProfileId) === String(user.defaultPaymentProfileId || ""),
  }));
}

/**
 * Assert a payment profile really belongs to this user, at the gateway.
 * AutoPay enrollment depends on this — an enrollment pointing at a card that
 * does not exist would fail silently every cycle.
 */
export async function assertCardExists(user, paymentProfileId) {
  const cards = await listCardsForUser(user);
  if (!cards.some((c) => String(c.paymentProfileId) === String(paymentProfileId))) {
    throw new CardNotFoundError(paymentProfileId);
  }
}
```

- [ ] **Step 2: Update `payment.routes.js`**

Delete the local `ensureCustomerProfile` (lines ~318-332) and import instead:

```js
import { ensureCustomerProfile } from "../services/card.service.js";
```

- [ ] **Step 3: Verify nothing regressed**

Run: `pnpm --filter @my-app/api test`
Expected: all existing tests still pass (163+).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/card.service.js apps/api/src/routes/payment.routes.js
git commit -m "refactor(payments): extract card service so admin routes can reuse it"
```

---

## Task 8: AutoPay enrollment service

**Files:**
- Create: `apps/api/src/services/autopay.service.js`, `apps/api/src/services/autopay.service.test.js`
- Create: `packages/shared/src/schemas/autopay.schema.js`; Modify: `packages/shared/src/index.js`

**Interfaces:**
- Consumes: `assertCardExists`, `CardNotFoundError` (Task 7); `autopayEnrollments` (Task 1); `env.AUTOPAY_MIN_AMOUNT` (Task 2).
- Produces:
  - `getEnrollment(userId) -> Promise<enrollment|null>`
  - `upsertEnrollment({ user, amount, dayOfMonth, paymentProfileId, enabled, minAmountOverride, actorUserId }) -> Promise<enrollment>`
  - `deleteEnrollment(userId) -> Promise<void>`
  - `setPaused(userId, { paused, reason, actorUserId }) -> Promise<enrollment>`
  - `effectiveFloor(enrollment) -> number`
  - `AutopayValidationError` (exported class, carries `.field`).
- Zod: `autopayEnrollSchema` (`{ amount: number>0, dayOfMonth: int 1..31, paymentProfileId: string, enabled: boolean optional }`), `autopayAdminEnrollSchema` (adds `minAmountOverride: number>0 optional nullable`).

- [ ] **Step 1: Write the shared schemas**

```js
import { z } from "zod";

export const autopayEnrollSchema = z.object({
  amount: z.number().positive("Amount must be greater than zero.").max(100000),
  dayOfMonth: z.number().int().min(1, "Day must be 1–31.").max(31, "Day must be 1–31."),
  paymentProfileId: z.string().min(1, "Choose a card on file."),
  enabled: z.boolean().optional(),
});

// Admin may additionally set a per-doctor floor override.
export const autopayAdminEnrollSchema = autopayEnrollSchema.extend({
  minAmountOverride: z.number().positive().max(100000).nullable().optional(),
});
```

Export from `packages/shared/src/index.js`:

```js
export * from "./schemas/autopay.schema.js";
```

- [ ] **Step 2: Write the failing test**

```js
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

let cards = [];
vi.mock("./card.service.js", () => ({
  CardNotFoundError: class CardNotFoundError extends Error {},
  assertCardExists: async (_user, id) => {
    if (!cards.some((c) => c.paymentProfileId === id)) {
      const E = (await import("./card.service.js")).CardNotFoundError;
      throw new E("missing");
    }
  },
}));

const rows = [];
vi.mock("../config/database.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows.slice(0, 1) }) }) }),
    insert: () => ({ values: async (v) => { rows.push(v); return v; } }),
    update: () => ({ set: (v) => ({ where: async () => { Object.assign(rows[0], v); } }) }),
    delete: () => ({ where: async () => { rows.length = 0; } }),
  },
}));

const { upsertEnrollment, effectiveFloor, AutopayValidationError } = await import("./autopay.service.js");

const user = { id: "u1", email: "d@x.com", name: "Doc", authorizeNetCustomerProfileId: "cp1" };

beforeEach(() => {
  rows.length = 0;
  cards = [{ paymentProfileId: "pp1" }];
});

describe("enrollment validation", () => {
  it("rejects an amount below the floor", async () => {
    await expect(
      upsertEnrollment({ user, amount: 50, dayOfMonth: 15, paymentProfileId: "pp1", actorUserId: "u1" })
    ).rejects.toThrow(AutopayValidationError);
  });

  it("accepts an amount at the floor", async () => {
    await expect(
      upsertEnrollment({ user, amount: 200, dayOfMonth: 15, paymentProfileId: "pp1", actorUserId: "u1" })
    ).resolves.toMatchObject({ amount: "200.00" });
  });

  it("requires a card on file", async () => {
    cards = [];
    await expect(
      upsertEnrollment({ user, amount: 300, dayOfMonth: 15, paymentProfileId: "pp1", actorUserId: "u1" })
    ).rejects.toThrow(/card/i);
  });

  it("lets an admin override the floor for one doctor", async () => {
    await expect(
      upsertEnrollment({
        user, amount: 100, dayOfMonth: 15, paymentProfileId: "pp1",
        minAmountOverride: 75, actorUserId: "admin1",
      })
    ).resolves.toMatchObject({ amount: "100.00", minAmountOverride: "75.00" });
  });

  it("still enforces the override as a floor", async () => {
    await expect(
      upsertEnrollment({
        user, amount: 50, dayOfMonth: 15, paymentProfileId: "pp1",
        minAmountOverride: 75, actorUserId: "admin1",
      })
    ).rejects.toThrow(AutopayValidationError);
  });

  it("rejects a day outside 1–31", async () => {
    await expect(
      upsertEnrollment({ user, amount: 300, dayOfMonth: 32, paymentProfileId: "pp1", actorUserId: "u1" })
    ).rejects.toThrow(/day/i);
  });

  it("defaults a new enrollment to disabled", async () => {
    const e = await upsertEnrollment({ user, amount: 300, dayOfMonth: 15, paymentProfileId: "pp1", actorUserId: "u1" });
    expect(e.enabled).toBe(false);
  });
});

describe("effectiveFloor", () => {
  it("uses the configured minimum when there is no override", () => {
    expect(effectiveFloor({ minAmountOverride: null })).toBe(200);
  });

  it("uses the override when present", () => {
    expect(effectiveFloor({ minAmountOverride: "75.00" })).toBe(75);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @my-app/api exec vitest run src/services/autopay.service.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Implement**

```js
import { db } from "../config/database.js";
import { autopayEnrollments } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import { assertCardExists, CardNotFoundError } from "./card.service.js";

export class AutopayValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "AutopayValidationError";
    this.field = field;
  }
}

/** The minimum this doctor may enroll at — the admin override wins if set. */
export function effectiveFloor(enrollment) {
  const override = enrollment?.minAmountOverride;
  return override != null ? Number(override) : Number(env.AUTOPAY_MIN_AMOUNT);
}

export async function getEnrollment(userId) {
  const [row] = await db
    .select()
    .from(autopayEnrollments)
    .where(eq(autopayEnrollments.userId, String(userId)))
    .limit(1);
  return row || null;
}

/**
 * Create or update an enrollment.
 *
 * `enabled` is NEVER implied — a new enrollment is created disabled and only an
 * explicit `enabled: true` turns it on. That keeps "a row exists" and "this
 * doctor is being charged" separate facts.
 */
export async function upsertEnrollment({
  user,
  amount,
  dayOfMonth,
  paymentProfileId,
  enabled,
  minAmountOverride,
  actorUserId,
}) {
  const day = Number(dayOfMonth);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new AutopayValidationError("Day of month must be between 1 and 31.", "dayOfMonth");
  }

  const existing = await getEnrollment(user.id);
  const override = minAmountOverride !== undefined ? minAmountOverride : existing?.minAmountOverride ?? null;
  const floor = override != null ? Number(override) : Number(env.AUTOPAY_MIN_AMOUNT);

  const amt = Number(amount);
  if (!(amt > 0)) throw new AutopayValidationError("Amount must be greater than zero.", "amount");
  if (amt < floor) {
    throw new AutopayValidationError(
      `AutoPay amount must be at least $${floor.toFixed(2)}.`,
      "amount"
    );
  }

  // A card on file is a hard requirement — verified at the gateway, not just in
  // the UI. An enrollment pointing at a card that does not exist would fail
  // silently every cycle.
  try {
    await assertCardExists(user, paymentProfileId);
  } catch (err) {
    if (err instanceof CardNotFoundError) {
      throw new AutopayValidationError(
        "That card is not on file. Add a card before enrolling in AutoPay.",
        "paymentProfileId"
      );
    }
    throw err;
  }

  const values = {
    amount: amt.toFixed(2),
    dayOfMonth: day,
    paymentProfileId: String(paymentProfileId),
    minAmountOverride: override != null ? Number(override).toFixed(2) : null,
    updatedByUserId: actorUserId ? String(actorUserId) : null,
    updatedAt: new Date(),
  };
  if (enabled !== undefined) values.enabled = Boolean(enabled);

  if (existing) {
    await db.update(autopayEnrollments).set(values).where(eq(autopayEnrollments.userId, String(user.id)));
    return { ...existing, ...values };
  }

  const row = {
    id: createId(),
    userId: String(user.id),
    // Explicitly false unless the caller opted in.
    enabled: values.enabled ?? false,
    status: "active",
    consecutiveFailures: 0,
    createdByUserId: actorUserId ? String(actorUserId) : null,
    ...values,
  };
  await db.insert(autopayEnrollments).values(row);
  return row;
}

export async function deleteEnrollment(userId) {
  await db.delete(autopayEnrollments).where(eq(autopayEnrollments.userId, String(userId)));
}

export async function setPaused(userId, { paused, reason, actorUserId }) {
  const values = {
    status: paused ? "paused" : "active",
    pausedReason: paused ? String(reason || "manual") : null,
    updatedByUserId: actorUserId ? String(actorUserId) : null,
    updatedAt: new Date(),
  };
  // Resuming clears the failure counter so a recovered card gets a clean slate.
  if (!paused) values.consecutiveFailures = 0;
  await db.update(autopayEnrollments).set(values).where(eq(autopayEnrollments.userId, String(userId)));
  return getEnrollment(userId);
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @my-app/api exec vitest run src/services/autopay.service.test.js`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/autopay.service.js apps/api/src/services/autopay.service.test.js packages/shared/src
git commit -m "feat(autopay): enrollment service with floor, override, and card-on-file requirement"
```

---

## Task 9: Doctor AutoPay routes

**Files:**
- Create: `apps/api/src/routes/autopay.routes.js`, `apps/api/src/routes/__tests__/autopay.schema.test.js`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Consumes: `autopay.service.js` (Task 8), `autopay-schedule.js` (Task 4), `autopayAttempts` (Task 1).
- Produces: `GET/PUT/DELETE /autopay`, `GET /autopay/attempts` under `/api/v1`, all `[authenticate, requireApprovedDoctor]`.

- [ ] **Step 1: Write the schema test**

```js
import { describe, it, expect } from "vitest";
import { autopayEnrollSchema, autopayAdminEnrollSchema } from "@my-app/shared";

describe("autopayEnrollSchema", () => {
  it("accepts a valid enrollment", () => {
    expect(autopayEnrollSchema.safeParse({ amount: 500, dayOfMonth: 15, paymentProfileId: "pp1" }).success).toBe(true);
  });

  it("rejects a day above 31", () => {
    expect(autopayEnrollSchema.safeParse({ amount: 500, dayOfMonth: 32, paymentProfileId: "pp1" }).success).toBe(false);
  });

  it("rejects a day of 0", () => {
    expect(autopayEnrollSchema.safeParse({ amount: 500, dayOfMonth: 0, paymentProfileId: "pp1" }).success).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(autopayEnrollSchema.safeParse({ amount: -5, dayOfMonth: 15, paymentProfileId: "pp1" }).success).toBe(false);
  });

  it("requires a payment profile", () => {
    expect(autopayEnrollSchema.safeParse({ amount: 500, dayOfMonth: 15, paymentProfileId: "" }).success).toBe(false);
  });

  it("does not accept a floor override on the doctor schema", () => {
    const parsed = autopayEnrollSchema.parse({ amount: 500, dayOfMonth: 15, paymentProfileId: "pp1", minAmountOverride: 1 });
    expect(parsed.minAmountOverride).toBeUndefined();
  });

  it("accepts a floor override on the admin schema", () => {
    expect(autopayAdminEnrollSchema.safeParse({ amount: 100, dayOfMonth: 15, paymentProfileId: "pp1", minAmountOverride: 75 }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @my-app/api exec vitest run src/routes/__tests__/autopay.schema.test.js`
Expected: FAIL — `autopayEnrollSchema` is not exported (if Task 8 step 1 was skipped) or PASS if already done. If PASS, proceed.

- [ ] **Step 3: Implement the routes**

```js
import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import { autopayEnrollSchema, ERROR_CODES } from "@my-app/shared";
import * as autopayService from "../services/autopay.service.js";
import { listCardsForUser } from "../services/card.service.js";
import * as auditService from "../services/audit.service.js";
import { db } from "../config/database.js";
import { autopayAttempts } from "../db/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { env } from "../config/env.js";
import { resolveChargeDay, zonedParts } from "../lib/autopay-schedule.js";

/** Next calendar date this enrollment would charge, in lab time. */
function nextRunDate(enrollment, now = new Date()) {
  if (!enrollment?.enabled || enrollment.status !== "active") return null;
  const { year, month, day } = zonedParts(now, env.AUTOPAY_TIMEZONE);
  const thisMonth = resolveChargeDay(year, month, enrollment.dayOfMonth);
  if (day < thisMonth) return `${year}-${String(month).padStart(2, "0")}-${String(thisMonth).padStart(2, "0")}`;
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const next = resolveChargeDay(ny, nm, enrollment.dayOfMonth);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(next).padStart(2, "0")}`;
}

function serialize(enrollment) {
  if (!enrollment) return null;
  return {
    enabled: enrollment.enabled,
    amount: Number(enrollment.amount),
    dayOfMonth: enrollment.dayOfMonth,
    paymentProfileId: enrollment.paymentProfileId,
    status: enrollment.status,
    pausedReason: enrollment.pausedReason,
    consecutiveFailures: enrollment.consecutiveFailures,
    minAmount: autopayService.effectiveFloor(enrollment),
    lastChargedAt: enrollment.lastChargedAt,
    nextRunDate: nextRunDate(enrollment),
  };
}

export default async function autopayRoutes(fastify) {
  fastify.get("/autopay", { preHandler: [authenticate, requireApprovedDoctor] }, async (request) => {
    const enrollment = await autopayService.getEnrollment(request.user.id);
    const cards = await listCardsForUser(request.user);
    return {
      data: {
        enrollment: serialize(enrollment),
        cards,
        minAmount: autopayService.effectiveFloor(enrollment),
        // The UI must not offer enrollment without a card, and the server
        // enforces the same rule.
        canEnroll: cards.length > 0,
      },
    };
  });

  fastify.put("/autopay", {
    preHandler: [authenticate, requireApprovedDoctor, validate(autopayEnrollSchema)],
  }, async (request, reply) => {
    try {
      const enrollment = await autopayService.upsertEnrollment({
        user: request.user,
        ...request.body,
        // A doctor can never set their own floor override.
        minAmountOverride: undefined,
        actorUserId: request.user.id,
      });
      await auditService.logSafe({
        userId: request.user.id,
        action: "autopay.enrollment_updated",
        targetType: "user",
        targetId: request.user.id,
        metadata: { amount: request.body.amount, dayOfMonth: request.body.dayOfMonth, enabled: enrollment.enabled },
        ipAddress: request.ip,
      });
      return { data: { enrollment: serialize(enrollment) } };
    } catch (err) {
      if (err instanceof autopayService.AutopayValidationError) {
        return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message, field: err.field } });
      }
      throw err;
    }
  });

  fastify.delete("/autopay", { preHandler: [authenticate, requireApprovedDoctor] }, async (request) => {
    await autopayService.deleteEnrollment(request.user.id);
    await auditService.logSafe({
      userId: request.user.id,
      action: "autopay.enrollment_deleted",
      targetType: "user",
      targetId: request.user.id,
      ipAddress: request.ip,
    });
    return { data: { message: "AutoPay cancelled." } };
  });

  fastify.get("/autopay/attempts", { preHandler: [authenticate, requireApprovedDoctor] }, async (request) => {
    const rows = await db
      .select()
      .from(autopayAttempts)
      .where(eq(autopayAttempts.userId, request.user.id))
      .orderBy(desc(autopayAttempts.createdAt))
      .limit(50);
    return { data: { attempts: rows } };
  });
}
```

- [ ] **Step 4: Register in `apps/api/src/index.js`**

```js
import autopayRoutes from "./routes/autopay.routes.js";
await fastify.register(autopayRoutes, { prefix: "/api/v1" });
```

- [ ] **Step 5: Verify manually**

Log in as the test doctor and check the shape:

```bash
curl -s localhost:3000/api/v1/autopay -H "Authorization: Bearer $DOCTOR_TOKEN" | jq
```

Expected: `enrollment: null`, `canEnroll` reflecting whether a card is on file, `minAmount: 200`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/autopay.routes.js apps/api/src/routes/__tests__/autopay.schema.test.js apps/api/src/index.js
git commit -m "feat(autopay): doctor enrollment routes"
```

---

## Task 10: Admin payment parity routes

**Files:**
- Create: `apps/api/src/routes/admin-payment.routes.js`, `apps/api/src/routes/__tests__/admin-payment.authz.test.js`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Consumes: `card.service.js` (Task 7), `autopay.service.js` (Task 8).
- Produces, all `[authenticate, requireAdmin]` under `/api/v1`:
  - `GET /admin/autopay`
  - `GET|PUT|DELETE /admin/users/:userId/autopay`
  - `POST /admin/users/:userId/autopay/pause`, `.../resume`
  - `GET /admin/users/:userId/saved-cards`
  - `POST /admin/users/:userId/saved-cards/hosted-token`
  - `PUT /admin/users/:userId/saved-cards/:profileId/default`
  - `DELETE /admin/users/:userId/saved-cards/:profileId`
  - `GET /admin/jobs`, `GET /admin/jobs/runs`, `POST /admin/jobs/:name/run`
- Produces helper `loadDoctor(userId) -> Promise<user>` throwing `DoctorNotFoundError`.

- [ ] **Step 1: Write the authorization test**

This exists because `/payments/test/*` shipped guard-less. Every route is asserted, not assumed:

```js
import { describe, it, expect } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const adminPaymentRoutes = (await import("../admin-payment.routes.js")).default;

/** Build an app whose `authenticate` injects a user of the given role. */
async function appAs(role) {
  const app = Fastify();
  app.addHook("onRequest", async (req) => {
    req.user = { id: "u1", role, approvalStatus: "approved", email: "x@y.z", name: "X" };
  });
  await app.register(adminPaymentRoutes, { prefix: "/api/v1" });
  return app;
}

const ROUTES = [
  ["GET", "/api/v1/admin/autopay"],
  ["GET", "/api/v1/admin/users/u2/autopay"],
  ["PUT", "/api/v1/admin/users/u2/autopay"],
  ["DELETE", "/api/v1/admin/users/u2/autopay"],
  ["POST", "/api/v1/admin/users/u2/autopay/pause"],
  ["POST", "/api/v1/admin/users/u2/autopay/resume"],
  ["GET", "/api/v1/admin/users/u2/saved-cards"],
  ["POST", "/api/v1/admin/users/u2/saved-cards/hosted-token"],
  ["PUT", "/api/v1/admin/users/u2/saved-cards/pp1/default"],
  ["DELETE", "/api/v1/admin/users/u2/saved-cards/pp1"],
  ["POST", "/api/v1/admin/users/u2/payments/charge-saved"],
  ["GET", "/api/v1/admin/jobs"],
  ["GET", "/api/v1/admin/jobs/runs"],
  ["POST", "/api/v1/admin/jobs/autopay/run"],
];

describe("admin payment routes reject non-admins", () => {
  for (const [method, url] of ROUTES) {
    it(`${method} ${url} is 403 for a doctor`, async () => {
      const app = await appAs("doctor");
      const res = await app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it(`${method} ${url} is 403 for a plain user`, async () => {
      const app = await appAs("user");
      const res = await app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  }
});
```

**Do NOT modify `authenticate.js` to make this test pass.** An earlier draft of
this plan suggested giving `authenticate` a "skip if `request.user` is already
set" short-circuit. That is an authentication bypass added for test
convenience: any future plugin or hook that sets `request.user` would silently
disable authentication on every route. This repo just shipped a critical fix for
exactly this class of bug (an MFA token accepted as an access token because a
verifier trusted something it should have checked). Production auth does not
get weakened for a test.

Instead, mock the middleware module — the test's subject is `requireAdmin`, not
`authenticate`. Put this ABOVE the route import in the test file:

```js
let currentUser = { id: "u1", role: "admin", approvalStatus: "approved", email: "x@y.z", name: "X" };

vi.mock("../../middleware/authenticate.js", () => ({
  // Stands in for a successful authentication; the real token path is covered
  // by auth-security.test.js and token-confusion.test.js.
  authenticate: async (request) => { request.user = currentUser; },
}));
```

and have `appAs(role)` set `currentUser = { ...currentUser, role }` before
registering the routes. The real `requireAdmin` still runs, which is the whole
point of the test.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @my-app/api exec vitest run src/routes/__tests__/admin-payment.authz.test.js`
Expected: FAIL — cannot find module `../admin-payment.routes.js`.

- [ ] **Step 3: Implement the routes**

```js
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import { autopayAdminEnrollSchema, ERROR_CODES } from "@my-app/shared";
import * as autopayService from "../services/autopay.service.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import { ensureCustomerProfile, listCardsForUser } from "../services/card.service.js";
import * as auditService from "../services/audit.service.js";
import { db } from "../config/database.js";
import { users, autopayEnrollments, jobRuns } from "../db/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { env } from "../config/env.js";
import { listJobs } from "../jobs/registry.js";
import { runJob, JobLockedError } from "../jobs/runner.js";

class DoctorNotFoundError extends Error {}

/**
 * Load the doctor an admin is acting on behalf of. Returns the same shape
 * `authenticate` puts on request.user, so every downstream helper
 * (ensureCustomerProfile, listCardsForUser, verifyAllocations) works unchanged.
 */
async function loadDoctor(userId) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      approvalStatus: users.approvalStatus,
      seazonaClientId: users.seazonaClientId,
      seazonaAccountNumber: users.seazonaAccountNumber,
      authorizeNetCustomerProfileId: users.authorizeNetCustomerProfileId,
      defaultPaymentProfileId: users.defaultPaymentProfileId,
    })
    .from(users)
    .where(eq(users.id, String(userId)))
    .limit(1);
  if (!row) throw new DoctorNotFoundError();
  return row;
}

const guard = [authenticate, requireAdmin];

export default async function adminPaymentRoutes(fastify) {
  const notFound = (reply) =>
    reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Doctor not found." } });

  // ── AutoPay oversight ──
  fastify.get("/admin/autopay", { preHandler: guard }, async () => {
    const rows = await db
      .select({
        userId: autopayEnrollments.userId,
        enabled: autopayEnrollments.enabled,
        amount: autopayEnrollments.amount,
        dayOfMonth: autopayEnrollments.dayOfMonth,
        status: autopayEnrollments.status,
        pausedReason: autopayEnrollments.pausedReason,
        consecutiveFailures: autopayEnrollments.consecutiveFailures,
        minAmountOverride: autopayEnrollments.minAmountOverride,
        lastChargedAt: autopayEnrollments.lastChargedAt,
        doctorName: users.name,
        doctorEmail: users.email,
        accountNumber: users.seazonaAccountNumber,
      })
      .from(autopayEnrollments)
      .leftJoin(users, eq(users.id, autopayEnrollments.userId))
      .orderBy(desc(autopayEnrollments.updatedAt));
    return { data: { enrollments: rows, minAmount: Number(env.AUTOPAY_MIN_AMOUNT), liveRun: env.AUTOPAY_LIVE_RUN } };
  });

  fastify.get("/admin/users/:userId/autopay", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      const [enrollment, cards] = await Promise.all([
        autopayService.getEnrollment(doctor.id),
        listCardsForUser(doctor),
      ]);
      return { data: { enrollment, cards, canEnroll: cards.length > 0 } };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  fastify.put("/admin/users/:userId/autopay", {
    preHandler: [...guard, validate(autopayAdminEnrollSchema)],
  }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      const enrollment = await autopayService.upsertEnrollment({
        user: doctor,
        ...request.body,
        actorUserId: request.user.id,
      });
      await auditService.logSafe({
        userId: request.user.id,
        action: "autopay.enrollment_updated_by_admin",
        targetType: "user",
        targetId: doctor.id,
        metadata: {
          amount: request.body.amount,
          dayOfMonth: request.body.dayOfMonth,
          enabled: enrollment.enabled,
          minAmountOverride: request.body.minAmountOverride ?? null,
        },
        ipAddress: request.ip,
      });
      return { data: { enrollment } };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      if (err instanceof autopayService.AutopayValidationError) {
        return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message, field: err.field } });
      }
      throw err;
    }
  });

  fastify.delete("/admin/users/:userId/autopay", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      await autopayService.deleteEnrollment(doctor.id);
      await auditService.logSafe({
        userId: request.user.id,
        action: "autopay.enrollment_deleted_by_admin",
        targetType: "user",
        targetId: doctor.id,
        ipAddress: request.ip,
      });
      return { data: { message: "AutoPay cancelled." } };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  for (const [suffix, paused] of [["pause", true], ["resume", false]]) {
    fastify.post(`/admin/users/:userId/autopay/${suffix}`, { preHandler: guard }, async (request, reply) => {
      try {
        const doctor = await loadDoctor(request.params.userId);
        const enrollment = await autopayService.setPaused(doctor.id, {
          paused,
          reason: request.body?.reason,
          actorUserId: request.user.id,
        });
        await auditService.logSafe({
          userId: request.user.id,
          action: `autopay.${suffix}d_by_admin`,
          targetType: "user",
          targetId: doctor.id,
          ipAddress: request.ip,
        });
        return { data: { enrollment } };
      } catch (err) {
        if (err instanceof DoctorNotFoundError) return notFound(reply);
        throw err;
      }
    });
  }

  // ── Card parity ──
  fastify.get("/admin/users/:userId/saved-cards", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      return { data: { cards: await listCardsForUser(doctor) } };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  /**
   * Mint a HOSTED add-card token for a doctor. The admin never sees or handles a
   * card number — the doctor's card is entered on Authorize.net's own iframe,
   * which keeps this SAQ-A. Accept.js is inert in production anyway.
   */
  fastify.post("/admin/users/:userId/saved-cards/hosted-token", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      const customerProfileId = await ensureCustomerProfile(doctor);
      const result = await authorizenetService.getHostedAddCardToken({
        customerProfileId,
        iframeCommunicatorUrl: `${env.APP_URL}/IFrameCommunicator.html`,
      });
      await auditService.logSafe({
        userId: request.user.id,
        action: "payment.card.add_started_by_admin",
        targetType: "user",
        targetId: doctor.id,
        ipAddress: request.ip,
      });
      return { data: result };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  fastify.put("/admin/users/:userId/saved-cards/:profileId/default", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      const profileId = String(request.params.profileId);
      const cards = await listCardsForUser(doctor);
      if (!cards.some((c) => String(c.paymentProfileId) === profileId)) {
        return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Card not found." } });
      }
      await db.update(users).set({ defaultPaymentProfileId: profileId, updatedAt: new Date() }).where(eq(users.id, doctor.id));
      await auditService.logSafe({
        userId: request.user.id,
        action: "payment.card.set_default_by_admin",
        targetType: "user",
        targetId: doctor.id,
        metadata: { profileId },
        ipAddress: request.ip,
      });
      return { data: { message: "Default card updated." } };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  fastify.delete("/admin/users/:userId/saved-cards/:profileId", { preHandler: guard }, async (request, reply) => {
    try {
      const doctor = await loadDoctor(request.params.userId);
      const profileId = String(request.params.profileId);

      // Deleting the card an enrollment points at would make every future cycle
      // fail silently. Block it and make the admin change the card first.
      const enrollment = await autopayService.getEnrollment(doctor.id);
      if (enrollment?.enabled && String(enrollment.paymentProfileId) === profileId) {
        return reply.code(409).send({
          error: {
            ...ERROR_CODES.VALIDATION_ERROR,
            message: "This card is used by an active AutoPay enrollment. Change the AutoPay card or cancel AutoPay first.",
          },
        });
      }

      await authorizenetService.deletePaymentProfile({
        customerProfileId: doctor.authorizeNetCustomerProfileId,
        paymentProfileId: profileId,
      });
      if (String(doctor.defaultPaymentProfileId) === profileId) {
        await db.update(users).set({ defaultPaymentProfileId: null, updatedAt: new Date() }).where(eq(users.id, doctor.id));
      }
      await auditService.logSafe({
        userId: request.user.id,
        action: "payment.card.delete_by_admin",
        targetType: "user",
        targetId: doctor.id,
        metadata: { profileId },
        ipAddress: request.ip,
      });
      return { data: { message: "Card removed." } };
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }
  });

  // ── Jobs ──
  fastify.get("/admin/jobs", { preHandler: guard }, async () => ({
    data: { jobs: listJobs(), liveRun: env.AUTOPAY_LIVE_RUN },
  }));

  fastify.get("/admin/jobs/runs", { preHandler: guard }, async (request) => {
    const limit = Math.min(Number(request.query?.limit) || 50, 200);
    const rows = await db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(limit);
    return { data: { runs: rows } };
  });

  fastify.post("/admin/jobs/:name/run", { preHandler: guard }, async (request, reply) => {
    // Dry run unless the admin explicitly asks for a live run — and even then
    // AUTOPAY_LIVE_RUN must be true for the job itself to charge.
    const dryRun = request.body?.dryRun !== false;
    try {
      const result = await runJob(String(request.params.name), {
        dryRun,
        trigger: "manual",
        actorUserId: request.user.id,
        log: request.log,
      });
      await auditService.logSafe({
        userId: request.user.id,
        action: "job.run_triggered",
        targetType: "job",
        targetId: String(request.params.name),
        metadata: { dryRun, runId: result.runId, status: result.status },
        ipAddress: request.ip,
      });
      return { data: result };
    } catch (err) {
      if (err instanceof JobLockedError) {
        return reply.code(409).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message } });
      }
      return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: err.message } });
    }
  });
}
```

- [ ] **Step 4: Register in `apps/api/src/index.js`**

```js
import adminPaymentRoutes from "./routes/admin-payment.routes.js";
await fastify.register(adminPaymentRoutes, { prefix: "/api/v1" });
```

- [ ] **Step 5: Run the authorization test**

Run: `pnpm --filter @my-app/api exec vitest run src/routes/__tests__/admin-payment.authz.test.js`
Expected: PASS (28 tests — 14 routes × 2 roles).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin-payment.routes.js apps/api/src/routes/__tests__/admin-payment.authz.test.js apps/api/src/index.js
git commit -m "feat(admin): AutoPay oversight, card parity, and job control routes"
```

---

## Task 11: Admin charge-on-behalf

**Files:**
- Create: `apps/api/src/services/payment-recording.service.js`
- Modify: `apps/api/src/routes/admin-payment.routes.js`, `apps/api/src/routes/payment.routes.js`

**Interfaces:**
- Produces from the new service: `verifyAllocations(allocations, user, { enforceCap })`, `recordPaymentAndAllocations({ user, amount, transactionId, allocations, source })`, `buildInvoiceReference(allocations)`.
- Stays in `payment.routes.js`: `chargeErrorReply(reply, err)` — it maps an error to an HTTP reply, so it belongs with the routes. Export it.
- Produces: `POST /admin/users/:userId/payments/charge-saved`, body `{ paymentProfileId, amount, allocations[] }`, header `Idempotency-Key` required.

- [ ] **Step 1: Move the charge spine into a service**

`verifyAllocations` and `recordPaymentAndAllocations` are currently module-private
in `payment.routes.js`. Three callers now need them: the doctor routes, the new
admin route, and the AutoPay sweep (Task 12).

**Move them to `apps/api/src/services/payment-recording.service.js` rather than
exporting them from the route file.** A service importing from a route module
inverts the dependency direction — the AutoPay sweep would pull in Fastify route
registration just to record a payment, and it makes the route file's HTTP
concerns a dependency of a background job. Move the two functions and their
private helpers (`buildInvoiceReference`, the `round2` used by them) verbatim
into the service, then have `payment.routes.js` import them:

```js
import {
  verifyAllocations,
  recordPaymentAndAllocations,
} from "../services/payment-recording.service.js";
```

Keep `chargeErrorReply` in `payment.routes.js` and export it — it builds an HTTP
reply, so it is genuinely route-layer code:

```js
export function chargeErrorReply(reply, err) { /* unchanged */ }
```

Run `pnpm --filter @my-app/api test` after the move and before adding anything
new — the move must be behaviour-preserving.

- [ ] **Step 2: Thread `source` through `recordPaymentAndAllocations`**

Add the parameter (defaulted, so existing callers are unchanged) and include it in the bulk insert:

```js
    const rows = allocations.map((a) => ({
      id: createId(),
      userId: user.id,
      seazonaClientId: user.seazonaClientId,
      seazonaInvoiceId: String(a.invoiceId),
      invoiceNumber: a.invoiceNumber != null ? String(a.invoiceNumber) : null,
      appliedAmount: Number(a.amount).toFixed(2),
      transactionId,
      seazonaPaymentId,
      source,
    }));
```

Update the two existing call sites: `/payments/charge-saved` passes `source: "doctor_card"`, the hosted path passes `source: "doctor_hosted"`. In `invoice.routes.js`, the offline insert passes `source: "admin_offline"`.

- [ ] **Step 3: Add the admin charge route**

In `admin-payment.routes.js`:

```js
import { verifyAllocations, recordPaymentAndAllocations } from "../services/payment-recording.service.js";
import { chargeErrorReply } from "./payment.routes.js";
import { withIdempotency, withInvoiceLocks, ChargeInProgressError, InvoiceLockedError } from "../lib/payment-helpers.js";
import { redis } from "../config/redis.js";

  /**
   * Charge a doctor's card on file, initiated by an admin.
   *
   * Deliberately the same spine as the doctor path — verifyAllocations ->
   * invoice locks -> capped re-check -> charge -> recordPaymentAndAllocations —
   * with the doctor loaded from the DB instead of request.user. Anything else
   * would be a second, divergent money path.
   */
  fastify.post("/admin/users/:userId/payments/charge-saved", { preHandler: guard }, async (request, reply) => {
    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Idempotency-Key header is required." } });
    }

    let doctor;
    try {
      doctor = await loadDoctor(request.params.userId);
    } catch (err) {
      if (err instanceof DoctorNotFoundError) return notFound(reply);
      throw err;
    }

    const { paymentProfileId, amount, allocations } = request.body || {};
    if (!doctor.authorizeNetCustomerProfileId) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "This doctor has no cards on file." } });
    }
    if (!doctor.seazonaClientId) {
      return reply.code(400).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "This doctor is not linked to a Seazona client." } });
    }

    // Ownership check outside the idempotency block, matching the doctor path.
    const ownershipError = await verifyAllocations(allocations, doctor);
    if (ownershipError) {
      return reply.code(ownershipError.kind === "forbidden" ? 403 : 422)
        .send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: ownershipError.message } });
    }

    try {
      const { result } = await withIdempotency(
        redis,
        `admin-charge:${doctor.id}:${idempotencyKey}`,
        async () =>
          withInvoiceLocks(redis, allocations.map((a) => a.invoiceId), async () => {
            const capError = await verifyAllocations(allocations, doctor, { enforceCap: true });
            if (capError) {
              const err = new Error(capError.message);
              err.allocationError = capError;
              throw err;
            }
            const charge = await authorizenetService.chargeCustomerProfile({
              customerProfileId: doctor.authorizeNetCustomerProfileId,
              paymentProfileId,
              amount: Number(amount),
              invoiceNumber: allocations[0]?.invoiceNumber,
            });
            const recorded = await recordPaymentAndAllocations({
              user: doctor,
              amount: Number(amount),
              transactionId: charge.transactionId,
              allocations,
              source: "admin_card",
            });
            return { ...charge, ...recorded };
          }, { log: request.log }),
        { log: request.log }
      );

      await auditService.logSafe({
        userId: request.user.id,
        action: "payment.charge_by_admin",
        targetType: "transaction",
        targetId: result.transactionId,
        metadata: { doctorId: doctor.id, amount: Number(amount), invoices: allocations.map((a) => a.invoiceNumber ?? a.invoiceId) },
        ipAddress: request.ip,
      });
      return { data: result };
    } catch (err) {
      if (err?.allocationError) {
        return reply.code(err.allocationError.kind === "forbidden" ? 403 : 422)
          .send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message } });
      }
      if (err instanceof InvoiceLockedError || err instanceof ChargeInProgressError) {
        return reply.code(409).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message } });
      }
      return chargeErrorReply(reply, err);
    }
  });
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter @my-app/api test`
Expected: all pass, including the authz test now covering the charge route.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes
git commit -m "feat(admin): charge a doctor's card on file, reusing the doctor charge spine"
```

---

## Task 12: The AutoPay sweep

**Files:**
- Replace: `apps/api/src/jobs/definitions/autopay.job.js` (stub from Task 6)
- Create: `apps/api/src/jobs/definitions/autopay.job.test.js`
- Create: `apps/api/src/services/autopay-runner.service.js` (the testable core)

**Interfaces:**
- Consumes: `allocateOldestFirst`, `resolveChargeAmount` (Task 3); `isDueOn`, `cycleKeyFor` (Task 4); `recordPaymentAndAllocations` (Task 11); `getPortalPaidMap` from `invoice-ledger.service.js`.
- Produces: `runAutopaySweep({ dryRun, now, log, runId }) -> Promise<{ considered, charged, skipped, failed, wouldCharge, totalAmount }>` and `processEnrollment({ enrollment, doctor, dryRun, now, runId, log }) -> Promise<attemptRow>`.

- [ ] **Step 1: Write the failing test**

Cover the behaviours that matter, with Seazona and the gateway stubbed:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const charged = [];
vi.mock("../../services/authorizenet.service.js", () => ({
  chargeCustomerProfile: vi.fn(async (args) => {
    charged.push(args);
    return { transactionId: "tx1", responseCode: "1", authCode: "A" };
  }),
}));

const recorded = [];
vi.mock("../../services/payment-recording.service.js", () => ({
  recordPaymentAndAllocations: vi.fn(async (args) => { recorded.push(args); return { seazonaPaymentId: "sp1" }; }),
  verifyAllocations: async () => null,
}));

const attempts = [];
vi.mock("../../config/database.js", () => ({
  db: {
    insert: () => ({ values: async (v) => { attempts.push(v); } }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));

const { processEnrollment } = await import("../../services/autopay-runner.service.js");

const doctor = {
  id: "u1", email: "d@x.com", name: "Doc",
  seazonaClientId: "c1", seazonaAccountNumber: "1324",
  authorizeNetCustomerProfileId: "cp1",
};
const enrollment = { id: "e1", userId: "u1", amount: "500.00", dayOfMonth: 15, paymentProfileId: "pp1", enabled: true, status: "active", consecutiveFailures: 0 };
const invoices = [
  { id: "i1", invoiceNumber: "1001", balance: 300, dueDate: "2026-01-01" },
  { id: "i2", invoiceNumber: "1002", balance: 400, dueDate: "2026-02-01" },
];

beforeEach(() => { charged.length = 0; recorded.length = 0; attempts.length = 0; });

describe("processEnrollment", () => {
  const now = new Date("2026-08-15T14:00:00Z");

  it("charges the enrolled amount and allocates oldest-first", async () => {
    const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun: false, now, runId: "r1" });
    expect(charged[0]).toMatchObject({ customerProfileId: "cp1", paymentProfileId: "pp1", amount: 500 });
    expect(recorded[0].allocations).toEqual([
      { invoiceId: "i1", invoiceNumber: "1001", amount: 300 },
      { invoiceId: "i2", invoiceNumber: "1002", amount: 200 },
    ]);
    expect(recorded[0].source).toBe("autopay");
    expect(attempt.status).toBe("succeeded");
  });

  it("charges only the balance when it is under the enrolled amount", async () => {
    const attempt = await processEnrollment({
      enrollment, doctor, invoices: [{ id: "i1", invoiceNumber: "1001", balance: 180, dueDate: "2026-01-01" }],
      dryRun: false, now, runId: "r1",
    });
    expect(charged[0].amount).toBe(180);
    expect(attempt.status).toBe("succeeded");
  });

  it("charges nothing and completes when the balance is zero", async () => {
    const attempt = await processEnrollment({ enrollment, doctor, invoices: [], dryRun: false, now, runId: "r1" });
    expect(charged).toHaveLength(0);
    expect(attempt.status).toBe("skipped");
  });

  // The whole point of the gate: a dry run must produce a full plan and no charge.
  it("records would_charge and does not charge on a dry run", async () => {
    const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun: true, now, runId: "r1" });
    expect(charged).toHaveLength(0);
    expect(recorded).toHaveLength(0);
    expect(attempt.status).toBe("would_charge");
    expect(attempt.amountAttempted).toBe("500.00");
    expect(attempt.allocations).toHaveLength(2);
  });

  it("records a failure when the gateway declines", async () => {
    const authnet = await import("../../services/authorizenet.service.js");
    authnet.chargeCustomerProfile.mockRejectedValueOnce(
      Object.assign(new Error("declined"), { authNetResponse: {} })
    );
    const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun: false, now, runId: "r1" });
    expect(attempt.status).toBe("failed");
    expect(attempt.failureReason).toMatch(/declined/i);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @my-app/api exec vitest run src/jobs/definitions/autopay.job.test.js`
Expected: FAIL — cannot find `autopay-runner.service.js`.

- [ ] **Step 3: Implement `apps/api/src/services/autopay-runner.service.js`**

```js
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { autopayEnrollments, autopayAttempts, users } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import * as seazonaService from "./seazona.service.js";
import * as authorizenetService from "./authorizenet.service.js";
import { getPortalPaidMap } from "./invoice-ledger.service.js";
import { recordPaymentAndAllocations } from "./payment-recording.service.js";
import { allocateOldestFirst, resolveChargeAmount } from "../lib/autopay-allocation.js";
import { isDueOn, cycleKeyFor } from "../lib/autopay-schedule.js";
import { withInvoiceLocks, withIdempotency } from "../lib/payment-helpers.js";
import * as emailService from "./email.service.js";

/** Seazona rate-limits hard: concurrency 8 failed 448/476. Serial + spaced. */
const SEAZONA_SPACING_MS = 110;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Open invoices for a doctor with balances from the LOCAL ledger. */
async function openInvoicesFor(doctor) {
  const [invoices, paidMap] = await Promise.all([
    seazonaService.getInvoices("1900-01-01T00:00:00Z"),
    getPortalPaidMap(doctor.id),
  ]);
  return (invoices || [])
    .filter((inv) => String(inv.clientId) === String(doctor.seazonaClientId))
    .map((inv) => ({
      id: String(inv.id),
      invoiceNumber: inv.invoiceNumber != null ? String(inv.invoiceNumber) : null,
      balance: round2(Number(inv.total || 0) - Number(paidMap[String(inv.id)] || 0)),
      dueDate: inv.due || null,
    }))
    .filter((inv) => inv.balance > 0);
}

/**
 * Run one enrollment for one cycle. Returns the attempt row it wrote.
 * Never throws — a single doctor's failure must not abort the sweep.
 */
export async function processEnrollment({ enrollment, doctor, invoices, dryRun, now, runId, log }) {
  const cycleKey = cycleKeyFor(now, env.AUTOPAY_TIMEZONE);
  const scheduledFor = now.toISOString().slice(0, 10);

  const base = {
    id: createId(),
    enrollmentId: enrollment.id,
    userId: doctor.id,
    jobRunId: runId || null,
    cycleKey,
    scheduledFor,
    dryRun: Boolean(dryRun),
  };

  const write = async (row) => {
    await db.insert(autopayAttempts).values(row);
    return row;
  };

  const totalBalance = round2((invoices || []).reduce((s, i) => s + i.balance, 0));
  const chargeAmount = resolveChargeAmount({ enrolledAmount: Number(enrollment.amount), totalBalance });

  if (chargeAmount <= 0) {
    // Nothing owed — the doctor has paid off. Stop charging them.
    await db
      .update(autopayEnrollments)
      .set({ status: "completed", lastRunAt: now, updatedAt: now })
      .where(eq(autopayEnrollments.id, enrollment.id));
    return write({ ...base, status: "skipped", failureReason: "no outstanding balance" });
  }

  const { allocations, totalAllocated } = allocateOldestFirst(invoices, chargeAmount);

  if (dryRun) {
    return write({
      ...base,
      status: "would_charge",
      amountAttempted: totalAllocated.toFixed(2),
      allocations,
    });
  }

  try {
    const result = await withIdempotency(
      redis,
      `autopay:${enrollment.id}:${cycleKey}`,
      async () =>
        withInvoiceLocks(redis, allocations.map((a) => a.invoiceId), async () => {
          const charge = await authorizenetService.chargeCustomerProfile({
            customerProfileId: doctor.authorizeNetCustomerProfileId,
            paymentProfileId: enrollment.paymentProfileId,
            amount: totalAllocated,
            invoiceNumber: allocations[0]?.invoiceNumber,
          });
          await recordPaymentAndAllocations({
            user: doctor,
            amount: totalAllocated,
            transactionId: charge.transactionId,
            allocations,
            source: "autopay",
          });
          return charge;
        }, { log }),
      { log }
    );

    await db
      .update(autopayEnrollments)
      .set({ lastRunAt: now, lastChargedAt: now, consecutiveFailures: 0, updatedAt: now })
      .where(eq(autopayEnrollments.id, enrollment.id));

    return write({
      ...base,
      status: "succeeded",
      amountAttempted: totalAllocated.toFixed(2),
      amountCharged: totalAllocated.toFixed(2),
      transactionId: result.result?.transactionId ?? result.transactionId ?? null,
      allocations,
    });
  } catch (err) {
    const failures = Number(enrollment.consecutiveFailures || 0) + 1;
    const shouldPause = failures >= Number(env.AUTOPAY_MAX_FAILURES);

    await db
      .update(autopayEnrollments)
      .set({
        lastRunAt: now,
        consecutiveFailures: failures,
        ...(shouldPause ? { status: "paused", pausedReason: "consecutive_failures" } : {}),
        updatedAt: now,
      })
      .where(eq(autopayEnrollments.id, enrollment.id));

    // Notify, soft-fail — an email problem must not mask the payment failure.
    await emailService
      .sendAutopayFailure({
        email: doctor.email,
        name: doctor.name,
        amount: totalAllocated,
        reason: err?.message || "Card declined",
        paused: shouldPause,
      })
      .catch(() => {});

    return write({
      ...base,
      status: "failed",
      amountAttempted: totalAllocated.toFixed(2),
      allocations,
      failureReason: String(err?.message || err).slice(0, 500),
    });
  }
}

/** Sweep every enrollment due today. */
export async function runAutopaySweep({ dryRun = true, now = new Date(), log, runId } = {}) {
  const rows = await db
    .select({
      enrollment: autopayEnrollments,
      doctor: {
        id: users.id,
        email: users.email,
        name: users.name,
        seazonaClientId: users.seazonaClientId,
        seazonaAccountNumber: users.seazonaAccountNumber,
        authorizeNetCustomerProfileId: users.authorizeNetCustomerProfileId,
      },
    })
    .from(autopayEnrollments)
    .innerJoin(users, eq(users.id, autopayEnrollments.userId))
    .where(and(eq(autopayEnrollments.enabled, true), eq(autopayEnrollments.status, "active")));

  const due = rows.filter(({ enrollment }) => isDueOn(enrollment.dayOfMonth, now, env.AUTOPAY_TIMEZONE));

  const summary = { considered: due.length, charged: 0, skipped: 0, failed: 0, wouldCharge: 0, totalAmount: 0 };

  for (const { enrollment, doctor } of due) {
    // Serialized on purpose — Seazona rate-limits.
    await sleep(SEAZONA_SPACING_MS);
    try {
      const invoices = await openInvoicesFor(doctor);
      const attempt = await processEnrollment({ enrollment, doctor, invoices, dryRun, now, runId, log });
      if (attempt.status === "succeeded") { summary.charged++; summary.totalAmount = round2(summary.totalAmount + Number(attempt.amountCharged)); }
      else if (attempt.status === "would_charge") { summary.wouldCharge++; summary.totalAmount = round2(summary.totalAmount + Number(attempt.amountAttempted)); }
      else if (attempt.status === "failed") summary.failed++;
      else summary.skipped++;
    } catch (err) {
      summary.failed++;
      log?.error?.({ err, enrollmentId: enrollment.id }, "autopay enrollment threw outside processEnrollment");
    }
  }

  return summary;
}
```

- [ ] **Step 4: Replace the job definition**

```js
import { defineJob } from "../registry.js";
import { runAutopaySweep } from "../../services/autopay-runner.service.js";
import { env } from "../../config/env.js";

defineJob({
  name: "autopay",
  description: "Charge enrolled doctors their monthly AutoPay amount",
  handler: async ({ dryRun, log, runId }) => {
    // TWO independent switches. The runner's own dryRun flag AND the
    // AUTOPAY_LIVE_RUN environment gate must both permit a charge. A
    // misconfigured scheduler alone cannot move money.
    const effectiveDryRun = dryRun || !env.AUTOPAY_LIVE_RUN;
    if (dryRun !== effectiveDryRun) {
      log?.warn?.("AutoPay asked for a live run but AUTOPAY_LIVE_RUN is false — running dry");
    }
    return runAutopaySweep({ dryRun: effectiveDryRun, log, runId });
  },
});
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @my-app/api exec vitest run src/jobs/definitions/autopay.job.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/autopay-runner.service.js apps/api/src/jobs/definitions
git commit -m "feat(autopay): the sweep — allocation, charging, retries, dry-run gate"
```

---

## Task 13: Failure notification email

**Files:**
- Modify: `apps/api/src/services/email.service.js`

**Interfaces:**
- Produces: `sendAutopayFailure({ email, name, amount, reason, paused }) -> Promise<boolean>`.

- [ ] **Step 1: Add the template**

Place it beside the other doctor emails, using the existing `esc` helper:

```js
/**
 * AutoPay charge failed. Sent to the doctor; the lab is copied via
 * ADMIN_NOTIFICATION_EMAIL so a paused enrollment does not go unnoticed.
 */
export async function sendAutopayFailure({ email, name, amount, reason, paused }) {
  return send({
    to: email,
    cc: env.ADMIN_NOTIFICATION_EMAIL,
    subject: paused ? "AutoPay paused — payment failed" : "AutoPay payment failed",
    html: `
      <h1>We couldn't process your AutoPay payment</h1>
      <p>Hello${name ? `, ${esc(name)}` : ""} — your scheduled AutoPay payment of
         <strong>$${Number(amount).toFixed(2)}</strong> did not go through.</p>
      <p style="color:#5a6b7b;">Reason: ${esc(reason)}</p>
      ${paused
        ? `<p style="padding:12px;border-left:4px solid #f59e0b;background:#fffbeb;">
             We've <strong>paused</strong> your AutoPay after repeated failures. Update your
             card and contact the lab to resume — no further attempts will be made until then.
           </p>`
        : `<p>We'll try again in a couple of days. You can also update your card or pay
             manually from your portal at any time.</p>`}
      <p><a href="${env.APP_URL}/doctor/saved-cards" style="display:inline-block;padding:12px 24px;background:#13AEEF;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;">Update your card</a></p>
    `,
  });
}
```

If `send()` does not currently support `cc`, add it:

```js
  if (cc) form.set("cc", cc);
```

and accept `cc` in the destructured parameter list.

- [ ] **Step 2: Verify it renders without sending**

With Mailgun unconfigured, `send()` logs instead of sending:

```bash
cd apps/api && node --env-file=.env -e "
const s = await import('./src/services/email.service.js');
await s.sendAutopayFailure({ email:'d@x.com', name:'<b>Doc</b>', amount:500, reason:'Card declined', paused:true });
"
```

Expected: an `[EMAIL] To: d@x.com | Subject: AutoPay paused — payment failed` line, and in dev the body preview shows `&lt;b&gt;Doc&lt;/b&gt;` — proving the escape works.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/email.service.js
git commit -m "feat(autopay): failure and pause notification email"
```

---

## Task 14: Fix `/admin/invoices` balances

**Files:**
- Modify: `apps/api/src/routes/invoice.routes.js:70-105`

**Interfaces:**
- Consumes: `listAllPayments` from `invoice-ledger.service.js`.
- Produces: `/admin/invoices` returning real `portalPaidAmount` / `portalBalance` / `portalPaid`.

- [ ] **Step 1: Add a bulk paid-map helper**

In `invoice-ledger.service.js`:

```js
/**
 * Applied totals for EVERY invoice across all users, keyed by seazonaInvoiceId.
 * The admin invoice list needs balances for many doctors at once; calling
 * getPortalPaidMap per user would be N queries. Soft-fails to {} — this is a
 * display path, never a guard.
 */
export async function getGlobalPortalPaidMap() {
  try {
    const rows = await db
      .select({
        seazonaInvoiceId: invoicePayments.seazonaInvoiceId,
        totalPaid: sql`sum(${invoicePayments.appliedAmount})`.as("total_paid"),
      })
      .from(invoicePayments)
      .groupBy(invoicePayments.seazonaInvoiceId);
    return Object.fromEntries(rows.map((r) => [String(r.seazonaInvoiceId), parseFloat(r.totalPaid || 0)]));
  } catch (err) {
    console.error("[invoiceLedger] getGlobalPortalPaidMap failed — degrading to empty:", err);
    return {};
  }
}
```

- [ ] **Step 2: Use it in the admin route**

Replace the `normalizeInvoice(inv)` call (which passed no paid figure, so every invoice reported unpaid) and delete the stale comment at `:81`:

```js
    const paidMap = await getGlobalPortalPaidMap();
    const normalized = invoices.map((inv) => normalizeInvoice(inv, paidMap[String(inv.id)] || 0));
```

- [ ] **Step 3: Verify**

```bash
curl -s localhost:3000/api/v1/admin/invoices -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq '[.data.invoices[] | select(.portalPaidAmount > 0)] | length'
```

Expected: greater than 0 if any payments exist locally (previously always 0).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/invoice.routes.js apps/api/src/services/invoice-ledger.service.js
git commit -m "fix(admin): report real invoice balances instead of always-unpaid"
```

---

## Task 15: Backfill `invoice_payments.source`

**Files:**
- Create: `apps/api/src/db/backfill-payment-source.js`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write the script**

```js
/**
 * One-off backfill for invoice_payments.source.
 *
 * Origin used to be encoded only in the transactionId prefix. Derive the new
 * column from those prefixes so historical rows are classifiable alongside new
 * ones. Idempotent — only touches rows where source IS NULL.
 *
 *   DRY_RUN=1 pnpm db:backfill-payment-source
 */
import { db, queryClient } from "../config/database.js";
import { invoicePayments } from "./schema/index.js";
import { isNull, sql } from "drizzle-orm";

const DRY_RUN = process.env.DRY_RUN === "1";

const rows = await db
  .select({ id: invoicePayments.id, transactionId: invoicePayments.transactionId, refunds: invoicePayments.refundsTransactionId })
  .from(invoicePayments)
  .where(isNull(invoicePayments.source));

function classify(row) {
  if (row.refunds) return "refund";
  const tx = String(row.transactionId || "");
  if (tx.startsWith("OFFLINE-")) return "admin_offline";
  if (tx.startsWith("REFUND-PENDING-")) return "refund";
  // Everything else predates AutoPay and admin charging, so it came from a
  // doctor-initiated charge. We cannot distinguish saved-card from hosted
  // retroactively; doctor_card is the honest umbrella.
  return "doctor_card";
}

const counts = {};
for (const row of rows) {
  const source = classify(row);
  counts[source] = (counts[source] || 0) + 1;
  if (!DRY_RUN) {
    await db.execute(sql`update invoice_payments set source = ${source} where id = ${row.id}`);
  }
}

console.log(`${DRY_RUN ? "[dry run] would set" : "set"} source on ${rows.length} rows:`, counts);
await queryClient.end();
```

- [ ] **Step 2: Add the script entry**

```json
    "db:backfill-payment-source": "node --env-file=.env src/db/backfill-payment-source.js",
```

- [ ] **Step 3: Dry-run, then apply**

```bash
cd apps/api && DRY_RUN=1 pnpm db:backfill-payment-source
pnpm db:backfill-payment-source
psql "$DATABASE_URL" -c "select source, count(*) from invoice_payments group by source;"
```

Expected: the dry run reports counts and changes nothing; after the real run no `source` is NULL.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/backfill-payment-source.js apps/api/package.json
git commit -m "chore(payments): backfill payment source from transaction id prefixes"
```

---

## Task 16: Doctor AutoPay page

**Files:**
- Create: `apps/web/src/pages/doctor/AutoPayPage.jsx`
- Modify: `apps/web/src/config/routes.js`, `apps/web/src/App.jsx`, the doctor nav in `DoctorShell`

- [ ] **Step 1: Add the route constant**

In `routes.js`, beside the other doctor keys:

```js
  DOCTOR_AUTOPAY: "/doctor/autopay",
```

- [ ] **Step 2: Build the page**

```jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { autopayEnrollSchema } from "@my-app/shared";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import api from "../../config/api.js";

export default function AutoPayPage() {
  const { addToast } = useToast();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm({ resolver: zodResolver(autopayEnrollSchema) });

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/autopay");
      setState(data.data);
      if (data.data.enrollment) {
        reset({
          amount: data.data.enrollment.amount,
          dayOfMonth: data.data.enrollment.dayOfMonth,
          paymentProfileId: data.data.enrollment.paymentProfileId,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onSubmit = async (form) => {
    try {
      await api.put("/autopay", { ...form, amount: Number(form.amount), dayOfMonth: Number(form.dayOfMonth), enabled: true });
      addToast({ message: "AutoPay saved.", type: "success" });
      load();
    } catch (err) {
      addToast({ message: err.response?.data?.error?.message || "Could not save AutoPay.", type: "error" });
    }
  };

  const cancel = async () => {
    await api.delete("/autopay");
    addToast({ message: "AutoPay cancelled.", type: "success" });
    load();
  };

  if (loading) return <p className="p-6 text-sm text-gray-500">Loading…</p>;

  // A card on file is a hard requirement, enforced server-side too.
  if (!state.canEnroll) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">AutoPay</h1>
        <p className="mt-3 text-sm text-gray-600">
          AutoPay needs a card on file. Add one and come back.
        </p>
        <Link to="/doctor/saved-cards" className="mt-4 inline-block">
          <Button>Add a card</Button>
        </Link>
      </div>
    );
  }

  const e = state.enrollment;

  return (
    <div className="max-w-xl p-6">
      <h1 className="text-2xl font-semibold">AutoPay</h1>
      <p className="mt-2 text-sm text-gray-600">
        Pay a set amount each month toward your open invoices, oldest first, until they're paid off.
        If your balance is less than your AutoPay amount, we charge only the balance.
      </p>

      {e?.enabled && (
        <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm">
          <strong>Active</strong> — ${e.amount.toFixed(2)} on day {e.dayOfMonth}.
          {e.nextRunDate && <> Next payment {e.nextRunDate}.</>}
          {e.status === "paused" && <div className="mt-2 text-amber-700">Paused: {e.pausedReason}</div>}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <Input
          label={`Monthly amount (minimum $${state.minAmount.toFixed(2)})`}
          type="number" step="0.01" min={state.minAmount}
          error={errors.amount?.message}
          {...register("amount", { valueAsNumber: true })}
        />
        <Input
          label="Day of month"
          type="number" min={1} max={31}
          error={errors.dayOfMonth?.message}
          {...register("dayOfMonth", { valueAsNumber: true })}
        />
        <p className="-mt-2 text-xs text-gray-500">
          Days after the 28th are charged on the last day of shorter months.
        </p>
        <label className="block text-sm font-medium">
          Card
          <select className="mt-1 w-full rounded-lg border p-2" {...register("paymentProfileId")}>
            {state.cards.map((c) => (
              <option key={c.paymentProfileId} value={c.paymentProfileId}>
                {c.cardType} {c.cardNumber} — exp {c.expirationDate}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-3">
          <Button type="submit" loading={isSubmitting}>{e ? "Update AutoPay" : "Enroll in AutoPay"}</Button>
          {e && <Button type="button" variant="secondary" onClick={cancel}>Cancel AutoPay</Button>}
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Wire the route**

In `App.jsx`, inside the `/doctor` + `DoctorShell` block:

```jsx
<Route path="autopay" element={<AutoPayPage />} />
```

Add an "AutoPay" link to the doctor nav in `DoctorShell`.

- [ ] **Step 4: Verify in the browser**

```bash
pnpm --filter @my-app/web dev
```

Log in as the test doctor, visit `/doctor/autopay`. With no card on file, expect the "Add a card" prompt. Add a card via the hosted iframe, reload, enroll at $200, and confirm the active banner shows the next payment date.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(autopay): doctor enrollment page"
```

---

## Task 17: Admin AutoPay + doctor payment drawer

**Files:**
- Create: `apps/web/src/pages/app/AdminAutoPayPage.jsx`, `apps/web/src/components/admin/DoctorPaymentDrawer.jsx`
- Modify: `apps/web/src/App.jsx`, `apps/web/src/config/routes.js`, `apps/web/src/pages/app/AdminUsersPage.jsx`

- [ ] **Step 1: Add route constants**

```js
  ADMIN_AUTOPAY: "/admin/autopay",
  ADMIN_JOBS: "/admin/jobs",
```

- [ ] **Step 2: Build `AdminAutoPayPage.jsx`**

A table over `GET /admin/autopay` with columns: doctor, account number, amount, day, status, consecutive failures, last charged, and actions (toggle enabled, pause/resume, open drawer). Toggling calls `PUT /admin/users/:userId/autopay` with the existing values plus the flipped `enabled`. Pause/resume call the dedicated endpoints. Show a banner when `liveRun` is false:

```jsx
{!data.liveRun && (
  <div className="rounded-2xl border-l-4 border-amber-500 bg-amber-50 p-4 text-sm">
    <strong>Dry-run mode.</strong> AUTOPAY_LIVE_RUN is off — scheduled runs compute
    and record what they would charge, but no card is charged.
  </div>
)}
```

- [ ] **Step 3: Build `DoctorPaymentDrawer.jsx`**

One place with the full parity surface for a selected doctor:
- **Cards** — list from `GET /admin/users/:userId/saved-cards`; "Add card" opens the hosted iframe using `POST /admin/users/:userId/saved-cards/hosted-token` (reuse `HostedAddCardForm.jsx`, parameterizing its token endpoint); set-default and delete buttons.
- **Charge** — invoice picker with FIFO auto-allocation, posting to `POST /admin/users/:userId/payments/charge-saved` with a fresh `crypto.randomUUID()` `Idempotency-Key`.
- **Offline payment** — the existing `OfflinePaymentModal` flow.
- **AutoPay** — amount, day, card, enabled toggle, and a floor-override field (admin only), posting to `PUT /admin/users/:userId/autopay`.

- [ ] **Step 4: Generalize `HostedAddCardForm`**

It currently hardcodes `/payments/saved-cards/hosted-token`. Add a `tokenEndpoint` prop defaulting to that value so the admin drawer can pass the on-behalf endpoint without duplicating the component.

- [ ] **Step 5: Wire routes and a link from `AdminUsersPage`**

Add both routes inside the `RequireAdmin` block, and a "Payments" action per row in `AdminUsersPage` that opens the drawer.

- [ ] **Step 6: Verify in the browser**

As an admin: open a doctor's drawer, add a card via the hosted iframe, set it default, enroll them in AutoPay below the floor using an override, then toggle the enrollment off. Confirm each action appears in `/admin/payments` audit history.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(admin): AutoPay table and per-doctor payment drawer"
```

---

## Task 18: Admin jobs page

**Files:**
- Create: `apps/web/src/pages/app/AdminJobsPage.jsx`
- Modify: `apps/web/src/App.jsx`

- [ ] **Step 1: Build the page**

Lists `GET /admin/jobs`, recent runs from `GET /admin/jobs/runs` (name, trigger, dry-run flag, status, started, duration, summary JSON), and a "Run dry" button posting `{ dryRun: true }` to `POST /admin/jobs/:name/run`. Render the returned summary inline — `wouldCharge` and `totalAmount` are what gate going live.

Do **not** add a live-run button. Going live is an environment change reviewed deliberately, not a click.

- [ ] **Step 2: Wire the route inside `RequireAdmin`**

- [ ] **Step 3: Verify**

Trigger a dry run from the UI; confirm a `job_runs` row appears with `dryRun: true` and the summary renders.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "feat(admin): jobs page with dry-run trigger and run history"
```

---

## Task 19: Production scheduling

**Files:**
- Modify: `cloudbuild.yaml`
- Create: `docs/autopay-operations.md`

- [ ] **Step 1: Add the jobs Cloud Run Job to `cloudbuild.yaml`**

Mirror the existing `migrate` step's shape, but only update the image — never `--execute-now`, because deploying must not trigger a sweep:

```yaml
  # 3b. Point the jobs Cloud Run Job at the freshly built image. NOT executed
  #     here — Cloud Scheduler invokes it on its own cadence. Deploying must
  #     never trigger a payment sweep.
  - id: update-jobs
    name: gcr.io/google.com/cloudsdktool/cloud-sdk
    entrypoint: gcloud
    args:
      - run
      - jobs
      - update
      - ${_JOBS_JOB}
      - --image=${_REPO}:${SHORT_SHA}
      - --region=${_REGION}
```

Add `_JOBS_JOB: diamond-labs-jobs` to `substitutions`.

- [ ] **Step 2: Write `docs/autopay-operations.md`**

Document the one-time GCP setup as copy-pasteable commands — the job creation with `--command`/`--args` pointing at `src/jobs/cli.js autopay`, the Cloud Scheduler job at `0 9 * * *` in `America/Chicago` targeting it, and the required secrets. Include the go-live checklist:

1. Confirm `autopay_attempts` has `would_charge` rows with sane amounts and allocations.
2. Confirm no doctor is enrolled who should not be (`select * from autopay_enrollments where enabled = true`).
3. Set `AUTOPAY_LIVE_RUN=true` in Secret Manager and redeploy.
4. Watch the first live run's `job_runs` summary and `autopay_attempts`.

Also document the rollback: set `AUTOPAY_LIVE_RUN=false` and redeploy — enrollments are preserved and the sweep reverts to dry-run.

- [ ] **Step 3: Commit**

```bash
git add cloudbuild.yaml docs/autopay-operations.md
git commit -m "ops(autopay): jobs Cloud Run Job and operations runbook"
```

---

## Task 20: End-to-end verification

- [ ] **Step 1: Full test suite**

Run: `pnpm --filter @my-app/api test`
Expected: all pass. Note the count; it should exceed 163 by roughly 60.

- [ ] **Step 2: Frontend build**

Run: `pnpm --filter @my-app/web build`
Expected: builds clean.

- [ ] **Step 3: Prove nobody is enrolled**

```bash
psql "$DATABASE_URL" -c "select count(*) as enrolled from autopay_enrollments where enabled = true;"
```

Expected: **0**. If not, something created an enrollment implicitly — find and remove it before proceeding.

- [ ] **Step 4: Prove a dry run charges nothing**

Manually enroll the test doctor via the UI, then:

```bash
cd apps/api && node --env-file=.env src/jobs/cli.js autopay --live
psql "$DATABASE_URL" -c "select status, count(*) from autopay_attempts group by status;"
```

Expected: because `AUTOPAY_LIVE_RUN=false`, the job logs the "running dry" warning and every attempt is `would_charge` or `skipped` — **zero** `succeeded`, and no new `invoice_payments` rows.

- [ ] **Step 5: Confirm the sweep is a no-op on a non-matching day**

Temporarily set the test enrollment's `dayOfMonth` to a day that is not today, re-run, and confirm `considered: 0`.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin feat/autopay-and-admin-parity
gh pr create --base main --title "feat(autopay): AutoPay enrollment + admin payment parity" --body "…"
```

The PR body must state: nobody is enrolled, `AUTOPAY_LIVE_RUN` is false, and going live is a separate deliberate change. Note that it stacks on PR #36.

---

## Self-Review Notes

**Spec coverage check:** §2 safety → Tasks 1, 2, 12, 20. §3 scheduler → Tasks 5, 6, 19. §4 data model → Tasks 1, 15. §5 enrollment rules → Task 8. §6 run semantics → Tasks 3, 4, 12, 13. §7 API surface → Tasks 9, 10, 11. §8 frontend → Tasks 16, 17, 18. §9 config → Task 2. §10 testing → distributed across every task. §12 follow-ups → the `/admin/invoices` fix is Task 14; the Accept.js build-arg gap and the `seazonaClientId` uniqueness constraint remain open and are called out in the PR body rather than fixed here.

**Deliberately deferred:** the `users.seazonaClientId` unique constraint. Adding it could fail against existing production data if duplicates exist; it needs a data audit first. AutoPay does not make it worse — the sweep is per-enrollment and enrollments are unique per user.
