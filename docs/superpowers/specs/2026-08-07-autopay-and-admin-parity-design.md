# AutoPay + Admin Payment Parity — Design

_2026-08-07_

Doctors can enroll in AutoPay: a fixed monthly amount, charged to a card on
file, on a day they choose, until their invoices are paid off. Admins get the
same abilities on behalf of any doctor — plus enrollment oversight, a floor
override, and run history.

This also introduces the repo's first scheduled-job subsystem. There is none
today: no cron, no Cloud Scheduler, no queue, no `jobs/` directory. The only
non-HTTP execution unit is the `diamond-labs-migrate` Cloud Run Job.

---

## 1. Constraints that shaped this

Established by reconnaissance, not assumption:

1. **No admin-initiated charge exists anywhere.** Admin can refund and void, but
   every charge path is gated on an authenticated doctor's own request. AutoPay
   is the first server-initiated charge in the system.
2. **Seazona cannot tell us anything about autopay.** The lab's green
   colour-coding is a Seazona UI construct — swept all 476 clients on both the
   list and single-client endpoints; there is no `color`/`flag`/`tag`/`autopay`
   field at any nesting level, and 30 plausible sibling endpoints 404. Existing
   enrollments can only arrive as a manual CSV from the lab.
3. **Cards cannot be imported.** The lab believed every doctor's card was in
   their Seazona notes. Only 4 of 476 clients (0.8%) contain card data. Admin
   and doctor card entry is therefore the *only* route to a card on file.
4. **Seazona rate-limits hard.** At concurrency 8, 448 of 476 requests failed;
   serial with ~110 ms spacing succeeded 476/476. Any sweep must be serialized
   and throttled.
5. **Accept.js is inert in production.** `apps/api/Dockerfile:22-25` declares
   the `VITE_AUTHORIZE_NET_*` build args, but `cloudbuild.yaml`'s build step
   passes no `--build-arg`, so the deployed bundle ships empty keys. The hosted
   Authorize.net iframe is the only working card path. All new card entry uses
   it — which also keeps the admin out of PCI scope.
6. **Paid state is local-only.** Seazona exposes no paid flag; balances come
   entirely from the `invoice_payments` ledger.
7. **`invoice_payments` has no `source` column.** Origin is encoded in a
   `transactionId` prefix (`OFFLINE-`, `REFUND-PENDING-`), and
   `summarizePayments` parses those rows.

**Prerequisite:** PR #36. Two of its fixes are load-bearing here — charges are
now verified as actually approved (`responseCode === "1"`), and the
over-allocation cap now fails closed. Unattended charging on top of the
pre-#36 behaviour would credit ledgers for uncaptured money and double-charge
across a transient DB error.

---

## 2. Safety posture

Non-negotiable for this phase: **nobody is enrolled, and nothing charges.**

| Gate | Default | Effect |
|---|---|---|
| `autopay_enrollments` row | none | Absence = not enrolled. No migration, backfill, or import creates one. |
| `enabled` column | `false` | Explicit opt-in by the doctor or an admin. |
| `AUTOPAY_LIVE_RUN` | `false` | The job runs, resolves balances, computes allocations, writes a full run record — and charges nothing. |
| `AUTOPAY_MIN_AMOUNT` | `200` | Enrollment floor. |

Two independent switches: neither "a doctor enrolled" nor "the job is
scheduled" can alone move money. This mirrors the existing gated-dark pattern
(`RX_LIVE_PUSH`, `SEAZONA_ORDER_USER_ID`).

Even a lab-supplied CSV of green-coded accounts sets a *suggestion* flag for
admin review; it never creates an enrollment.

---

## 3. Scheduler subsystem

Generic and provider-agnostic. AutoPay is its first consumer; `sync-seazona-products`
(whose header already says "safe to run on a schedule") can migrate onto it later.

### Structure

