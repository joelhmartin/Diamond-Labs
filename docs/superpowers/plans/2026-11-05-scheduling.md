# Scheduling (piece 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generic business calendar and a generic turnaround-workflow module, wired into the lab so due dates default from a workflow, orders carry a stage schedule with behind/at-risk flags, the board shows daily tiles, a calendar page shows due load against capacity, and the slip prints the schedule.

**Architecture:** Two generic modules under `apps/api/src/modules/{business-calendar,workflows}/` (pure rules + Drizzle schema + service + routes factory + README), shared zod schemas under `packages/shared/src/<module>/`, UI under `apps/web/src/modules/<module>/`. Lab glue lives outside the modules: `services/lab/lab-scheduling.js` owns the `defaultDueAt()` seam that release, remake and piece 6's order entry call. Flags are computed on read; per-order plans are snapshotted in the generic `workflow_plans` table (`record_type = "lab_order"`).

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle ORM + drizzle-kit (Postgres 15), Zod (`@my-app/shared`), Vitest with `node:assert/strict`, repo fakes `apps/api/src/test/fake-tx.js`; React 18 + Vite + Tailwind, axios (`config/api.js`), lucide-react, shared `DataTable`/`useDataTable`.

**Spec:** `docs/superpowers/specs/2026-11-05-scheduling-design.md` (binding roadmap: `docs/superpowers/specs/2026-11-05-lab-parity-roadmap.md`).

**Estimated size:** ~70 files. One PR into `feat/own-the-lab`; this piece merges **first** (7 → 6 → 8 → 10 → 9).

## Global Constraints

- Worktree `/Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-3`; push only `git push origin <branch>`, never bare `git push`.
- Generic modules contain no lab/dental/doctor/patient words (code, comments, README, test names). Lab vocabulary (statuses, "lab_order", seed names) lives only in glue files. A test in Tasks 1 and 3 greps the module directories for `lab|doctor|patient|dental|rx` and fails on a hit.
- Shared interface names are fixed by the roadmap: `addBusinessDays(date, n, calendar)`, `isOpen(date, calendar)`, `capacityFor(date, calendar)`, `getCalendar(db)`, `planFor({ workflowKey, startAt, rush }, calendar)` → `{ dueAt, stages: [{ key, label, targetAt }] }`, `defaultDueAt()`.
- Dates are `"YYYY-MM-DD"` strings in the calendar's timezone; never `Date` arithmetic across DST. Use `Date.UTC` day math on parsed parts.
- Every list is `DataTable` + `useDataTable` (`apps/web/src/components/ui/data-table/`, `apps/web/src/hooks/useDataTable.js`) with bulk actions as config.
- No `alert`/`confirm`/`prompt`; destructive steps use `components/ui/ConfirmButton.jsx`; feedback via `useToast`.
- No DB foreign keys; ids via `createId()` (`apps/api/src/lib/id.js`), `varchar(128)`.
- Audit metadata: ids, keys, dates only (`routes/lab-route-helpers.js` `audit`). No PHI in logs or events.
- Files < 1,000 lines, functions < 150 (components 300).
- No Seazona calls; no browser tools.
- Tests: `pnpm --filter @my-app/api test`, `pnpm --filter @my-app/web test`, `pnpm --filter @my-app/shared test`; web tasks also `pnpm --filter @my-app/web build`.
- Migrations: `cd apps/api && pnpm db:generate`; custom SQL via `pnpm drizzle-kit generate --custom --name=<name>`. This piece owns them; later pieces regenerate theirs.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A holiday or closed day on the start date, the due date or inside the span (incl. a Dec 31 → Jan 2 span): `addBusinessDays` skips it and `n = 0` on a closed day rolls to the next open day. (Task 1 tests `skips holidays across the year boundary`, `n=0 on a closed day rolls forward`.)
2. A calendar that closes all seven weekdays would loop forever. `addBusinessDays`/`nextOpenDay` throw `CalendarError("NO_OPEN_DAYS")` and `saveCalendar` refuses it. (Task 1 test `all weekdays closed throws`, Task 2 test `refuses a calendar with no open weekday`.)
3. A doctor's requested date earlier than the workflow allows (or in the past): reverse planning never yields a stage target before the start date — targets clamp to `>= startDate`, the due date stays the requested date, and the order shows as at risk. (Task 3 test `reverse plan clamps targets to the start date`, Task 5 test `requested date before plan keeps the date and is at risk`.)
4. An on-hold order: ranked at `heldFrom`, counted in the on-hold tile, still behind if its stage target passed. (Task 5 test `on_hold ranks at heldFrom`, Task 6 test `on hold counts in onHold and atRisk independently`.)
5. Editing a workflow template does not move open orders' targets (plans are snapshots), and a deactivated workflow stays readable on orders that used it. (Task 4 test `editing a template leaves saved plans unchanged`, Task 4 test `deactivated workflows still resolve by key for existing plans`.)

---

### Task 1: Scaffold `business-calendar` (README, pure rules, shared schemas)

