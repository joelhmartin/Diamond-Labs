# Piece 7: Scheduling (design)

_2026-11-05 · roadmap: `2026-11-05-lab-parity-roadmap.md` (binding) · builds on
piece 2 (lab orders + board), the shared DataTable (`2026-10-28-data-tables.md`)
and the work ticket (`services/lab/ticket-model.js`). Merges **first** of
pieces 6–10._

## Intent

The lab plans every case against a calendar: a default lead time, closed days,
holidays, optional daily capacity, and eight named turnaround templates
("10-day Printed", "3-day Max Rush", …). Labzona used them to set the due
date, to print a stage schedule on the lab slip, to show an orders calendar
coloured against capacity, and to fill the Operations tiles (past due 114, due
today 53, due tomorrow 38, on hold 91, at risk 320). Diamond Labs today has a
due date and a rush flag only.

This piece builds two generic modules (`business-calendar`, `workflows`) and
the lab glue that uses them.

## Goals

1. A generic **business calendar**: lead time, closed weekdays, admin-managed
   holidays, optional per-weekday capacity counted by orders or units.
   Exposes `addBusinessDays`, `isOpen`, `capacityFor`, `getCalendar`.
2. A generic **workflows** module: named templates with ordered stages and
   day offsets, an optional rush variant, assignment to any subject (here:
   catalog variants and families), and `planFor()` → due date + stage targets.
3. The due date **defaults from the workflow** on Rx release, on remake and on
   staff order entry (piece 6), through one seam: `defaultDueAt()`.
4. A **behind schedule** flag when an order's status lags its stage target,
   and an **at risk** flag (behind, or due within N business days and not yet
   in QC).
5. An **Orders calendar** page (month/week, orders/units toggle, coloured by
   capacity, click a day → the board filtered to that due date).
6. **Board tiles**: past due, due today, due tomorrow, on hold, at risk; each
   tile filters the board.
7. The **lab slip** prints the workflow name, a due-day badge and the stage
   schedule.

## Non-goals

- **No per-step checklist.** Roadmap ruling: 2,109 Labzona tasks are past due
  and none was ever completed. Stages are targets, compared with the order's
  status. No task rows, no check-off, no per-tech task assignment.
- **No capacity-driven due-date bumping.** Capacity colours the calendar; it
  never moves a date (ruling below).