```
apps/api/src/jobs/
  registry.js        defineJob({ name, description, handler }), getJob, listJobs
  runner.js          runJob(name, { dryRun, trigger, actorId }) -> job_runs row
  cli.js             CLI entrypoint — what the Cloud Run Job executes
  triggers/
    http.js          POST /internal/jobs/:name/run  (Cloud Scheduler OIDC / shared secret)
    interval.js      in-process tick, local dev only
  definitions/
    autopay.job.js   the AutoPay sweep
```

**The registry knows nothing about GCP.** A job is a named async function.
`runner.js` owns the lifecycle: create a `job_runs` row, execute, record
outcome, never throw into the trigger. Swapping Cloud Run Jobs for ECS, Fly, or
a plain crontab means writing a new trigger adapter — no job code changes.

### Production wiring

Cloud Scheduler (daily, `America/Chicago`) → Cloud Run Job `diamond-labs-jobs`,
mirroring the existing `diamond-labs-migrate` job in `cloudbuild.yaml`. Same
image, different entrypoint. Runs off the request path, unreachable from the
internet, and not bounded by Cloud Run's request timeout.

`interval.js` exists so local dev can exercise the path without GCP. It is
never registered when `NODE_ENV === "production"`.

### Concurrency

The runner takes a `kv_store`-backed lock per job name, so two overlapping
invocations cannot both sweep. Because `config/redis.js` is Postgres-backed,
this lock is durable and multi-instance-safe — no new primitive needed.

---

## 4. Data model

### `autopay_enrollments` (new)

| column | type | notes |
|---|---|---|
| `id` | varchar(128) PK | |
| `userId` | varchar(128) **UNIQUE** | one enrollment per doctor |
| `enabled` | boolean, default **false** | the toggle |
| `amount` | numeric(12,2) | monthly charge |
| `dayOfMonth` | integer | 1–31, clamped to month length |
| `paymentProfileId` | varchar(100) | the card to charge |
| `status` | enum | `active` \| `paused` \| `completed` |
| `pausedReason` | varchar(255) | e.g. `consecutive_failures` |
| `consecutiveFailures` | integer, default 0 | |
| `minAmountOverride` | numeric(12,2), nullable | admin-set floor override |
| `lastRunAt` / `lastChargedAt` / `nextRunAt` | timestamptz | |
| `createdByUserId` / `updatedByUserId` | varchar(128) | self or admin |
| `createdAt` / `updatedAt` | timestamptz | |

### `autopay_attempts` (new)

One row per doctor per run — the audit trail, and what makes a dry run useful.

`id`, `enrollmentId`, `userId`, `jobRunId`, `scheduledFor` (date),
`status` (`skipped`\|`would_charge`\|`succeeded`\|`failed`), `amountAttempted`,
`amountCharged`, `transactionId`, `allocations` (jsonb), `failureReason`,
`dryRun` (boolean), `createdAt`.

`would_charge` is what a dry run records. Reading this table before flipping
`AUTOPAY_LIVE_RUN` is the acceptance gate.

### `job_runs` (new)

`id`, `jobName`, `trigger` (`schedule`\|`manual`\|`interval`), `status`
(`running`\|`succeeded`\|`failed`), `dryRun`, `startedAt`, `finishedAt`,
`summary` (jsonb), `error`, `actorUserId`.

### `invoice_payments.source` (new column)

`varchar(32)`, nullable. Values: `doctor_card`, `doctor_hosted`,
`admin_offline`, `admin_card`, `autopay`, `refund`.

Additive — existing rows stay null and `summarizePayments` is unaffected. A
backfill derives values from the existing `transactionId` prefixes. Without
this, AutoPay charges are indistinguishable from manual ones in every admin
view.

### Index

Add the missing index on `users.seazonaClientId` — `invoice.routes.js` looks
doctors up by it on every offline payment, and the AutoPay sweep will too.

---

## 5. Enrollment rules

- **A card on file is required.** Enrollment validates that the chosen
  `paymentProfileId` exists at the gateway under the doctor's
  `authorizeNetCustomerProfileId`. No card, no enrollment — enforced server-side
  on both the doctor and admin routes, not just in the UI.