**Files:**
- Create: `apps/api/src/modules/business-calendar/README.md`, `rules.js`, `errors.js`, `index.js`
- Create: `packages/shared/src/business-calendar/calendar.schema.js`, `index.js`; Modify `packages/shared/src/index.js` (one export line)
- Test: `apps/api/src/modules/business-calendar/rules.test.js`, `packages/shared/src/business-calendar/calendar.schema.test.js`, `apps/api/src/modules/module-vocabulary.test.js`

**Interfaces (Produces):**
- `CalendarError(code, message)` — codes `NO_OPEN_DAYS | INVALID | NOT_FOUND | CONFLICT`.
- `DEFAULT_CALENDAR = { key: "default", timezone: "UTC", leadDays: 0, closedWeekdays: [], holidays: new Set(), capacityBasis: "none", capacityByWeekday: {} }`
- `toCalendar(row, holidayDates) → Calendar` (normalises jsonb, builds the Set).
- `dateIn(timezone, instant) → "YYYY-MM-DD"`
- `weekdayOf(date) → 0..6`, `addDays(date, n)`
- `isOpen(date, calendar) → boolean`
- `nextOpenDay(date, calendar) → date` (same day if open)
- `addBusinessDays(date, n, calendar) → date`; `subtractBusinessDays(date, n, calendar) → date` (n=0 → previous-or-same open day)
- `businessDaysBetween(from, to, calendar) → int` (open days in `(from, to]`; negative when `to < from`)
- `capacityFor(date, calendar) → number|null`
- `loadLevel(count, capacity) → "none"|"under"|"near"|"over"`
- `calendarDays(calendar, from, to, counts = new Map()) → [{ date, weekday, open, holiday: label|null, capacity, count, level }]` (holiday labels: pass `calendar.holidayLabels` Map when present)
- Shared: `calendarSettingsSchema` (`leadDays` 0–90, `closedWeekdays` unique ints 0–6 max 6 entries, `capacityBasis` enum, `capacityByWeekday` record "0".."6" → int ≥ 0 | null, `timezone` IANA string), `holidayCreateSchema` (`date` isoDate, `label` 1–80), `calendarDaysQuerySchema` (`from`, `to` isoDate, `basis` optional enum; refine `to >= from` and span ≤ 62 days), `CAPACITY_BASES = ["none","orders","units"]`.

- [ ] **Step 1: Write the failing tests** in `rules.test.js`:
  - `addBusinessDays skips weekends` — closed `[0,6]`, `addBusinessDays("2026-11-06", 1, cal) === "2026-11-09"` (Fri → Mon); `("2026-11-02", 13, cal) === "2026-11-19"`.
  - `skips holidays across the year boundary` — holidays `{2026-12-25, 2027-01-01}`, `addBusinessDays("2026-12-24", 2, cal) === "2026-12-29"`; `("2026-12-31", 1, cal) === "2027-01-04"`.
  - `n=0 on a closed day rolls forward` — `addBusinessDays("2026-11-07", 0, cal) === "2026-11-09"`.
  - `subtractBusinessDays mirrors addBusinessDays` — `("2026-11-09", 1, cal) === "2026-11-06"`.
  - `businessDaysBetween counts open days in (from, to]` — `("2026-11-06","2026-11-09") === 1`, reverse `=== -1`, same day `=== 0`.
  - `all weekdays closed throws` — `assert.throws(() => nextOpenDay("2026-11-02", { ...cal, closedWeekdays: [0,1,2,3,4,5,6] }), { code: "NO_OPEN_DAYS" })`.
  - `capacityFor returns null with basis none, 0 when closed, the weekday limit otherwise`.
  - `loadLevel thresholds` — `(0,null)→"none"`, `(10,40)→"under"`, `(34,40)→"near"`, `(41,40)→"over"`, `(40,40)→"near"`.
  - `calendarDays returns one entry per day with counts and levels`.
  - `dateIn converts an instant to the zone's date` — `dateIn("America/Chicago", new Date("2026-11-06T04:30:00Z")) === "2026-11-05"`.
- [ ] **Step 2:** `module-vocabulary.test.js`: walk `apps/api/src/modules/**` and `apps/web/src/modules/**` (skip missing dirs), fail on `/\b(lab|doctor|patient|dental|rx)\b/i` in any file. Schema test: `calendarDaysQuerySchema rejects a 63-day span and to < from`.
- [ ] **Step 3:** Run `pnpm --filter @my-app/api test -- business-calendar module-vocabulary` and `pnpm --filter @my-app/shared test -- calendar`. Expected: FAIL (modules missing).
- [ ] **Step 4:** Implement `rules.js`, `errors.js`, the shared schema. Loop guards: `nextOpenDay` scans at most 366 + holidays.size days, then throws `NO_OPEN_DAYS`. `index.js` re-exports the public interface.
- [ ] **Step 5:** Write `README.md`: purpose, the Calendar shape, every public function with one-line contract, configuration (key, timezone, basis), data model (filled in by Task 2), and a "Wiring it into another app" heading marked TODO for Task 11.
- [ ] **Step 6:** Run the Step 3 commands. Expected: PASS.
- [ ] **Step 7:** Commit `feat(business-calendar): pure calendar rules and shared schemas`.