- **No "complexity" measure** on the calendar (Labzona's third toggle). There
  is no complexity data on lines.
- **No behind-schedule notifications.** Labzona's 404 ignored past-due-task
  alerts are evidence nobody wants them. Piece 8 can subscribe later.
- **Shop orders** keep no due date (unchanged; picked and shipped).
- Technician workload / Tasks Schedule reports: piece 9 may build them on
  `workflow_plans` later.

## What exists today (survey, with evidence)

- Due date on release is the doctor's requested date only, else null:
  `planRxRelease` sets `dueDate: parseDueDate(caseRow.dueDate) ??
  parseDueDate(caseRow.formData?.dueDate)` (`apps/api/src/services/lab/lab-order-rules.js:82`).
  Shop orders and remakes start with `dueDate: null` (`newOrder`, same file `:62`).
- The doctor's form asks "Due Date Requested" (`packages/shared/src/rx/forms/rx-common.sections.js:66`)
  and whether to rush (`:126`), with tier sliders mapped by `rushFromCase` (`lab-order-rules.js:48`).
- `lab_orders.due_date` is a `date` ("YYYY-MM-DD"); "today" is
  `isoDateIn(LAB_TIMEZONE)`; `isOverdue` is a string compare
  (`packages/shared/src/lab/lab-order-status.js`).
- Imported legacy orders carry Seazona's `due` (`apps/api/src/import/map-orders.js:48`).
- Board list: `listLabOrders` (capped 1000, or paged), `presentBoardCard`
  computes `overdue`. Filters: status, source, department, assignee, rush,
  `dueBefore`, q (`packages/shared/src/schemas/lab.schema.js:36`). Board
  filters live in React state, not the URL (`LabBoardPage.jsx:67`).
- No settings table exists for the lab; the closest singleton is `app_theme`.
- No `apps/api/src/modules/` or `apps/web/src/modules/` directory exists yet:
  this piece creates the convention (it merges first).

## Module boundaries

### Generic: `business-calendar`

No lab words. Knows dates, weekdays, holidays and a capacity number.

| Layer | Path |
|---|---|
| Pure rules | `apps/api/src/modules/business-calendar/rules.js` |
| Drizzle schema | `apps/api/src/modules/business-calendar/schema.js` (re-exported from `db/schema/index.js`) |
| Service | `apps/api/src/modules/business-calendar/service.js` |
| Routes factory | `apps/api/src/modules/business-calendar/routes.js` |
| Shared schemas | `packages/shared/src/business-calendar/` |
| UI | `apps/web/src/modules/business-calendar/` |
| Docs | `apps/api/src/modules/business-calendar/README.md` |

A **calendar** value (what every rule takes):

```
{ key, timezone, leadDays, closedWeekdays: number[] /* 0=Sun */,
  holidays: Set<"YYYY-MM-DD">, capacityBasis: "none"|"orders"|"units",
  capacityByWeekday: { [0..6]: number|null } }
```

Public interface (names fixed by the roadmap):
- `addBusinessDays(date, n, calendar) → "YYYY-MM-DD"`; `n ≥ 0`; the start day
  is not counted; closed weekdays and holidays are skipped. `n = 0` on a
  closed day rolls forward to the next open day.
- `subtractBusinessDays(date, n, calendar)`, `nextOpenDay(date, calendar)`,
  `businessDaysBetween(a, b, calendar)` (used by reverse planning and "due
  within N business days").
- `isOpen(date, calendar) → boolean`.
- `capacityFor(date, calendar) → number|null` (null = no limit; 0 on a closed day).
- `loadLevel(count, capacity) → "none"|"under"|"near"|"over"` (near ≥ 85%).
- `dateIn(timezone, instant) → "YYYY-MM-DD"`.
- `getCalendar(db, key = "default")` → calendar (built-in defaults when no
  row exists: 0 lead days, nothing closed, no capacity).
- `calendarDays(calendar, from, to, counts?) → [{ date, open, holiday, capacity, count, level }]`.
- `calendarRoutes(fastify, { readGuard, writeGuard, key, loadCounts? })`:
  settings, holidays and a `days` endpoint; the host injects `loadCounts(db, { from, to, basis })`.

### Generic: `workflows`

No lab words. A workflow stage names a host-defined **milestone** string; the
host supplies the milestone order.

| Layer | Path |
|---|---|
| Pure rules | `apps/api/src/modules/workflows/rules.js` |
| Schema / service / routes / README | `apps/api/src/modules/workflows/{schema,service,routes}.js`, `README.md` |
| Shared schemas | `packages/shared/src/workflows/` |
| UI | `apps/web/src/modules/workflows/` |

Public interface:
- `createWorkflowsService(db)` → `{ planFor, listWorkflows, getWorkflow,
  saveWorkflow, setActive, assignmentsFor, setAssignments, workflowForSubjects,
  savePlan, plansFor }`.
- `planFor({ workflowKey, startAt, rush, dueAt? }, calendar)` →
  `{ workflowKey, workflowName, startDate, dueAt, stages: [{ key, label, milestone, targetAt }] }`.
  Roadmap name and arguments kept; it is a method of the db-bound service
  because it reads the template (see Rulings). `dueAt` is an optional addition
  for reverse planning. `workflowKey = null` → `dueAt = addBusinessDays(start,
  calendar.leadDays)` and no stages. `dueAt`/`targetAt` are "YYYY-MM-DD".
- Pure: `planFromTemplate(template, { startDate, rush, dueAt }, calendar)`,
  `resolveRush(template, byKey)`, `behindSchedule(stages, currentRank, rankOf, today) → { behind, lateStage }`.

### Lab glue

| File | Job |
|---|---|
| `apps/api/src/services/lab/lab-scheduling.js` | `defaultDueAt`, `saveSchedule`, `LAB_MILESTONES`, `scheduleFlags`, `AT_RISK_BUSINESS_DAYS = 2` |
| `apps/api/src/services/lab/lab-schedule-queries.js` | board tiles, tile/dueOn filters, calendar load counts |
| `apps/api/src/routes/lab-scheduling.routes.js` | mounts both module route factories under `/api/v1/scheduling/*` with lab guards, plus `/lab/schedule/*` and `/lab/orders/:id/workflow` |
| `apps/api/src/db/migrations/00xx_*seed*.sql` | the lab calendar + 8 workflows (custom migration) |
| `apps/web/src/pages/lab/OrdersCalendarPage.jsx`, `pages/app/AdminSchedulingPage.jsx`, `components/lab/BoardTiles.jsx`, `components/lab/SchedulePanel.jsx` | screens |

Lab milestone order (glue): `received 0 → in_production 1 → quality_check 2 →
ready_to_ship 3 → shipped 4`. An on-hold order is ranked at its `heldFrom`.

## Data model (4 + 2 tables, no FKs, ids cuid2 varchar(128))

`business-calendar`:
- `calendars`: `key` pk varchar(60), `timezone` varchar(60), `lead_days` int,
  `closed_weekdays` jsonb int[], `capacity_basis` varchar(10) default `none`,
  `capacity_by_weekday` jsonb `{}`, `updated_by`, `updated_at`.
- `calendar_holidays`: `id`, `calendar_key`, `date` date, `label` varchar(80);
  unique (`calendar_key`, `date`).

`workflows`:
- `workflows`: `id`, `key` unique varchar(60), `name` varchar(120),
  `total_days` int, `rush_workflow_key` varchar(60) null, `is_default` bool,
  `active` bool, `position` int, stamps.
- `workflow_stages`: `id`, `workflow_id`, `position`, `key` varchar(60),
  `label` varchar(120), `day_offset` int, `milestone` varchar(60).
  Rule: offsets non-decreasing, last offset = `total_days`.
- `workflow_assignments`: (`subject_type` varchar(40), `subject_id`) pk,
  `workflow_key`.
- `workflow_plans`: (`record_type`, `record_id`) pk, `workflow_key` null,
  `workflow_name`, `start_date` date, `due_date` date, `direction`
  (`forward`|`reverse`), `stages` jsonb snapshot, stamps; index on
  (`record_type`, `due_date`).

`lab_orders` gains **no column**: its plan lives in `workflow_plans` with
`record_type = "lab_order"`. `lab_order_events.type` gains the value
`workflow` (varchar(20) already fits).

## Due-date rules (lab glue `defaultDueAt`)

```
defaultDueAt(tx, { variantIds = [], requestedDueDate = null, rush = false,
                   workflowKey = null, startAt = new Date() })
  → { dueDate: "YYYY-MM-DD" | null, plan: Plan | null }
```

1. Workflow: explicit `workflowKey` → else the assigned workflow with the
   longest `total_days` among the lines' variants (then their families) → else
   the `is_default` workflow → else none (calendar lead time, no stages).
2. Rush: if `rush` and the workflow has a `rush_workflow_key`, plan that one.
3. Requested date present (the doctor's "Due Date Requested", a valid date) →
   due date = that date, stages planned **in reverse** from it (Labzona's
   "workflows applied in reverse"). Absent → planned forward from the lab-local
   date of `startAt`.
4. Returns the plan; `saveSchedule(tx, labOrderId, plan)` upserts
   `workflow_plans`.

Callers: `releaseRxCase` (start = release time, requested = case date, rush
from `rushFromCase`), `remakeOrder` (original's workflow, no requested date,
start = now), piece 6's staff order entry. Changing the workflow on an order
(`POST /lab/orders/:id/workflow`) replans from `receivedAt` (or the current due
date in reverse when staff tick "keep due date"), writes the new `dueDate`, and
logs a `workflow` event. A manual due-date edit (existing `PATCH field: "due"`)
changes the due date only; stage targets stay.

## Flags

- `behind`: some stage's `targetAt < today` and the order's milestone rank is
  below that stage's milestone rank. Terminal orders are never behind.
- `atRisk`: open (not terminal), and `behind` **or** (`dueDate` within
  `AT_RISK_BUSINESS_DAYS` business days of today, inclusive of past due, and
  rank < `quality_check`).
- Both are computed on read (no stored flag): `presentBoardCard`, the tiles
  and the order detail.

## API routes (all under `/api/v1`)

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/scheduling/calendar` | staff | settings + holidays |
| PUT | `/scheduling/calendar` | admin | lead days, closed weekdays, basis, per-weekday capacity |
| POST | `/scheduling/calendar/holidays` | admin | `{ date, label }`; 409 on duplicate date |
| DELETE | `/scheduling/calendar/holidays/:id` | admin | |
| POST | `/scheduling/calendar/holidays/delete` | admin | `{ ids }` (bulk) |
| GET | `/scheduling/calendar/days?from&to&basis` | staff | ≤ 62 days; open/holiday/capacity/count/level |
| GET | `/scheduling/workflows` | staff | with stages |
| POST / PUT | `/scheduling/workflows`, `/scheduling/workflows/:id` | admin | whole template incl. stages |
| POST | `/scheduling/workflows/active` | admin | `{ ids, active }` (bulk; never deleted) |
| GET / PUT | `/scheduling/workflows/assignments?subjectType=` | staff / admin | PUT `{ subjectType, subjectIds[], workflowKey|null }` (bulk) |
| POST | `/scheduling/workflows/preview` | staff | `{ workflowKey, startAt, rush, dueAt? }` → plan |
| GET | `/lab/schedule/tiles` | staff | `{ pastDue, dueToday, dueTomorrow, onHold, atRisk, tomorrowDate }` |
| GET | `/lab/schedule/preview?variantIds&rush&workflowKey&requestedDueDate` | staff | `defaultDueAt` dry run, for piece 6's entry form |
| POST | `/lab/orders/:id/workflow` | staff | `{ workflowKey, keepDueDate, expectedVersion }` |
| GET | `/lab/orders` | staff | gains `dueOn` (date) and `tile` (`past_due|due_today|due_tomorrow|on_hold|at_risk`) filters |

Every write is audit-logged (ids, keys and dates only).

## UI screens

- **Lab › Calendar** (`/lab/calendar`, staff): month grid (default) and week
  view; Orders/Units toggle (`SegmentedControl`); each day shows the count and
  `count / capacity` when a capacity exists, tinted by `loadLevel`; closed days
  and holidays greyed with the holiday label; click a day → `/lab?dueOn=YYYY-MM-DD`.
  Below the grid, a DataTable of the selected day's orders is **not** built;
  the board is the list.
- **Production board** (`/lab`): a tile row above the filters (five tiles,
  counts from `/lab/schedule/tiles`, active tile highlighted); clicking a tile
  sets `tile` in the URL; the board reads `tile` and `dueOn` from the URL.
  Cards and table rows show "Behind" / "At risk" badges.
- **Order detail**: a Schedule panel: workflow select, "keep due date"
  checkbox, Apply (sends expectedVersion), and the stage list with target
  dates, a tick for reached milestones and the late stage in red.
- **Admin › Scheduling** (`/admin/scheduling`, admin): tabs
  - Calendar: lead days, closed weekdays, capacity basis, a limit per weekday.
  - Holidays: DataTable (date, label), add form, bulk Delete (ConfirmButton).
  - Workflows: DataTable (name, days, stages, rush variant, default, active),
    bulk Deactivate/Activate; row click opens the editor (stages: label,
    milestone select from the host's list, day offset; add/remove/reorder).
  - Assignments: DataTable of catalog variants (family, code, name, current
    workflow) with filters (family, has workflow) and bulk "Set workflow…".
- **Lab slip**: header gains `Workflow` and a due-day badge ("DUE WED 11/12");
  a "Schedule" section lists stages with target dates.

## Audit coverage

| Audit row | Covered by |
|---|---|
| Orders calendar (HEAVY): daily due counts coloured by capacity, Orders/Units/Complexity toggle | Calendar page; Orders + Units; Complexity not built (no data) |
| Operations tab tiles: past due, due today, due tomorrow, on hold | Board tiles |
| Lab Pulse: at risk 320, at-risk list | `at_risk` tile + filter; the Pulse dashboard itself is piece 9 (it can call the tiles query) |
| Order detail Tasks tab (LIGHT) | Schedule panel with stage targets; no checklist (roadmap ruling) |
| Lab slip: due-day badge, task deadlines | Slip badge + Schedule section |
| Workflows (8 templates) | `workflows` module + seed |
| Calendar settings: 13-day lead, Sat/Sun closed, holidays, capacity blank | `business-calendar` + seed (13, [0,6], no capacity) |
| Config: "workflows applied in reverse" | Reverse planning when a requested due date exists |
| Planning reports (Calendar, Tasks Schedule, Technician Workload) | Calendar page; the rest is piece 9 on `workflow_plans` |
| "Clients can pick full dates" | Doctor's requested date already honoured; unchanged |

## Cutover / import impact

- **Imports nothing.** Calendar settings, holidays, workflows, stage lists and
  product assignments are not in Seazona's API.
- Seed migration loads: calendar `default` (timezone = `LAB_TIMEZONE`, 13 lead
  days, Sat/Sun closed, no capacity) and the 8 workflows with editable default
  stages. No product assignments, no rush links.
- Imported legacy orders keep their imported due date and get **no plan**: no
  behind flag; they still count in tiles, at-risk (by due date) and the
  calendar.
- Staff re-enter by hand (runbook step): holidays for the coming year, any
  capacity limits, each workflow's real stage list and offsets, which workflow
  each product uses, and which workflow is a product's rush variant.

## Rulings

- **Ruling: workflow day counts are business days** — Labzona's calendar has
  closed days and a 13-day lead that only makes sense skipping weekends. —
  Cost if wrong: add a `count_by` (`business|calendar`) column and one branch
  in `planFromTemplate`.
- **Ruling: the due date is the last stage's target (ship-by date)** — the
  board's overdue and the doctor's date both mean "leaves the lab by". — Cost
  if wrong: add a transit-days field per workflow.
- **Ruling: a doctor's requested date wins, and stages plan backwards from it**
  — matches today's behaviour and Labzona's "workflows applied in reverse".
  A requested date too close for the workflow shows up as at risk / behind
  immediately rather than being refused. — Cost if wrong: a "requested date
  earlier than plan" warning at release, additive.
- **Ruling: capacity is advisory** — colours the calendar, never moves a due
  date; the lab's limits are blank today. — Cost if wrong: a
  `nextDayWithCapacity` step in `defaultDueAt`, using the existing counts query.
- **Ruling: the plan is snapshotted per order in `workflow_plans`** — editing a
  template must not silently move open orders' targets, and the slip must
  print what was planned. — Cost if wrong: a "replan open orders" admin action.
- **Ruling: plans live in a generic `workflow_plans` table, not on `lab_orders`**
  — keeps the module reusable and keeps `lab_orders` free for piece 6's
  columns (fewer migration conflicts). — Cost if wrong: one join per query
  (already batched by id).
- **Ruling: multiple products on one order take the longest assigned
  workflow** — the case ships when its slowest device is done. — Cost if
  wrong: change one reducer in `workflowForSubjects`.
- **Ruling: `planFor` is a method of `createWorkflowsService(db)`** — the
  roadmap's signature `planFor({ workflowKey, startAt, rush }, calendar)` has
  no db, but it must read the template; binding db at construction keeps the
  call signature exactly. — Cost if wrong: none for callers.
- **Ruling: no rush links are seeded** — which template is whose rush variant
  isn't known. A rush order without a link keeps its normal workflow; staff
  pick a rush workflow on the order. — Cost if wrong: staff set links in Admin.
- **Ruling: "due tomorrow" means the next open day** — on a Friday it shows
  Monday's work, labelled with the weekday. — Cost if wrong: one line.
- **Ruling: at-risk window is 2 business days** (`AT_RISK_BUSINESS_DAYS`), a
  glue constant. — Cost if wrong: change the constant or move it to the
  calendar row.
- **Ruling: flags are computed on read, never stored** — no job, no drift;
  open orders are ~550. — Cost if wrong: a nightly job writing a flag column.
- **Ruling: seed via a custom SQL migration** — production runs migrations in
  Cloud Build; a separate seed CLI would be a manual step someone forgets.
  `ON CONFLICT DO NOTHING` so a re-run never overwrites staff edits.
  — Cost if wrong: re-entry by hand in Admin › Scheduling.

## Premises checked

- Roadmap says piece 6 creates `defaultDueAt()`; this piece merges first, so it
  creates the seam in `services/lab/lab-scheduling.js` and piece 6 calls it.
- "Existing due logic" is only the doctor's requested date
  (`lab-order-rules.js:82`); without one the due date is null today.
- `LAB_TIMEZONE` is `America/Chicago` with a comment that the lab is in San
  Antonio (`packages/shared/src/lab/lab-order-status.js`), but the audit's
  address screen lists a California address. The calendar stores its own
  timezone (seeded from `LAB_TIMEZONE`); someone should confirm the lab's
  real timezone before cutover.

## Testing

- Pure rule tests for both modules (weekends, holidays, year boundary,
  reverse planning, rush resolution, behind/at-risk).
- Service tests with the repo's fakes (`apps/api/src/test/fake-tx.js`
  `fakeTx`/`fakeDb`) for persistence, assignments and `defaultDueAt`.
- Route tests for guards and validation; release/remake tests prove a plan is
  saved and the due date set.
- Web: render tests for CalendarGrid, BoardTiles, the workflow editor.