- `amount >= minAmountOverride ?? AUTOPAY_MIN_AMOUNT`. Doctors cannot go below
  the floor; an admin can set a per-doctor override (grandfathered accounts,
  hardship), recorded in `audit_log`.
- `dayOfMonth` 1–31, **clamped** to the last day of shorter months — the 31st
  charges Feb 28.
- Deleting the enrolled card blocks the next run rather than silently falling
  back to another card: the run records `skipped` with
  `failureReason: "enrolled card no longer exists"` and notifies. Silent
  substitution would charge a card the doctor did not choose.

---

## 6. Run semantics

Daily, `America/Chicago`. For each enrollment where `enabled && status = active`
and today matches `dayOfMonth` (clamped) and it has not already charged this
cycle:

1. Fetch the doctor's Seazona invoices; compute portal balances from the ledger.
2. `totalBalance = Σ balances`. If `<= 0` → record `skipped`, set
   `status = completed`. Nothing to pay.
3. `chargeAmount = min(enrollment.amount, totalBalance)` — **the payoff rule.**
   A $500 enrollment against a $180 balance charges $180 and completes, even
   though $180 is under the floor. The floor governs enrollment, not payoff.
4. Allocate **oldest invoice first**, spilling into the next until consumed.
   Reuses the FIFO logic already in `PaymentModal.jsx:24-27,55-65`.