### Task 2: `business-calendar` persistence, service and routes factory

**Files:**
- Create: `apps/api/src/modules/business-calendar/schema.js`, `service.js`, `routes.js`
- Modify: `apps/api/src/db/schema/index.js` (re-export the module schema)
- Create: migration via `pnpm db:generate` (`apps/api/src/db/migrations/0034_*.sql` + meta)
- Test: `apps/api/src/modules/business-calendar/service.test.js`, `routes.test.js`

**Interfaces:**
- Consumes: Task 1 rules and schemas.
- Produces:
  - Tables `calendars`, `calendar_holidays` exactly as the spec's Data model.
  - `getCalendar(db, key = "default") → Promise<Calendar>` (adds `holidayLabels: Map<date,label>`; no row → `{ ...DEFAULT_CALENDAR, key }`).
  - `saveCalendar(db, key, settings, { byUserId }) → Calendar` (upsert; throws `CalendarError("INVALID")` when every weekday is closed).
  - `listHolidays(db, key, { from?, to? }) → [{ id, date, label }]`; `addHoliday(db, key, { date, label }) → row` (`CONFLICT` on duplicate date); `removeHolidays(db, key, ids) → count`.
  - `calendarRoutes(fastify, { key = "default", prefix = "/scheduling/calendar", readGuard, writeGuard, loadCounts?, onAudit? })` registering: `GET {prefix}`, `PUT {prefix}`, `POST {prefix}/holidays`, `DELETE {prefix}/holidays/:id`, `POST {prefix}/holidays/delete` (`{ ids }`, bulk), `GET {prefix}/days`. `loadCounts(db, { from, to, basis }) → Map<date, number>`; absent → counts 0. `onAudit(request, action, targetId, metadata)` is called after each write.
  - Error mapping: `CalendarError` → 400/404/409 `{ error: { code, status, message } }`.

- [ ] **Step 1: Write failing service tests** (fakeDb from `apps/api/src/test/fake-tx.js`):
  - `getCalendar falls back to defaults when no row exists`.
  - `getCalendar builds holidays and labels from rows`.
  - `refuses a calendar with no open weekday`.
  - `addHoliday on an existing date throws CONFLICT`.
- [ ] **Step 2: Write failing route tests** (Fastify inject, guards stubbed as in `routes/__tests__/` patterns):
  - `PUT is refused for a read-only caller (writeGuard runs)`.
  - `GET days returns calendarDays with injected loadCounts`.
  - `bulk holiday delete reports the count and audits ids only`.
- [ ] **Step 3:** Run `pnpm --filter @my-app/api test -- business-calendar`. Expected: FAIL.
- [ ] **Step 4:** Implement schema, service, routes. The module never imports app config; `db` is `fastify.db ?? options.db` — pass `db` explicitly in options (`calendarRoutes(fastify, { db, ... })`).
- [ ] **Step 5:** `cd apps/api && pnpm db:generate`; check the SQL creates both tables + the unique index and nothing else.
- [ ] **Step 6:** Run tests. Expected: PASS. Update README "Data model".
- [ ] **Step 7:** Commit `feat(business-calendar): settings, holidays and routes factory`.

### Task 3: Scaffold `workflows` (README, pure rules, shared schemas)

**Files:**
- Create: `apps/api/src/modules/workflows/README.md`, `rules.js`, `errors.js`, `index.js`
- Create: `packages/shared/src/workflows/workflow.schema.js`, `index.js`; Modify `packages/shared/src/index.js`
- Test: `apps/api/src/modules/workflows/rules.test.js`, `packages/shared/src/workflows/workflow.schema.test.js`

**Interfaces:**
- Consumes: Task 1 `addBusinessDays`, `subtractBusinessDays`, `nextOpenDay`, `dateIn`.
- Produces:
  - Template shape: `{ key, name, totalDays, rushWorkflowKey, isDefault, active, stages: [{ key, label, milestone, dayOffset }] }`.
  - Plan shape: `{ workflowKey, workflowName, startDate, dueAt, direction: "forward"|"reverse", stages: [{ key, label, milestone, targetAt }] }`.
  - `WorkflowError(code, message)` codes `INVALID | NOT_FOUND | CONFLICT`.
  - `validateTemplate(t)` → throws `INVALID` unless: ≥1 stage, unique stage keys, offsets non-decreasing and ≥ 0, last offset === totalDays, `rushWorkflowKey !== key`.
  - `resolveRush(template, byKey, rush) → template` (rush + active linked template → linked; else same).
  - `planFromTemplate(template|null, { startDate, dueAt = null }, calendar) → Plan`:
    - template null → `{ workflowKey: null, workflowName: null, dueAt: dueAt ?? addBusinessDays(startDate, calendar.leadDays, calendar), stages: [], direction }`.
    - forward: `targetAt = addBusinessDays(startDate, dayOffset, calendar)`; `dueAt` = last target.
    - reverse (`dueAt` given): `targetAt = subtractBusinessDays(dueAt, totalDays - dayOffset, calendar)`, clamped to `>= startDate`; last stage target = `dueAt` exactly.
  - `planWith(templatesByKey, { workflowKey, startAt, rush, dueAt }, calendar) → Plan` (pure core of `planFor`; `startDate = dateIn(calendar.timezone, startAt)`; unknown key → `NOT_FOUND`).
  - `behindSchedule(stages, currentRank, rankOf, today) → { behind: boolean, lateStage: key|null }` (first stage with `targetAt < today` and `rankOf(milestone) > currentRank`).
  - `pickLongest(templates) → template|null` (max totalDays, ties → lower position, then key).
  - Shared: `workflowTemplateSchema` (key slug `^[a-z0-9-]{1,60}$`, name 1–120, totalDays 0–120, stages 1–30), `workflowAssignmentsSchema` (`subjectType` 1–40, `subjectIds` 1–500, `workflowKey` key|null), `workflowPreviewSchema`.

