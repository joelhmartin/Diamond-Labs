# Own-the-lab follow-ups (piece 12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the follow-ups parked by pieces 9, 11 and PR #60 on `feat/own-the-lab`, in one branch (`feat/own-the-lab-followups`).

**Architecture:** No new subsystems. Each item extends the module or glue that already owns the job: record-tags for sales reps, the reports `lookup` param type for practice/group filters, `services/practice.js` + `packages/shared` for party keys, the shared DataTable for table minors, and one CSV/export path shared by `modules/reports` and `modules/exports`.

**Tech Stack:** Fastify 5, Drizzle (Postgres), zod, React + Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-lab-parity-roadmap.md` (binding rules), plus the parked lists in the piece 9 and piece 11 reports and PR #60's "Deferred minors".

## Global Constraints

- Generic modules (`apps/api/src/modules/*`, `apps/web/src/modules/*`) contain no lab/doctor/dental/rx/patient words (`module-vocabulary.test.js`; `modules/organizations` also bans "practice" and "client").
- Files under 1,000 lines, functions under 150 (300 for a component with markup).
- No `alert` / `confirm` / `prompt`; destructive steps use the inline `ConfirmButton`.
- Every list uses the shared `DataTable` (`apps/web/src/components/ui/data-table/`).
- Any client-facing read goes through `services/client-scope.js`. `no-seazona-authz.test.js` stays green with an empty allow-list.
- Nothing calls Seazona. No PHI in code, fixtures, logs or reports. Money is integer cents.
- Migrations are generated (`cd apps/api && pnpm db:generate`), never hand-merged. The latest on the base is `0045_lab_timezone_pacific` (PR #76, merged).
- DB-backed tests use a scratch database on `postgresql://bif@localhost:5432`, never `diamond_labs`.
- Suites: `cd apps/api && npx vitest run`, `cd apps/web && npx vitest run`, `cd packages/shared && npx vitest run`; build: `pnpm --filter @my-app/web build`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A lab-role (non-admin) user must not be able to list or assign sales reps (`client_rep` apply and definition routes stay admin-only; the client picker is in admin screens only).
2. A report run with a practice or group filter must count only that practice's/group's records, and a practice id from a different group must not widen the result.
3. Moving `practiceLabel` / party-key helpers to shared must produce byte-identical strings on API and web (`"Name (1001)"`, `practice:<id>`).
4. `loadPayingClient` accepting a non-doctor group admin must still refuse a user who administers no practice (no payment recorded against an arbitrary user).
5. The reports CSV after consolidation must be byte-identical to today's for an existing report (header, CRLF, formula neutralising, no BOM change unless ruled).

---

### Task 1: Sales reps as record-tags configuration

**Files:** `apps/web/src/pages/app/AdminLabelsPage.jsx` (+ test), the admin client/practice screen that lists clients (likely `AdminUsersPage.jsx` or `AdminPracticesPage.jsx`; pick the one where staff manage a client), `apps/web/src/modules/record-tags/*` (reuse its picker), `apps/api/src/services/lab/reports/sales.reports.js` (notice when no reps exist).

- [ ] Labels admin gains a record-type switch (Order labels / Sales reps) that drives the existing record-tags definition UI with `recordType` `lab_order` or `client_rep`. No new component family.
- [ ] Rep picker on clients (admin only), using the record-tags apply endpoint for `client_rep`; single-select is enough.
- [ ] `sales.by-rep` returns a notice "No sales reps are set up yet." when no active `client_rep` definitions exist.
- [ ] Tests: labels page switches record type and calls `/admin/tags/client_rep`; rep picker applies a tag; a lab-role render does not show the picker; sales report notice.
- [ ] Commit.

### Task 2: Practice and group filters on client-bearing reports

**Files:** `apps/api/src/services/lab/reports/lookups.js`, `report-helpers.js`, the client-bearing report files under `apps/api/src/services/lab/reports/`, `packages/shared/src/reports/` only if a generic param change is needed, web `ReportParamsForm` only if the lookup UI needs it.

**Interfaces — Produces:** lookups `practice` (accounts with `is_client`) and `organization`; a helper in `report-helpers.js` `practiceFilterSql({ practice, organization }, accountIdColumn)` returning a Drizzle `sql` fragment (or `sql\`true\``) used by every client-bearing report; a shared param spec constant (e.g. `PRACTICE_PARAMS`) spread into those reports' `params`.

- [ ] Use the existing generic `lookup` param type; the module gains no lab words.
- [ ] Filter by the record's `account_id`; organization → its member accounts via `organization_accounts`.
- [ ] Tests: lookup lists only client accounts; a report with `practice=<id>` adds the filter; `organization=<id>` resolves to member accounts; unknown id → empty result, not error; vocabulary guard green.
- [ ] Commit.

### Task 3: Piece 11 API residuals

**Files:** `packages/shared/src/` (new `practices/` helper file + index export), `apps/api/src/services/practice.js`, `apps/web/src/lib/practices.js` and its importers, schema files for `rx_cases` / `lab_orders` / `invoices` (FK ruling), invitation service/migration, `services/billing/invoice-actions.service.js` (`loadPayingClient`), `services/lab/lab-shipping.service.js` / `lab-notifications.js` (shipped audience), `services/client-scope.js` (`?account=` empty).

- [ ] Shared `practiceLabel({ name, accountNumber })` and `practiceKeyFor({ accountId, ownerId })` / `parsePartyKey`; API and web import them; web duplicates deleted.
- [ ] FKs: add `account_id → accounts.id` (on delete restrict or set null — implementer rules from how accounts are deleted) in the lab schema files, which are glue, not modules; generic modules untouched. Generate the migration.
- [ ] Stale pending invitations into `is_client` accounts: revoke them (generated migration with a data statement, or a status update in the same migration), and revoke pending invitations when an account becomes a practice.
- [ ] `loadPayingClient` accepts a user who is a doctor OR an active admin/owner of a practice (via client-scope); anyone else still refused.
- [ ] Shipped-order alerts use the practice audience (the same audience resolver the other practice alerts use), falling back to the doctor for a null-account order.
- [ ] Empty `?account=` behaves per the piece 11 spec (implementer reads the spec, rules, and tests it).
- [ ] Tests for each bullet; commit per bullet or grouped.

### Task 4: Piece 11 web residuals

**Files:** user picker (`PickerModal` / where `/admin/users` is sliced), `AdminPracticesPage.jsx` (groups cap), `PaymentsPage` (admin), `components/marketing/Navbar.jsx`, `apps/api` users list route if it lacks paging/search params.

- [ ] User picker pages server-side (`limit`/`offset`/`search` on `/admin/users`, or the server mode of `usePagedList`).
- [ ] Groups filter fetches without the 200 cap (page through or a server-side lookup).
- [ ] PaymentsPage gains a Practice column (`practiceColumn.jsx`).
- [ ] Navbar uses the same `useRoleHome` / `hasPractices` path as `lib/post-auth.js`.
- [ ] Tests for each; commit.

### Task 5: Piece 9 M4 + M5

**Files:** `apps/api/src/services/lab/reports/lab-metrics.js` (+ new DB-backed test), `dashboards.js`.

- [ ] DB-backed parity test: scratch DB, fixtures for several (received, shipped, calendar) cases including weekends, holidays and same-day; compare `businessDaysSql` to `businessDaysBetween`. Skips when Postgres is unreachable.
- [ ] Memoize `boardTiles(db, now)` per dashboard run (per-ctx cache keyed on `now`); test that one dashboard run calls it once.
- [ ] Commit.

### Task 6: DataTable deferred minors (PR #60)

**Files:** `apps/web/src/components/ui/data-table/*`, the named pages and their tests.

- [ ] Esc clears selection only when the event isn't from an input/modal.
- [ ] URL mirror reads back on popstate / sidebar link (filters reset).
- [ ] Server mode: no extra fetch per search; selection survives page change.
- [ ] Row checkboxes labelled per row; `aria-selected` only where the role supports it.
- [ ] Receivables totals row follows the checkbox column; empty message honours search.
- [ ] Rx cases: test for loading resolved cases; clearing the status multiselect returns to the open queue.
- [ ] Page tests for Admin Orders/Shipments params and AutoPay/Jobs filters.
- [ ] Board uses `useLatestRequest`.
- [ ] Doctor Cases and Payments: drop row selection where CSV is the only bulk action (export the filtered list instead).
- [ ] Commit.

### Task 7: One CSV/export path for reports and exports

**Files:** `apps/api/src/modules/reports/csv.js`, `apps/api/src/modules/exports/*`, web `modules/exports/ParamsForm.jsx` vs `modules/reports/ReportParamsForm.jsx`, shared `packages/shared/src/exports/csv.js`.

- [ ] Implementer maps the overlap (registry, params, paged CSV, ParamsForms) and picks the seam: one paged-stream writer and one param-spec validator used by both; one ParamsForm. Reports may register as export sources if that falls out cleanly.
- [ ] Reports CSV output stays byte-identical (golden test before the refactor).
- [ ] If the full merge is materially bigger than the rest of this plan, land the clean seam and record the remainder as a ruling.
- [ ] Commit.

### Task 8: AdminRxCaseDetailPage split + behavioural tests

**Files:** `apps/web/src/pages/app/AdminRxCaseDetailPage.jsx` → page + extracted section components/hooks under `apps/web/src/components/admin/rx-case/`; brittle source-regex tests (practices.service, hosted-complete wiring, parity SQL, `lab-metrics` text shape if Task 5 didn't replace it).

- [ ] Split under 1,000 lines along real seams; replace the three `window.confirm` with `ConfirmButton`.
- [ ] Tests: each former confirm path needs two clicks; page still renders the case.
- [ ] Convert source-regex tests to behavioural where a fake tx or render makes it cheap; leave and note any that are not cheap.
- [ ] Commit.