5. Under `withInvoiceLocks` + `withIdempotency("autopay:<enrollmentId>:<cycle>")`,
   re-verify the cap (fails closed post-#36), charge via
   `chargeCustomerProfile`, then `recordPaymentAndAllocations` with
   `source: "autopay"` — which writes the single account-level Seazona payment
   and the per-invoice local ledger rows, exactly as the manual paths do.
6. Requests to Seazona are **serialized with ~110 ms spacing** (constraint 4).

**Dry run** (`AUTOPAY_LIVE_RUN=false`) performs steps 1–4, records
`would_charge` attempts with full allocations, and stops before the charge.

### Declines

Retry on **day + 2** and **day + 5**. After 3 consecutive failures, set
`status = paused`, `pausedReason = consecutive_failures`, and email both the
doctor and the lab. Admin can resume. Repeated blind retries would push the
merchant account's decline ratio.

Because settlement webhooks were deliberately deferred, a charge is treated as
successful on `responseCode === "1"` — which, post-#36, genuinely means captured.

---

## 7. API surface

### Doctor (`requireApprovedDoctor`)

| Method | Path | Notes |
|---|---|---|
| GET | `/autopay` | own enrollment + next run date |
| PUT | `/autopay` | create/update — amount, dayOfMonth, paymentProfileId |
| DELETE | `/autopay` | unenroll |
| GET | `/autopay/attempts` | own run history |

### Admin (`requireAdmin`) — parity, on behalf of a doctor

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/autopay` | every enrollment, one table |
| GET/PUT/DELETE | `/admin/users/:userId/autopay` | enroll, update, unenroll; may set `minAmountOverride` |
| POST | `/admin/users/:userId/autopay/pause` \| `/resume` | |
| GET | `/admin/users/:userId/saved-cards` | **new** |
| POST | `/admin/users/:userId/saved-cards/hosted-token` | **new** — hosted add-card iframe on the doctor's behalf |
| PUT | `/admin/users/:userId/saved-cards/:profileId/default` | **new** |
| DELETE | `/admin/users/:userId/saved-cards/:profileId` | **new** |
| POST | `/admin/users/:userId/payments/charge-saved` | **new** — the first admin-initiated charge |
| GET | `/admin/jobs` \| `/admin/jobs/runs` | registry + history |
| POST | `/admin/jobs/:name/run` | manual trigger, **dry-run by default** |

Every admin action writes an `audit_log` row with the acting admin, the target
doctor, and the amount. `POST /admin/users/:userId/payments/charge-saved`
requires an `Idempotency-Key` and reuses `verifyAllocations` + `withInvoiceLocks`
+ `recordPaymentAndAllocations` — the same spine as the doctor path, with the
target doctor loaded from the DB instead of `request.user`.

`GET /admin/invoices` currently reports every invoice as unpaid
(`portalBalance === total`, acknowledged at `invoice.routes.js:81`). The admin
views here use per-user ledger data instead; fixing that endpoint is in scope
so the admin's balance figures are real.

---

## 8. Frontend

**Doctor** — `/doctor/autopay`: enrollment status card, enroll/edit form (amount,
day, card picker), cancel, attempt history. When no card is on file, the form is
replaced by a prompt linking to `/doctor/saved-cards`.

**Admin** — `/admin/autopay`: table of all enrollments with per-doctor toggle,
amount, day, card, status, next run, last result; filters for paused and failing.

**Admin — doctor detail drawer** (from `/admin/users` and `/admin/autopay`): the
parity surface in one place — saved cards (add via hosted iframe, set default,
delete), charge a card on file, record an offline payment, and the AutoPay
toggle with amount/day/floor-override.

**Admin — `/admin/jobs`**: registry, recent runs, dry-run trigger, and the
`would_charge` results that gate going live.

---

## 9. Configuration

```
AUTOPAY_LIVE_RUN=false            # false = compute and record, charge nothing
AUTOPAY_MIN_AMOUNT=200            # enrollment floor (dollars)
AUTOPAY_TIMEZONE=America/Chicago  # what "the 15th" means
AUTOPAY_MAX_FAILURES=3            # consecutive declines before pause
JOBS_TRIGGER_SECRET=              # shared secret for the HTTP trigger
```

All added to `apps/api/src/config/env.js` with Zod defaults, matching the
existing pattern.

---

## 10. Testing

The payment routes have **zero handler coverage** today —
`recordPaymentAndAllocations`, `verifyAllocations`, and `normalizeInvoice` are
module-private and untested. This feature does not inherit that.

- **Allocation** — oldest-first FIFO, spill, the payoff case (balance under the
  amount *and* under the floor), zero balance, single invoice.
- **Day-of-month clamping** — 31st in February, leap years, month boundaries
  across the configured timezone.
- **Enrollment validation** — floor enforcement, admin override, card-on-file
  requirement, deleted-card handling.
- **Run semantics** — dry run charges nothing but records `would_charge`;
  idempotency prevents a double charge within a cycle; a decline increments
  failures and pauses at the threshold.
- **Admin authorization** — every new admin route rejects doctor and plain-user
  roles. Given that `/payments/test/*` shipped guard-less, this gets an explicit
  test per route rather than trust.

CI already provisions Postgres, so the runner and allocation tests can hit a
real database.

---

## 11. Explicitly out of scope

- Automatic import of the lab's green-coded accounts (manual CSV → suggestion
  flag only, and only once the lab provides it).
- Programmatic card import from Seazona notes — not viable; 4 of 476.
- Authorize.net ARB. We charge CIM profiles on our own schedule, because the
  amount is balance-dependent and ARB's fixed-amount subscriptions cannot
  express the payoff rule.
- Settlement webhooks (deliberately deferred; see the capability audit).
- Refactoring the Seazona payment write into per-invoice payments — it must stay
  one account-level payment per charge or reconciliation breaks.

---

## 12. Follow-ups this surfaces

- **Guest checkout may be broken in production** — `/payments/checkout` depends
  on Accept.js nonces, and the deployed bundle ships empty keys (constraint 5).
  Needs verifying against prod; either pass the build args or move guest
  checkout to the hosted flow.
- **The 4 plaintext PANs in Seazona** (accounts 1324, 1009, 1220, 1236) need
  purging by the lab — a PCI-DSS storage violation independent of this work.
- **`users.seazonaClientId` has no unique constraint.** The over-allocation cap
  is user-scoped while the invoice mutex is invoice-scoped, so two portal logins
  sharing one Seazona client could each pay the same invoice in full. Latent
  today (the importer skips linked clients), but AutoPay increases the blast
  radius. Add the constraint or scope the cap by `seazonaClientId`.