- [ ] **Step 1: Write failing tests** (`rules.test.js`, calendar Sat/Sun closed):
  - `forward plan offsets in business days` — 10-day template, start `2026-11-02`: due `2026-11-16`; stage at offset 1 → `2026-11-03`.
  - `reverse plan ends exactly on the requested date`.
  - `reverse plan clamps targets to the start date` — 10-day template, start `2026-11-02`, dueAt `2026-11-04`: every `targetAt >= "2026-11-02"`, last `=== "2026-11-04"`.
  - `no template falls back to lead days with no stages` — leadDays 13, start `2026-11-02` → due `2026-11-19`, `stages: []`.
  - `rush uses the linked active template, else the original`.
  - `behindSchedule flags the first missed stage only when the rank lags`.
  - `validateTemplate rejects decreasing offsets and a last offset != totalDays`.
  - `pickLongest prefers the most days`.
  - Schema test: `rejects a key with spaces`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- workflows` and shared. Expected: FAIL.
- [ ] **Step 3:** Implement. README: purpose, template/plan shapes, the milestone contract ("milestones are your app's ordered states; you pass `rankOf`"), public functions; "Wiring" heading TODO for Task 11.
- [ ] **Step 4:** Run tests incl. `module-vocabulary`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(workflows): pure planning rules and shared schemas`.

### Task 4: `workflows` persistence, service and routes factory

**Files:**
- Create: `apps/api/src/modules/workflows/schema.js`, `service.js`, `routes.js`
- Modify: `apps/api/src/db/schema/index.js`
- Create: migration via `pnpm db:generate` (`0035_*.sql`)
- Test: `apps/api/src/modules/workflows/service.test.js`, `routes.test.js`

**Interfaces:**
- Consumes: Task 3 rules; Task 2 `getCalendar` (routes only, for preview).
- Produces:
  - Tables `workflows`, `workflow_stages`, `workflow_assignments`, `workflow_plans` per the spec.
  - `createWorkflowsService(db)` → `{`
    - `listWorkflows({ includeInactive = false }) → Template[]` (ordered by position, name)
    - `getWorkflow(key) → Template|null` (inactive included)
    - `saveWorkflow(template, { id? }) → Template` (validate; replace stages in one transaction; only one `isDefault`: setting it clears the others; `CONFLICT` on duplicate key)
    - `setActive(ids, active) → count`
    - `planFor({ workflowKey, startAt, rush = false, dueAt = null }, calendar) → Plan` (loads templates, calls `planWith`)
    - `assignmentsFor(subjectType, subjectIds?) → Map<subjectId, workflowKey>`
    - `setAssignments(subjectType, subjectIds, workflowKey|null) → count` (null deletes)
    - `workflowForSubjects(subjects: [{ type, id }][] /* tiers, first non-empty wins */) → Template|null` (per tier: assigned active templates → `pickLongest`; none in any tier → the active `isDefault`; else null)
    - `savePlan(tx, recordType, recordId, plan) → void` (upsert)
    - `plansFor(recordType, recordIds) → Map<recordId, Plan>` (batched; `[]` → empty Map)
  - `}`
  - `workflowRoutes(fastify, { db, prefix = "/scheduling/workflows", readGuard, writeGuard, calendarKey = "default", milestones: [{ value, label }], onAudit? })`: `GET {prefix}` (`{ workflows, milestones }`), `POST {prefix}`, `PUT {prefix}/:id`, `POST {prefix}/active` (`{ ids, active }`), `GET {prefix}/assignments?subjectType=`, `PUT {prefix}/assignments`, `POST {prefix}/preview`. A stage `milestone` outside `milestones` → 400.

- [ ] **Step 1: Write failing service tests:**
  - `saveWorkflow replaces stages and keeps one default`.
  - `editing a template leaves saved plans unchanged` (save plan, edit template, `plansFor` returns the old snapshot).
  - `deactivated workflows still resolve by key for existing plans` (`getWorkflow` returns it; `planFor` with its key still plans; `listWorkflows()` hides it).
  - `workflowForSubjects uses the first tier with assignments, then the default`.
  - `plansFor with no ids makes no query`.
- [ ] **Step 2: Write failing route tests:** `rejects a stage milestone the host did not declare`, `preview returns a plan using the stored calendar`, `writes are audited with keys only`.
- [ ] **Step 3:** Run `pnpm --filter @my-app/api test -- modules/workflows`. Expected: FAIL.
- [ ] **Step 4:** Implement; `pnpm db:generate`; check SQL (4 tables, pk on assignments and plans, index `(record_type, due_date)`).
- [ ] **Step 5:** Run tests. Expected: PASS. README "Data model".
- [ ] **Step 6:** Commit `feat(workflows): templates, assignments, plans and routes factory`.

### Task 5: Lab glue — seed, `defaultDueAt` seam, release/remake/workflow change

**Files:**
- Create: `apps/api/src/services/lab/lab-scheduling.js`, `apps/api/src/services/lab/lab-scheduling.test.js`
- Create: custom migration `pnpm drizzle-kit generate --custom --name=seed_lab_scheduling` (`0036_seed_lab_scheduling.sql`)
- Create: `apps/api/src/routes/lab-scheduling.routes.js`; Modify `apps/api/src/index.js` (one register line)
- Modify: `apps/api/src/services/lab/lab-orders.service.js` (`releaseRxCase`, `remakeOrder`, `getLabOrderDetail`, new `changeWorkflow`), `apps/api/src/services/lab/lab-order-rules.js` (`planRxRelease` accepts `dueDate`; `planWorkflowChange`), `packages/shared/src/schemas/lab.schema.js` (`labWorkflowChangeSchema`, `labSchedulePreviewQuerySchema`)
- Test: `apps/api/src/services/lab/lab-orders.service.test.js`, `lab-order-rules.test.js`, `apps/api/src/routes/__tests__/lab-scheduling.test.js`, `apps/api/src/db/migrations/seed-lab-scheduling.test.js`

**Interfaces:**
- Consumes: Tasks 2 and 4 (`getCalendar`, `calendarRoutes`, `createWorkflowsService`, `workflowRoutes`, `behindSchedule`, `businessDaysBetween`).
- Produces (piece 6 calls these):
  - `LAB_MILESTONES = [{ value: "received", label: "Received" }, …, { value: "shipped", label: "Shipped" }]` (from `LAB_STATUS_LABELS`), `labRank(status, heldFrom) → 0..4`.
  - `AT_RISK_BUSINESS_DAYS = 2`
  - `defaultDueAt(tx, { variantIds = [], requestedDueDate = null, rush = false, workflowKey = null, startAt = new Date() }) → Promise<{ dueDate: string|null, plan: Plan|null }>` — rules in the spec's "Due-date rules"; tiers `[variant ids], [their family ids]` (families looked up from `product_variants.family_id`); a valid `requestedDueDate` → reverse plan and `dueDate = requestedDueDate`.
  - `saveSchedule(tx, labOrderId, plan) → void` (no-op for null plan).
  - `scheduleFlags(order, plan, todayIso, calendar) → { behind, lateStage, atRisk }`.
  - `presentSchedule(plan, order, todayIso, calendar) → { workflowKey, workflowName, direction, stages: [{ key, label, targetAt, reached, late }], behind, atRisk } | null`.
  - `changeWorkflow(id, { workflowKey, keepDueDate, expectedVersion, byUserId })` in `lab-orders.service.js`: via `mutate`; replans (forward from `receivedAt`, or reverse from current `dueDate` when `keepDueDate`), patches `dueDate`, event `{ type: "workflow", from: oldKey, to: newKey }`, `after` saves the plan. Terminal orders → `LabOrderError("INVALID")`.
  - `getLabOrderDetail` result gains `schedule` (from `presentSchedule`).
  - Routes (`lab-scheduling.routes.js`): mounts `calendarRoutes` and `workflowRoutes` with `readGuard = STAFF`, `writeGuard = [authenticate, requireAdmin]`, `milestones = LAB_MILESTONES`, `onAudit` = `audit(..., "calendar"|"workflow")`; plus `GET /lab/schedule/preview` and `POST /lab/orders/:id/workflow` (audit `lab_order.workflow_changed`).
  - Seed SQL: `calendars` row `default` (`timezone 'America/Chicago'`, `lead_days 13`, `closed_weekdays '[0,6]'`, basis `none`); 8 `workflows` + stages, `ON CONFLICT DO NOTHING`. Keys/names/days:
    `10d-2-device` "10-day 2-device PMT/Acrylic/Dual-Laminate" 10; `10d-printed` "10-day Printed" 10; `10d-standard-rush` "10-day Standard Rush" 10; `15d-printed` "15-day Printed" 15; `3d-max-rush` "3-day Max Rush" 3; `7d-1-device` "7-day 1-device" 7; `7d-expedited` "7-day Expedited" 7; `8d-printed-shipping` "8-day Printed + Shipping" 8.
    Default stages for total N: `check-in` (received, 0), `production` (in_production, `N ≤ 3 ? 0 : 1`), `qc` (quality_check, `max(prev, N-2)`), `pack` (ready_to_ship, `max(prev, N-1)`), `ship` (shipped, N). No `is_default`, no rush links. Stage ids/workflow ids are fixed literal strings in the SQL so re-runs conflict.

- [ ] **Step 1: Write failing tests** in `lab-scheduling.test.js` (fakeTx):
  - `defaultDueAt uses the longest workflow among the variants`.
  - `defaultDueAt falls back to family assignments, then the default workflow, then lead days`.
  - `requested date before plan keeps the date and is at risk` (requested = start + 1 day, 10-day workflow → `dueDate === requested`, `scheduleFlags(...).atRisk === true`).
  - `rush picks the linked rush workflow`.
  - `on_hold ranks at heldFrom`.
  - `atRisk: due within 2 business days and not yet in QC; quality_check due tomorrow is not at risk`.
  - `terminal orders are never behind or at risk`.
- [ ] **Step 2:** Add to `lab-order-rules.test.js`: `planRxRelease uses the dueDate it is given`; `planWorkflowChange refuses a shipped order`. Add to `lab-orders.service.test.js`: `release saves a workflow plan in the same transaction` and `remake plans from the original's workflow with no requested date`. `seed-lab-scheduling.test.js`: reads the SQL file, asserts all 8 keys, `ON CONFLICT DO NOTHING` on every insert, and the last stage offset equals each total. Route test: `POST /lab/orders/:id/workflow requires expectedVersion and staff`.
- [ ] **Step 3:** Run `pnpm --filter @my-app/api test -- lab-scheduling lab-order lab-orders seed-lab`. Expected: FAIL.
- [ ] **Step 4:** Implement. In `releaseRxCase` compute `defaultDueAt(tx, { variantIds: [...variantIdByCode.values()], requestedDueDate: parseDueDate(caseRow.dueDate) ?? parseDueDate(caseRow.formData?.dueDate), rush: rushFromCase(caseRow).rush, startAt: now })` before `planRxRelease`, pass `dueDate`, and `saveSchedule` after `insertPlan`. Same pattern in `remakeOrder` (workflow key from `plansFor("lab_order", [id])`).
- [ ] **Step 5:** Run tests. Expected: PASS. Run the full API suite.
- [ ] **Step 6:** Commit `feat(lab): workflow-driven due dates, stage plans and the defaultDueAt seam`.

### Task 6: Board tiles, schedule filters, flags on cards, calendar load counts

**Files:**
- Create: `apps/api/src/services/lab/lab-schedule-queries.js`, `lab-schedule-queries.test.js`
- Modify: `apps/api/src/services/lab/lab-orders.service.js` (`boardWhere`, `listLabOrders` batch-loads plans), `apps/api/src/services/lab/lab-order-rules.js` (`presentBoardCard` takes `{ plan, calendar }`), `packages/shared/src/schemas/lab.schema.js` (`dueOn`, `tile`; `LAB_BOARD_TILES`), `apps/api/src/routes/lab-scheduling.routes.js` (`GET /lab/schedule/tiles`; pass `loadCounts` to `calendarRoutes`)
- Test: `lab-schedule-queries.test.js`, `lab-order-rules.test.js`, `packages/shared/src/schemas/lab.schema.test.js`

**Interfaces:**
- Consumes: Task 5 `scheduleFlags`, `labRank`, `AT_RISK_BUSINESS_DAYS`; Task 4 `plansFor`; Task 2 `getCalendar`, `nextOpenDay`.
- Produces:
  - `LAB_BOARD_TILES = ["past_due","due_today","due_tomorrow","on_hold","at_risk"]` (shared).
  - `boardTiles(db, now) → { pastDue, dueToday, dueTomorrow, onHold, atRisk, today, tomorrowDate }` — over all non-terminal orders (not the 1000 cap); `dueTomorrow` = due on `nextOpenDay(today + 1)`; `atRisk` via `scheduleFlags`.
  - `tileOrderIds(db, tile, now) → string[] | null` (null for tiles expressible in SQL; ids for `at_risk`).
  - `boardWhere` gains `dueOn` (`eq(dueDate)`) and `tile` (`past_due`: `dueDate < today` and non-terminal; `due_today`; `due_tomorrow`; `on_hold`: status; `at_risk`: `inArray(id, ids)`, empty ids → no rows). A tile implies "open only".
  - `presentBoardCard(row, lines, todayIso, { plan, calendar } = {})` adds `behind`, `atRisk`, `workflowName`.
  - `labLoadCounts(db, { from, to, basis }) → Map<date, number>` — non-cancelled orders by `due_date`; `orders` = count, `units` = `sum(qty)` of non-`note_only` lines.

- [ ] **Step 1: Write failing tests:**
  - `tiles count past due, today, next open day, on hold and at risk` (Friday `today` → `tomorrowDate` is Monday).
  - `on hold counts in onHold and atRisk independently`.
  - `at_risk tile with no matching orders returns no rows, not every row`.
  - `units counts quantities and skips note-only lines`.
  - `presentBoardCard carries behind and atRisk; legacy orders without a plan are never behind`.
  - Schema: `tile must be one of LAB_BOARD_TILES`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- lab-schedule lab-order-rules` + shared. Expected: FAIL.
- [ ] **Step 3:** Implement. `listLabOrders` loads `getCalendar` and `plansFor` once per call (batched by the page's ids).
- [ ] **Step 4:** Run tests and full API suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(lab): board tiles, at-risk filter and calendar load counts`.

### Task 7: Lab slip prints the schedule

**Files:**
- Modify: `apps/api/src/services/lab/ticket-model.js`, `ticket-pdf.js`
- Test: `ticket-model.test.js`, `ticket-pdf.test.js`

**Interfaces:**
- Consumes: Task 5 `detail.schedule`.
- Produces: model fields `dueBadge: "DUE WED 11/12" | null`, header row `["Workflow", name]` when present, `schedule: [{ label, target: "MM/DD/YYYY", reached: boolean }]` (empty when no plan). PDF: badge drawn beside the order number; "Schedule" section after "Devices & lines": `☐/☑ <label> — <target>` (use `[ ]`/`[x]` if the font lacks the glyph).

- [ ] **Step 1: Write failing tests:** `ticket model includes the due badge and stage schedule`, `no plan → no Schedule section and no Workflow row`, `pdf renders with a schedule` (non-empty buffer; text extraction contains "Schedule").
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- ticket`. Expected: FAIL.
- [ ] **Step 3:** Implement (weekday from the date via `Date.UTC`, not local time).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(lab): slip prints workflow, due-day badge and stage schedule`.

### Task 8: Web generic modules — calendar grid, calendar settings, workflow editor, assignments

**Files:**
- Create: `apps/web/src/modules/business-calendar/CalendarGrid.jsx`, `CalendarSettingsForm.jsx`, `HolidaysTable.jsx`, `calendar-grid.js` (pure: month/week cell layout), `index.js`
- Create: `apps/web/src/modules/workflows/WorkflowsTable.jsx`, `WorkflowEditor.jsx`, `AssignmentsTable.jsx`, `StageSchedule.jsx`, `index.js`
- Test: `apps/web/src/modules/business-calendar/calendar-grid.test.js`, `CalendarGrid.test.jsx`, `apps/web/src/modules/workflows/WorkflowEditor.test.jsx`, `AssignmentsTable.test.jsx`

**Interfaces:**
- Consumes: API shapes from Tasks 2/4 (`/scheduling/calendar*`, `/scheduling/workflows*`); `DataTable`, `useDataTable`, `ConfirmButton`, `Modal`, `SegmentedControl`, `useToast`.
- Produces (props only; components take an `api` base path prop, default `/scheduling`):
  - `monthCells(anchorDate) → date[42]` (Sun-first), `weekCells(anchorDate) → date[7]`.
  - `<CalendarGrid days view="month|week" anchor onAnchorChange onDayClick renderCell? />` — `days` from `GET …/days`; tint by `level` (`under` emerald-50, `near` amber-50, `over` red-50, closed `surface-100` + label).
  - `<CalendarSettingsForm basePath />`, `<HolidaysTable basePath />` (bulk "Delete" with `confirmLabel`).
  - `<WorkflowsTable basePath onOpen />` (bulk Activate/Deactivate), `<WorkflowEditor basePath workflow milestones onSaved onClose />` (Modal; stage rows add/remove/move up/down; milestone select; client-side `validateTemplate`-equivalent messages before save).
  - `<AssignmentsTable basePath subjectType subjects columns workflows />` — `subjects` rows from the host; adds a "Workflow" column and bulk "Set workflow…" (select in the bulk bar) + "Clear workflow".
  - `<StageSchedule stages />` (reached ✓, late in red).

- [ ] **Step 1: Write failing tests:** `monthCells starts on the Sunday on/before the 1st and has 42 days`; `CalendarGrid tints by level and calls onDayClick with the date`; `closed days render the holiday label and are not clickable`; `WorkflowEditor blocks save when the last offset != total days`; `AssignmentsTable bulk Set workflow PUTs the selected ids`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/web test -- modules`. Expected: FAIL.
- [ ] **Step 3:** Implement. No lab words (the vocabulary test from Task 1 covers `apps/web/src/modules`).
- [ ] **Step 4:** Run web tests + build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): business-calendar and workflows UI modules`.

### Task 9: Admin › Scheduling page and Lab › Calendar page

**Files:**
- Create: `apps/web/src/pages/app/AdminSchedulingPage.jsx`, `apps/web/src/pages/lab/OrdersCalendarPage.jsx`
- Modify: `apps/web/src/config/routes.js` (`ADMIN_SCHEDULING: "/admin/scheduling"`, `LAB_CALENDAR: "/lab/calendar"`), the router (`App.jsx`: admin route under the admin guard, calendar under `RequireStaff`), `apps/web/src/components/layout/Sidebar.jsx` (Lab: "Calendar" `CalendarDays`; Admin: "Scheduling" `CalendarClock`)
- Test: `apps/web/src/pages/lab/OrdersCalendarPage.test.jsx`, `apps/web/src/config/routes.test.js`

**Interfaces:**
- Consumes: Task 8 components; Task 6 `GET /scheduling/calendar/days?basis=`; `GET /admin/catalog…` (the existing admin catalog list — find the variant list call used by `AdminCatalogPage.jsx`) for assignment subjects; `LAB_MILESTONES` arrives via `GET /scheduling/workflows` (`milestones`).
- Produces: `/lab/calendar?view=month|week&basis=orders|units&anchor=YYYY-MM-DD` (URL-mirrored); day click → `navigate("/lab?dueOn=<date>")`. Admin page tabs (URL `?tab=`): Calendar, Holidays, Workflows, Assignments (subjectType `variant`, columns family/code/name).

- [ ] **Step 1: Write failing tests:** `calendar page requests days for the visible month with the chosen basis`; `clicking a day navigates to the board filtered by dueOn`; `routes include ADMIN_SCHEDULING and LAB_CALENDAR`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/web test -- OrdersCalendar routes`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run web tests + build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): orders calendar and admin scheduling pages`.

### Task 10: Board tiles, URL filters, flags, order Schedule panel

**Files:**
- Create: `apps/web/src/components/lab/BoardTiles.jsx`, `apps/web/src/components/lab/SchedulePanel.jsx`
- Modify: `apps/web/src/pages/lab/LabBoardPage.jsx` (tiles row; read/write `tile` and `dueOn` via `useSearchParams`; a removable chip shows an active `dueOn`/`tile`), `apps/web/src/lib/lab-board.js` (`boardParams` passes `tile`, `dueOn`), `apps/web/src/components/lab/board-columns.jsx` + `BoardCard.jsx` (Behind / At risk badges), `apps/web/src/pages/lab/LabOrderDetailPage.jsx` (mount `SchedulePanel`)
- Test: `apps/web/src/components/lab/BoardTiles.test.jsx`, `SchedulePanel.test.jsx`, `apps/web/src/lib/__tests__/lab-board.test.js`

**Interfaces:**
- Consumes: `GET /lab/schedule/tiles`, `GET /lab/orders?tile=&dueOn=`, `POST /lab/orders/:id/workflow`, `GET /scheduling/workflows`, `detail.schedule`; Task 8 `StageSchedule`.
- Produces: `<BoardTiles tiles active onSelect />` (labels "Past due", "Due today", "Due tomorrow" or "Due Mon" when `tomorrowDate` isn't tomorrow, "On hold", "At risk"; clicking the active tile clears it); `<SchedulePanel order schedule onChanged />` (workflow select, "Keep due date" checkbox, Apply; STALE → toast + reload like `isStale`).

- [ ] **Step 1: Write failing tests:** `tiles show counts and toggle the active tile`; `Friday shows "Due Mon"`; `boardParams includes tile and dueOn only when set`; `SchedulePanel posts workflowKey, keepDueDate and expectedVersion`; `a stale reply toasts and reloads`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/web test -- BoardTiles SchedulePanel lab-board`. Expected: FAIL.
- [ ] **Step 3:** Implement. Tiles reload with the board's Refresh and after every move.
- [ ] **Step 4:** Run web tests + build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): board daily tiles, schedule badges and order schedule panel`.

### Task 11: READMEs "wiring into another app", runbook, docs

**Files:**
- Modify: `apps/api/src/modules/business-calendar/README.md`, `apps/api/src/modules/workflows/README.md`
- Modify: `docs/cutover-runbook.md` (re-entry step), `CLAUDE.md` (Key File Paths: one line for `apps/api/src/modules/` and `apps/web/src/modules/`)
- Test: `apps/api/src/modules/readme.test.js`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test** `readme.test.js`: each module README contains the headings `## Purpose`, `## Public interface`, `## Configuration`, `## Data model`, `## Wiring it into another app`, and no `TODO`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- readme`. Expected: FAIL.
- [ ] **Step 3:** Write the wiring sections, numbered: (1) re-export `schema.js` from the app's Drizzle schema index and generate a migration; (2) mount the routes factory with `db`, guards, `prefix`, `onAudit` (and `loadCounts` / `milestones`); (3) seed a calendar row and templates (custom migration, `ON CONFLICT DO NOTHING`); (4) call `getCalendar` + `planFor`/`savePlan` where records are created; (5) compute `behindSchedule` with your own `rankOf`; (6) mount the UI components with `basePath`. Reference the lab glue files as the worked example.
- [ ] **Step 4:** Add to `docs/cutover-runbook.md` under "After the cutover" (or a new "Scheduling re-entry" step before Unfreeze): staff confirm the calendar timezone (seeded `America/Chicago`; the audit shows a California address), enter the coming year's holidays, set capacity limits if wanted, correct each of the 8 workflows' stages/offsets against Labzona's Workflow screen, link rush variants, mark a default workflow, and assign workflows to products (Admin › Scheduling › Assignments). Note: imported Seazona orders keep their due date and have no stage plan.
- [ ] **Step 5:** Run the test + full API and web suites + web build. Expected: PASS.
- [ ] **Step 6:** Commit `docs(scheduling): module wiring guides and cutover re-entry steps`.
