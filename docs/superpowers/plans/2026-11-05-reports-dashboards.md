# Reports and Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic `reports` module (registry, index with search,
groups and favorites, a time-limited runner, CSV, and dashboards). Use it to
register all 63 Labzona reports, the Pulse / Operations / Insights / Sales
dashboards, and the client health score.

**Architecture:**

- The API module is `apps/api/src/modules/reports/`: registry, params, runner,
  csv, dashboards, health, favorites and a routes factory. Shared specs live
  in `packages/shared/src/reports/`, and the generic UI in
  `apps/web/src/modules/reports/`.
- Lab report definitions live in the glue directory
  `apps/api/src/services/lab/reports/`.
- Every number comes from a single function in `lab-metrics.js`, which both
  reports and tiles call.
- Reports run live on the main DB inside a read-only transaction with
  `statement_timeout`, backed by planned indexes.

**Tech Stack:**

- API: Fastify v5, Drizzle (postgres-js), zod, vitest with `fakeTx`.
- Web: React 18, Tailwind, the shared DataTable, and Chart.js 4 (new,
  tree-shaken, lazy chunk).

**Spec:** `docs/superpowers/specs/2026-11-05-reports-dashboards-design.md`
(read it first; its "Coverage of every audit report" tables are the checklist
for Tasks 5–7 and 10).

## Global Constraints

- **The generic code has no domain words.** `modules/reports` (api and web)
  and `packages/shared/src/reports` contain no lab, dental, doctor, order,
  patient or practice words. Task 1 adds a test that greps for them.
- **Every list is `DataTable` + `useDataTable`** (`apps/web/src/components/ui/data-table/`).
  Do not build a one-off table. Missing features go into the shared
  component (Task 3 adds `exportAll`).
- **Interface names are the roadmap's:**
  - `defineReport({ key, group, title, params, run(db, params, actor), columns, chart? })`.
    It may take extra optional fields and an optional 4th `ctx` argument.
  - Consumed: `tagsFor(recordType, ids)`, `addBusinessDays`, `isOpen`,
    `capacityFor`, `getCalendar(db)`, `planFor(...)`, and `notify` (not used
    here).
- **No PHI.**
  - Reports never select `legacy_patient`, `rx_cases.patient_*`, `form_data`,
    or any encrypted note column, and never decrypt.
  - Audit metadata holds the report key and param names only.
- **Money and dates:**
  - Money is integer cents end to end, formatted only by
    `formatCell(type "money")`.
  - Dates are lab-local via `isoDateIn(LAB_TIMEZONE, …)`.
- **House rules:**
  - Files under 1,000 lines; functions under 150 (300 for a component with
    markup).
  - Never `alert`/`confirm`/`prompt`; use `useToast` for messages.
  - No Seazona calls, ever.
- **Roles:**
  - Money and pricing reports and tiles have `roles: ["admin"]`.
  - Operations, planning, productivity and departments use the registry
    default, `STAFF_ROLES` from `@my-app/shared`.
- **Time limits:**
  - Default `timeoutMs` 10000, max 30000; dashboard tile 5000.
  - `ROW_CAP` = 5000 (client paging); CSV cap 100000; CSV page 2000.
  - `MAX_CONCURRENT_RUNS` = 4 per instance, with a 5000 ms wait.
- **Migrations:**
  - Generated with `cd apps/api && pnpm db:generate`. Never hand-edit the
    journal.
  - On rebase (this piece merges last), drop this piece's generated SQL and
    journal entries and regenerate them.
- **Tests:**
  - api: `pnpm --filter @my-app/api test`
  - web: `pnpm --filter @my-app/web test`
  - `pnpm --filter @my-app/web build` must pass at the end of every web
    task.
- **Commits:**
  - End each commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Push only with `git push origin <branch>`.
- **Charts:** before writing chart code, load the `dataviz` skill and take
  the palette and mark rules from it.

## Review Focus

1. **A date range crossing DST or the lab-local midnight boundary.** An
   invoice issued 04:30 UTC on Nov 1 belongs to Oct 31 in Chicago, and
   "today" uses the lab day, not UTC. Pinned by Task 1 test
   `resolveDateRange uses the lab-local day at 04:30 UTC` and Task 5 test
   `daily sales buckets by lab-local issue day`.
2. **A report or tile that times out or throws.** The user sees "This report
   took too long. Try a shorter date range.", the pool connection is
   released, and on a dashboard only that tile shows the error. Pinned by
   Task 2 test `statement timeout maps to REPORT_TIMEOUT and releases` and
   Task 4 test `one failing tile does not fail the dashboard`.
3. **A lab-role user calling a money report or dashboard directly by URL.**
   It returns 403, and money tiles are absent from their Pulse rather than
   showing $0. Pinned by Task 2 test `run refuses a report outside the actor's
   roles` and Task 8 test `pulse for a lab user has no money tiles`.
4. **Exporting a 9,000-row server-paged report.** The CSV holds every
   matching row, not just the visible page, and its formatted values match the
   screen. Pinned by Task 2 test `export streams all pages up to the cap` and
   Task 3 test `toolbar Export CSV calls exportAll with current params`.
5. **A cell value starting with `=`, `+`, `-` or `@`** (for example a client
   name) must not become a spreadsheet formula. Negative money stays a plain
   number. Pinned by Task 2 test `server csv neutralises formulas but keeps
   -12.50`.

---

### Task 1: Scaffold the generic module: shared specs, registry, params, health, favorites table, README

**Files:**
- Create:
  - `packages/shared/src/reports/params.js`
  - `packages/shared/src/reports/columns.js`
  - `packages/shared/src/reports/index.js`
  - `packages/shared/src/reports/params.test.js`
  - `packages/shared/src/reports/columns.test.js`
- Modify: `packages/shared/src/index.js` (append `export * from "./reports/index.js";`)
- Create:
  - `apps/api/src/modules/reports/registry.js`
  - `apps/api/src/modules/reports/params.js`
  - `apps/api/src/modules/reports/health.js`
  - `apps/api/src/modules/reports/schema.js`
  - `apps/api/src/modules/reports/README.md`
  - `apps/api/src/modules/reports/registry.test.js`
  - `apps/api/src/modules/reports/params.test.js`
  - `apps/api/src/modules/reports/health.test.js`
  - `apps/api/src/modules/reports/no-domain-words.test.js`
- Modify: `apps/api/src/db/schema/index.js` (append `export { reportFavorites } from "../../modules/reports/schema.js";`)
- Migration: generated `apps/api/src/db/migrations/<n>_report_favorites.sql`

**Interfaces:**
- Produces, in shared:
  - `PARAM_TYPES = ["dateRange","date","select","multiselect","number","toggle","lookup"]`.
  - `DATE_PRESETS = ["today","yesterday","last7","last30","mtd","lastMonth","qtd","ytd","lastYear","last12m"]`.
  - `resolveDateRange(value: string | {from,to}, now: Date, tz: string) → { from: "YYYY-MM-DD", to: "YYYY-MM-DD", previous: {from,to} }`.
    Both ends are inclusive. `previous` is the equal-length period
    immediately before.
  - `COLUMN_TYPES = ["text","int","money","date","datetime","pct","duration_days","link","badge"]`.
  - `formatCell(column, value) → string`:
    - money: cents → `"$1,234.50"`;
    - pct: `0.074` → `"7.4%"`;
    - link: label text;
    - null → `""`.
  - `csvValue(column, value) → string|number`. Money becomes a plain
    `"1234.50"`, with no `$`.
- Produces, in the api module:
  - `createRegistry({ defaultRoles }) → registry`, with:
    - `defineGroup({ key, title, position })`;
    - `defineReport(def)`, which throws on a duplicate key, an unknown
      group, an unknown param or column type, or `timeoutMs > 30000`;
    - `defineDashboard`, `defineMetric`, `defineLookup`;
    - `provideCapability(name)`;
    - `listReports(actor) → [{...meta, available, missing: string[]}]`;
    - `getReport(key)`, `getDashboard(key)`, `getMetric(key)`, `getLookup(key)`;
    - `canView(actor, def) → boolean`.
  - `paramsSchema(def) → zod schema`, which coerces query strings. Its
    `parse(query, { now }) → resolved params` returns each dateRange as
    `{ from, to, previous }`.
  - `activityHealth({ recent, baseline, lastAt, asOf }, { inactiveDays, declining, stable }) → { band: "healthy"|"stable"|"declining"|"inactive", trend: number|null, isNew: boolean }`.
  - `reportFavorites` table: `user_id`, `report_key`, `created_at`, with
    PK `(user_id, report_key)`.

- [ ] **Step 1: Write the failing tests.**
  - `resolveDateRange uses the lab-local day at 04:30 UTC`:
    `resolveDateRange("today", new Date("2026-11-01T04:30:00Z"), "America/Chicago")`
    deep-equals `from/to "2026-10-31"`.
  - `mtd previous is the same days last month`:
    `"mtd"` at `2026-11-05` gives `{from:"2026-11-01",to:"2026-11-05"}`
    and `previous {from:"2026-10-27",to:"2026-10-31"}`.
  - `custom range rejects from after to and spans over maxDays`.
  - `formatCell money and pct`:
    `formatCell({type:"money"}, -1250) === "-$12.50"` and
    `formatCell({type:"pct"}, 0.074) === "7.4%"`.
  - `defineReport throws on duplicate key and on timeoutMs 30001`.
  - `listReports marks missing capabilities and hides reports outside the actor's roles`.
  - `paramsSchema coerces "25" to 25 and rejects an unknown select option`.
  - `activityHealth bands`. The cases, as `(recent, baseline, lastAt days ago)` → band:
    - `(0, 4, 120)` → inactive
    - `(1, 4, 3)` → declining (0.25)
    - `(3, 4, 3)` → stable (0.75)
    - `(4, 4, 3)` → healthy
    - `(2, 0, 3)` → healthy with `isNew: true`
    - `(0, 2, 45)` → declining
  - `no-domain-words`: reads every file under `modules/reports` (api and
    web, once it exists) and `packages/shared/src/reports`. It asserts that
    none matches
    `/\b(lab|dental|doctor|patient|practice|order|invoice|pan)\b/i`, with
    README.md exempt only in its "Wiring it into another app" section.
- [ ] **Step 2:** Run `pnpm --filter @my-app/shared test && pnpm --filter @my-app/api test -- modules/reports`.
  Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the shared specs, `registry.js` (a module-level
  Map per registry instance, in the style of `jobs/registry.js`),
  `params.js`, `health.js` and `schema.js`.
- [ ] **Step 4:** Run `cd apps/api && pnpm db:generate`. Check that the new
  SQL creates only `report_favorites`.
- [ ] **Step 5:** Write the README skeleton: purpose, public interface (the
  shapes above), configuration and data model. "Wiring it into another app"
  is a heading only (Task 11 fills it).
- [ ] **Step 6:** Run the tests. Expected: PASS.
- [ ] **Step 7:** Commit with the message `feat(reports): generic report registry, param/column specs, health rule, favorites table`.

### Task 2: Runner, server CSV, favorites service and the routes factory

**Files:**
- Create:
  - `apps/api/src/modules/reports/runner.js`
  - `apps/api/src/modules/reports/csv.js`
  - `apps/api/src/modules/reports/favorites.service.js`
  - `apps/api/src/modules/reports/routes.js`
  - `apps/api/src/modules/reports/runner.test.js`
  - `apps/api/src/modules/reports/csv.test.js`
  - `apps/api/src/modules/reports/routes.test.js`
- Create: `apps/api/src/routes/reports.routes.js`. This is app wiring: it
  builds the registry, calls `registerLabReports` (stubbed as an empty
  function until Task 5), and mounts the factory.
- Create: `apps/api/src/services/lab/reports/index.js` with
  `export function registerLabReports(registry) {}`.
- Modify: `apps/api/src/index.js` (one `register(reportsRoutes, { prefix: "/api/v1" })` line)
- Modify: `packages/shared/src/constants/errors.js` (add `REPORT_TIMEOUT`, `REPORT_UNAVAILABLE`, `REPORTS_BUSY`)

**Interfaces:**
- Consumes Task 1: the registry, `paramsSchema`, `csvValue`.
- Produces:
  - `runReport({ registry, db, key, query, actor, now }) → { rows, total, truncated, summary?, notice?, generatedAt, tookMs }`.
    It throws `ReportError(code)`, where code is one of NOT_FOUND,
    FORBIDDEN, INVALID, UNAVAILABLE, TIMEOUT or BUSY.
    - The run happens inside
      `db.transaction(fn, { accessMode: "read only" })`, after
      `SET LOCAL statement_timeout = ${timeoutMs}`.
    - Postgres error code `57014` maps to TIMEOUT.
    - With `paging: "server"`, `ctx.page = { limit, offset }` comes from the
      query. Otherwise rows are sliced to `ROW_CAP` and `truncated` is set.
  - `streamCsv({ registry, db, key, query, actor, reply })`. For server
    reports it pages by 2000 until the 100000 cap. The header row is the
    column labels.
  - `withRunSlot(fn)`: the semaphore (4 slots, 5000 ms wait, then BUSY).
  - `favorites.service`: `listFavoriteKeys(db, userId) → Set`,
    `setFavorite(db, userId, key, on)`.
  - `createReportRoutes({ registry, db, preHandler, audit }) → fastify plugin`.
    It serves the routes in the spec's API table.
    - Lookups return at most 20 rows.
    - Export calls `audit(request, "report.exported", key, { params: Object.keys(params) })`.

- [ ] **Step 1: Write the failing tests** (use `fakeTx`, and a fake
  `db.transaction` that records `SET LOCAL` SQL).
  - `run sets a read-only transaction and SET LOCAL statement_timeout 10000 by default`.
  - `statement timeout maps to REPORT_TIMEOUT and releases`: `run` throws
    `{ code: "57014" }`, giving `ReportError("TIMEOUT")`, and the slot count
    returns to 0.
  - `run refuses a report outside the actor's roles`: an admin-only report
    run by actor `{ role: "lab" }` gives FORBIDDEN.
  - `unmet requires gives UNAVAILABLE without calling run`.
  - `client paging caps at 5000 and sets truncated`.
  - `fifth concurrent run waits then BUSY`, using fake timers.
  - `export streams all pages up to the cap`: a server report with total
    4500 is called with offsets 0, 2000 and 4000, giving 4501 CSV lines.
  - `server csv neutralises formulas but keeps -12.50`:
    - a text cell `=SUM(A1)` becomes `'=SUM(A1)`;
    - a money cell `-1250` becomes `-12.50`.
  - Route tests (Fastify `inject` with a stub preHandler setting
    `request.user`):
    - `GET /reports groups and favorites flags`;
    - `PUT then DELETE /reports/:key/favorite`;
    - `GET /reports/:key/run 400 names the bad param`;
    - `503 body says "This report took too long. Try a shorter date range."`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `runner.js`, `csv.js`, `favorites.service.js`
  and `routes.js`, then the app wiring in `routes/reports.routes.js`.
  - `preHandler = [authenticate, requireRole(...STAFF_ROLES)]`.
  - `audit` = `auditService.logSafe` with `targetType: "report"`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with the message `feat(reports): time-limited read-only runner, streamed CSV, favorites and routes`.

### Task 3: Shared DataTable `exportAll` and the generic report UI

**Files:**
- Modify:
  - `apps/web/src/components/ui/data-table/DataTable.jsx`
  - `apps/web/src/components/ui/data-table/DataTableToolbar.jsx`
  - `apps/web/src/components/ui/data-table/DataTable.test.jsx`
- Create:
  - `apps/web/src/modules/reports/api.js`
  - `apps/web/src/modules/reports/useReport.js`
  - `apps/web/src/modules/reports/ReportsIndexPage.jsx`
  - `apps/web/src/modules/reports/ReportPage.jsx`
  - `apps/web/src/modules/reports/ReportParamsForm.jsx`
  - `apps/web/src/modules/reports/LookupField.jsx`
  - `apps/web/src/modules/reports/ReportTable.jsx`
  - `apps/web/src/modules/reports/columns.jsx`
  - `apps/web/src/modules/reports/README.md`
  - `apps/web/src/modules/reports/__tests__/ReportPage.test.jsx`
  - `apps/web/src/modules/reports/__tests__/ReportsIndexPage.test.jsx`
  - `apps/web/src/modules/reports/__tests__/columns.test.js`
- Modify:
  - `apps/web/src/config/routes.js` (`REPORTS: "/reports"`, `REPORT: "/reports/:key"`, `reportPath(key)`)
  - `apps/web/src/App.jsx` (two routes under `RequireStaff`)
  - `apps/web/src/components/layout/Sidebar.jsx` (staff item "Reports", icon `BarChart3`)

**Interfaces:**
- Consumes the Task 2 routes and the shared `formatCell`.
- Produces:
  - A new optional `DataTable` prop, `exportAll?: () => Promise<void>|void`.
    When set, the toolbar shows "Export CSV" with a busy state and toasts
    errors. When it is absent, the toolbar is unchanged.
  - `toTableColumns(specs) → Column[]`. Each column gets
    `cell = formatCell`; link columns render a `<Link>` from the
    `{field}` template; each gets `exportValue = csvValue` and a
    `sortValue`.
  - `<ReportTable report result params onExportAll />`. It uses client mode
    for `paging: "client"`, and server mode (`fetchPage` → run with
    limit/offset/sort) otherwise. Its `urlKey` is `"r"`.
  - `useReport(key) → { meta, params, setParams, result, loading, error, run }`.
    Params are mirrored to `p.<name>` search params.
  - `<LookupField source value onChange />`: a debounced typeahead against
    `/reports/lookups/:source`. Before writing it, check whether piece 6
    shipped a generic client picker; if it did, extend that one instead.

- [ ] **Step 1: Write the failing tests.**
  - DataTable: `toolbar Export CSV calls exportAll with current params`,
    and `no exportAll, no toolbar export button`. The existing BulkBar
    export tests still pass.
  - `columns.test.js`:
    - `link template fills {id}`;
    - `money exportValue is a plain number string`.
  - `ReportsIndexPage`:
    - `search filters by title and description`;
    - `favorites section shows starred reports first`;
    - `unavailable report shows "Not available yet" and is not a link`.
  - `ReportPage`:
    - `runs with defaults on load`;
    - `changing the date preset updates the URL p.range and reruns`;
    - `timeout error shows the server message`;
    - `notice renders above the table`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/web test`. Expected: FAIL.
- [ ] **Step 3:** Implement. The index groups use the server's `groups`
  order. The star toggle is optimistic and reverts with a toast on error.
- [ ] **Step 4:** Run the tests and `pnpm --filter @my-app/web build`.
  Expected: PASS.
- [ ] **Step 5:** Commit with the message `feat(reports): whole-result CSV on DataTable; reports index and report page`.

### Task 4: Charts and the dashboard engine (generic)

**Files:**
- Modify: `apps/web/package.json` (add `chart.js` 4.x, an exact version at
  least two weeks old)
- Create:
  - `apps/web/src/modules/reports/Chart.jsx` (lazy-imports `chart.js`;
    registers only Bar/Line controllers, Category/Linear scales,
    Bar/Line/Point elements, Tooltip and Legend)
  - `apps/web/src/modules/reports/StatTile.jsx`
  - `apps/web/src/modules/reports/FeedTile.jsx`
  - `apps/web/src/modules/reports/DashboardPage.jsx`
  - `apps/web/src/modules/reports/__tests__/DashboardPage.test.jsx`
  - `apps/web/src/modules/reports/__tests__/chart-spec.test.js`
- Create:
  - `apps/api/src/modules/reports/dashboards.js`
  - `apps/api/src/modules/reports/dashboards.test.js`
- Modify: `apps/api/src/modules/reports/routes.js` (`GET /dashboards`, `GET /dashboards/:key`)
- Modify:
  - `apps/web/src/config/routes.js` (`DASHBOARD_HOME: "/lab/dashboard"`, `DASHBOARD: "/lab/dashboard/:key"`)
  - `App.jsx` (the route goes under `RequireStaff`)
- Modify: `apps/web/src/modules/reports/ReportPage.jsx` (render the `chart`
  spec above the table)

**Interfaces:**
- Produces, in the api:
  `resolveDashboard({ registry, db, key, query, actor, now, cache }) → { key, title, tiles: [{ id, kind, span, ok: true, data } | { id, kind, ok: false, error }] }`.
  - Tiles run in parallel through `runReport` / metric `run`, each with
    timeoutMs 5000.
  - Tiles outside the actor's roles are omitted.
  - The cache key is `${tile}|${JSON(params)}|${roles}`, with a TTL of
    60000 ms.
- Produces, in the web:
  - `chartConfig(spec, rows) → Chart.js config`. It is pure and testable,
    with grouped vs. stacked derived from `spec.type`.
  - `<Chart spec rows height />`.
  - `<StatTile value previous format href />`. It shows the delta vs.
    previous as ▲/▼ and a %.
  - `<FeedTile rows />`. It polls the dashboard's feed tile every 30000 ms
    while `document.visibilityState === "visible"`.

- [ ] **Step 1: Write the failing tests.**
  - `one failing tile does not fail the dashboard`.
  - `tile outside roles is omitted, not errored`.
  - `second call within 60 s is served from cache; after 60 s re-runs`.
  - `chartConfig groupedBar makes one dataset per series; stackedBar sets stacked scales`.
  - `DashboardPage renders tabs, a failed tile shows its message, others render`.
  - `FeedTile stops polling when hidden`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Load the `dataviz` skill. Implement, taking the series
  colours from the skill's palette as Tailwind-matching tokens.
- [ ] **Step 4:** Run the tests and the web build. Check that the build
  output shows chart.js in its own chunk, not in the main entry.
- [ ] **Step 5:** Commit with the message `feat(reports): dashboards with isolated cached tiles; Chart.js wrapper`.

### Task 5: Lab glue: shared metrics, the Accounting (9) and Sales (8) reports

**Files:**
- Create:
  - `apps/api/src/services/lab/reports/lab-metrics.js`
  - `apps/api/src/services/lab/reports/lab-metrics.test.js`
  - `apps/api/src/services/lab/reports/groups.js`
  - `apps/api/src/services/lab/reports/lookups.js`
  - `apps/api/src/services/lab/reports/accounting.reports.js`
  - `apps/api/src/services/lab/reports/sales.reports.js`
  - `apps/api/src/services/lab/reports/accounting.reports.test.js`
  - `apps/api/src/services/lab/reports/sales.reports.test.js`
- Modify: `apps/api/src/services/lab/reports/index.js` (register groups,
  lookups, accounting and sales)

**Interfaces:**
- Consumes:
  - `services/billing/aging.js` (`buildReceivables`, `ageBalances`);
  - `ledger.service.js` (`openReceivableInvoices`, `withBalances`);
  - `statements.service.js` (`loadClient`);
  - `isoDateIn`.
- Produces in `lab-metrics.js`. Every function takes `db` first. These are
  the single source for tiles in Task 8.
  - `salesCents(db, { from, to, clientUserId? }) → number` (sales rule from
    the spec: issued, subtotal, lab-local issue day).
  - `salesByDay(db, range) → [{ day, cents, invoices }]`.
  - `salesByMonth(db, { from, to }) → [{ month: "YYYY-MM", cents }]`.
  - `salesBreakdown(db, range) → { grossCents, discountCents, netCents, taxCents, shippingCents, totalCents }`.
  - `clientName` SQL fragment: `coalesce(doctor_profiles.company_name, users.name)`.
  - `coverageNotice(range) → string|null`. It reads env
    `REPORTS_COVERAGE_FROM`.
- Produces in `groups.js`: the 8 groups `accounting, clients, departments,
  operations, planning, productivity, products, sales`, with the audit's
  titles and order.
- Produces in `lookups.js`: `client` (doctor users, admin only), `product`
  (variants by code/name), `category`, `department` and `staff`
  (`listAssignableStaff`).
- Report keys (exact): `accounting.account-balance`,
  `accounting.adjustments`, `accounting.aging-summary`,
  `accounting.discounts`, `accounting.invoices` (server),
  `accounting.invoices-summary`, `accounting.invoices-payments` (server),
  `accounting.payments-received` (server), `accounting.statements-summary`;
  `sales.comparison`★, `sales.summary`★, `sales.daily`, `sales.lab`,
  `sales.net-chart`, `sales.category`, `sales.by-client` (server, title
  "Sales By Doctor"). All of them have `roles: ["admin"]`.
  `sales.by-rep` is Task 10.

- [ ] **Step 1: Write the failing tests** (`fakeTx` returns rows; assert on
  the shaping and on the SQL fragments where the rule lives).
  - `daily sales buckets by lab-local issue day`: an invoice issued
    `2026-11-01T04:30Z` counts on `2026-10-31`.
  - `sales excludes void and draft and uses subtotal not total`: compare the
    SQL text with `/status\s*=\s*'issued'/` and `subtotal_cents`.
  - `sales summary: gross 10000, discount -1500 gives net 8500; tax and
    shipping are reported separately`.
  - `sales comparison returns 12 months × 3 years with zeros filled`.
  - `aging summary totals equal the sum of buckets`, reusing
    `buildReceivables`.
  - `statements summary: closing = opening + invoiced − paid per client`.
  - `payments received excludes negative reversal rows and labels source`.
  - `category sales carries the coverage notice when from < REPORTS_COVERAGE_FROM`.
  - `no accounting or sales report selects legacy_patient or decrypts`:
    read the source text and assert there is no `legacyPatient` and no
    `open`/`unseal` import.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the metrics, lookups and the 17 definitions,
  with the columns and charts listed in the spec's coverage tables.
  `sales.comparison` uses chart `groupedBar`; `sales.net-chart` uses
  `line`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with the message `feat(lab-reports): accounting and sales reports on one sales rule`.

### Task 6: Lab glue: the Clients (8 buildable, with health) and Products & Services (4 buildable) reports

**Files:**
- Create:
  - `apps/api/src/services/lab/reports/clients.reports.js`
  - `apps/api/src/services/lab/reports/products.reports.js`
  - `apps/api/src/services/lab/reports/client-health.js`
  - `apps/api/src/services/lab/reports/clients.reports.test.js`
  - `apps/api/src/services/lab/reports/products.reports.test.js`
- Modify: `index.js` (register them)

**Interfaces:**
- Consumes Task 1's `activityHealth` and Task 5's `lab-metrics`.
- Produces:
  - `HEALTH_THRESHOLDS = { inactiveDays: 90, declining: 0.5, stable: 0.85 }`.
  - `clientHealthRows(db, { asOf }) → [{ clientUserId, client, band, isNew, recent, baseline, trend, sales30Cents, avgTurnaroundDays, monthly: number[6], lastOrderAt }]`.
    It is one grouped query over `lab_orders` with `FILTER` clauses, then
    `activityHealth` per row. Insights (Task 8) reuses it.
- Report keys:
  - `clients.health`★ (admin)
  - `clients.list` (staff)
  - `clients.doctors` (staff)
  - `clients.top`
  - `clients.bottom`
  - `clients.inactive`
  - `clients.new-orders`
  - `clients.no-recent-sales`
  - `products.price-list` (admin)
  - `products.sold` (admin)
  - `products.units` (staff)
  - `products.units-detail` (staff, server)
  - `clients.same-pricing` and `products.materials` are in Task 10.

- [ ] **Step 1: Write the failing tests.**
  - `clientHealthRows: baseline is days 31–210 divided by 6; recent is the last 30 lab-local days`.
  - `health report excludes clients who never ordered`.
  - `bottom clients only considers clients with an order in the prior 12 months`.
  - `inactive clients default to 90 days and honour the days param`.
  - `new client orders: first-ever order inside the range only`.
  - `units sold sums lab_order_lines qty, excluding noteOnly lines`.
  - `products sold groups invoice lines by variant falling back to code`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with the message `feat(lab-reports): client health score and client/product reports`.

### Task 7: Lab glue: the Operations, Productivity, Departments and Planning reports (buildable now), plus the catalog completeness test

**Files:**
- Create:
  - `apps/api/src/services/lab/reports/operations.reports.js`
  - `apps/api/src/services/lab/reports/productivity.reports.js`
  - `apps/api/src/services/lab/reports/departments.reports.js`
  - `apps/api/src/services/lab/reports/planning.reports.js`
  - `apps/api/src/services/lab/reports/order-metrics.js`
  - `apps/api/src/services/lab/reports/order-metrics.test.js`
  - `apps/api/src/services/lab/reports/ops.reports.test.js`
  - `apps/api/src/services/lab/reports/catalog.test.js`
  - `apps/api/src/services/lab/reports/audit-names.js`
- Modify: `index.js`

**Interfaces:**
- Consumes `isOverdue` (`lab-order-rules.js`) and `isoDateIn`.
- Produces in `order-metrics.js`:
  - `boardDayCounts(db, today) → { pastDue, dueToday, dueTomorrow, onHold, atRisk }`.
    This is the seam. Task 10 re-points it to piece 7's board-tile counts.
    The interim at-risk rule: open, not on hold, `due_date ≤ today+2`, and
    status in (received, in_production).
  - `atRiskOrders(db, today, limit) → [{ id, orderNumber, client, status, dueDate, rush }]`.
  - `turnaroundDays(order, calendar?)`: calendar days now. With a
    calendar it uses `addBusinessDays`/`isOpen` (Task 10).
  - `ordersByDay(db, range)`, `shippedByDay(db, range)` and
    `openUnitsByCategory(db)`.
- Produces in `audit-names.js`: `AUDIT_REPORTS`, the 63 `{ group, title }`
  copied from the spec's coverage tables.
- Report keys, buildable now:
  - `operations.case-submission`★
  - `operations.daily-orders`
  - `operations.daily-shipments`
  - `operations.shipping` (server)
  - `operations.tbd-orders`
  - `productivity.orders`★ (server)
  - `productivity.orders-completed`★
  - `productivity.tasks-completed`★
  - `productivity.monthly-counts`
  - `productivity.monthly-orders`
  - `productivity.remakes`
  - `productivity.turnaround`
  - `departments.monitoring-boards`★ (with `display: "wall"`)
  - `departments.orders`
  - `departments.completed`
  - `departments.moved`
  - `departments.summary`
  - `departments.units`
  - `planning.technician-workload`★
  - `planning.assigned-orders`
  - `planning.assigned-units-chart` (chart `bar`)
- Supporting change: add `display?: "wall"` to the registry's allowed
  fields, and add a web Wall view toggle in `ReportPage.jsx` (full screen,
  large type, 60 s auto-rerun).

- [ ] **Step 1: Write the failing tests.**
  - `boardDayCounts treats an on-hold past-due order as on hold, not past due`.
    This matches `isOverdue`; read that rule and assert the same answer.
  - `tasks completed counts status events per byUserId per to-status in range, ignoring system (null) moves`.
  - `case submission: digital when recordsMethod is set or a scan file exists, physical otherwise; shop and legacy orders count as "unknown"`.
  - `turnaround excludes unshipped and cancelled orders; median of [2,4,30] is 4`.
  - `technician workload shows an "Unassigned" row`.
  - `remakes report carries the history coverage notice`.
  - `catalog.test: every AUDIT_REPORTS title is defined exactly once in its group, and there are 63 definitions in total (including Task 10's stubs, which until then are registered with requires)`.
    Task 7 registers the 14 dependent ones as stubs: `requires` plus a
    `run` that throws UNAVAILABLE. Task 10 replaces the stub bodies.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the definitions, the 14 stubs with their
  `requires` and the wall view.
  - The stubs' `requires` values are `pan-numbers`, `materials`,
    `record-tags`, `workflows`, `business-calendar`, `pickups`,
    `deliveries` and `price-lists`, per the spec's Needs column.
- [ ] **Step 4:** Run the api and web tests and the web build. Expected:
  PASS.
- [ ] **Step 5:** Commit with the message `feat(lab-reports): operations, productivity, departments, planning reports; full 63-report catalog`.

### Task 8: Lab dashboards (Pulse, Operations, Insights, Sales), the activity feed and navigation

**Files:**
- Create:
  - `apps/api/src/services/lab/reports/dashboards.js`
  - `apps/api/src/services/lab/reports/activity-feed.js`
  - `apps/api/src/services/lab/reports/dashboards.test.js`
  - `apps/api/src/services/lab/reports/activity-feed.test.js`
- Modify:
  - `index.js` (register metrics and dashboards)
  - `apps/web/src/components/layout/Sidebar.jsx` (staff item "Dashboard",
    first, `LayoutDashboard`, → `/lab/dashboard`)
  - `apps/web/src/config/routes.js` (`roleHome`: admin → `/lab/dashboard`;
    lab is unchanged)
  - `routes.test.js`

**Interfaces:**
- Consumes `boardDayCounts`, `atRiskOrders`, `salesCents`, `salesByMonth`,
  `clientHealthRows`, `turnaroundDays` and `openUnitsByCategory`.
- Produces:
  - Metric keys:
    - `ops.past-due`, `ops.at-risk`, `ops.due-today`, `ops.due-tomorrow`,
      `ops.on-hold`;
    - `ops.new-today`, `ops.shipped-today`, `ops.shipped-yesterday`;
    - `sales.today`, `sales.ytd`, `sales.mtd` (admin);
    - `insights.orders-30`, `insights.active-clients`,
      `insights.avg-turnaround-30`.
    - Each returns `{ value, previous, format, href }`, where `href` links
      to the matching report with its params.
  - Report `ops.activity-feed` (staff, used by the feed tile):
    `activityFeed(db, { since, limit: 50, includeMoney }) → [{ at, kind: "status"|"hold"|"shipment"|"payment", text, href }]`.
    - The text is built only from order number, client name, status labels,
      the carrier and the amount (money only when `includeMoney`).
    - It never reads `note` columns.
    - Payment rows come only from `invoice_payments` with `applied_cents > 0`.
  - Dashboards `pulse`, `operations`, `insights` (admin) and `sales`
    (admin), with the tiles from the spec's Dashboards table.

- [ ] **Step 1: Write the failing tests.**
  - `pulse for a lab user has no money tiles`: resolve with actor `{role:"lab"}`
    and assert that `sales.today` is absent.
  - `activity feed never selects note columns`: the SQL text contains no
    `note`, and the feed includes no payment rows for a lab actor.
  - `activity feed merges events, shipments and payments newest first, limit 50`.
  - `sales.ytd previous is the same day-of-year last year`.
  - `insights.active-clients value excludes inactive, and the data carries declining and inactive counts`.
  - `routes.test: admin roleHome is /lab/dashboard, lab is /lab`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the api and web tests and the web build. Expected:
  PASS.
- [ ] **Step 5:** Commit with the message `feat(lab-reports): Pulse, Operations, Insights and Sales dashboards with live feed`.

### Task 9: Indexes, time limits under load, and the bench

**Files:**
- Modify (index definitions only):
  - `apps/api/src/db/schema/lab-orders.js`
  - `apps/api/src/db/schema/invoices.js`
  - `apps/api/src/db/schema/invoice-payments.js`
  - `apps/api/src/db/schema/shipments.js`
- Migration: generated `<n>_report_indexes.sql`
- Create:
  - `apps/api/scripts/reports-bench.js`
  - `apps/api/scripts/reports-bench-seed.js`
  - `apps/api/src/modules/reports/bench.test.js` (the pure parts only)
- Modify: `apps/api/package.json` (`"reports:bench": "node --env-file=.env scripts/reports-bench.js"`)

**Interfaces:**
- Produces these indexes (the exact names):
  - `lab_orders_received_idx(received_at)`
  - `lab_orders_shipped_idx(shipped_at) where shipped_at is not null`
  - `lab_orders_client_received_idx(client_user_id, received_at)`
  - `lab_orders_open_due_idx(due_date) where status not in ('shipped','cancelled')`
  - `lab_orders_department_idx(department_id) where department_id is not null`
  - `lab_orders_assignee_idx(assignee_user_id) where assignee_user_id is not null`
  - `lab_order_events_at_idx(at)`
  - `lab_order_events_type_at_idx(type, at)`
  - `invoices_status_issued_idx(status, issued_at)`
  - `invoices_client_issued_idx(client_user_id, issued_at)`
  - `invoice_payments_paid_on_idx(paid_on)`
  - `invoice_payments_created_at_idx(created_at)`
  - `invoice_lines_variant_idx(variant_id)`
  - `shipments_shipped_idx(shipped_at)`
- Produces the bench:
  - It refuses any `DATABASE_URL` whose database name is not
    `diamond_labs_bench`.
  - `--seed` creates and migrates `diamond_labs_bench`, then inserts 21,000
    orders, 20,000 invoices, 30,000 lines, 60,000 events, 15,000 payments,
    9,000 shipments and 480 clients. The data is synthetic: names
    "Client 001" etc., with no patient fields.
  - It runs every available report and dashboard with default params as an
    admin actor, prints a table of key → ms, and exits 1 if any one takes
    over 2000 ms.

- [ ] **Step 1: Write the failing tests.**
  - `bench refuses a database not named diamond_labs_bench`.
  - `seed plan sizes match the stated counts`.
  - `schema declares each listed index`: import the tables and assert on
    the index names from drizzle's `getTableConfig`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Add the indexes and run `pnpm db:generate`. Check that the
  SQL contains only `CREATE INDEX` statements. Then implement the bench.
- [ ] **Step 4:** Run locally:
  `createdb diamond_labs_bench; DATABASE_URL=postgresql://bif@localhost:5432/diamond_labs_bench pnpm --filter @my-app/api reports:bench --seed`.
  Expected: every row is under 2000 ms, and the exit code is 0. Paste the
  timing table into the commit body.
- [ ] **Step 5:** Commit with the message `perf(reports): range/group indexes and a 21k-row bench under 2 s`.

### Task 10: Dependent reports (pieces 6, 7, 8, 10), run AFTER rebasing onto `feat/own-the-lab` with 7, 6, 8 and 10 merged

**Files:**
- Modify:
  - `planning.reports.js`
  - `departments.reports.js`
  - `operations.reports.js`
  - `products.reports.js`
  - `clients.reports.js`
  - `sales.reports.js`
  - `order-metrics.js`
  - `productivity.reports.js`
  - `index.js`
- Test: `apps/api/src/services/lab/reports/dependent.reports.test.js`
- Regenerate this piece's two migrations (Global Constraints).

**Interfaces:**
- Consumes the roadmap names. Before you start, verify each one exists with
  `grep` and record any rename in the commit body:
  - `modules/workflows`: `planFor`;
  - `modules/business-calendar`: `getCalendar(db)`, `addBusinessDays`,
    `isOpen`, `capacityFor`;
  - `modules/record-tags`: `tagsFor(recordType, ids)`;
  - piece 6's pan number column and its materials/lot tables, enclosed
    items and discount/remake reason list;
  - piece 8's pickups and local-delivery tables;
  - piece 10's same-pricing query and named price lists;
  - piece 7's board daily tile count function.
- Produces:
  - `provideCapability(...)` calls in `index.js`, one per capability that
    now exists.
  - The real `run` bodies for the 14 stubs. Their keys:
    - `planning.calendar`★, `planning.tasks-schedule`★,
      `planning.assigned-tasks`, `planning.assigned-tasks-summary`
    - `departments.tasks`, `departments.tasks-summary`
    - `operations.daily-tasks`, `operations.production-tasks`,
      `operations.pan-numbers`, `operations.pickups`,
      `operations.deliveries`
    - `products.materials`, `clients.same-pricing`, `sales.by-rep`
  - Enrichments:
    - Discounts and Remakes gain a reason column (piece 6).
    - Case Submission uses enclosed items and scanner uploads (piece 6).
    - Orders gains a `tag` lookup filter via `tagsFor`.
    - `turnaroundDays` uses business days.
    - Price List gains a `priceList` param.
    - `boardDayCounts` delegates to piece 7's function, and its interim rule
      is deleted.

- [ ] **Step 1: Write the failing tests.**
  - `capability provided → report available and runs; stub UNAVAILABLE path deleted`.
  - `tasks schedule lists planFor stage targets per day for the next 14 lab days`.
  - `calendar compares due units to capacityFor(date)`.
  - `sales by rep groups by the client's rep tag; untagged clients show "No rep"`.
  - `boardDayCounts equals piece 7's tile counts for the same fixture`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement against the verified names.
- [ ] **Step 4:** Run the api and web tests, the web build and
  `reports:bench`. Expected: PASS and every report under 2 s.
- [ ] **Step 5:** Commit with the message `feat(lab-reports): workflow, calendar, pickup, tag, material and price-list reports go live`.

### Task 11: The README "wiring into another app" section, and runbook and docs updates

**Files:**
- Modify:
  - `apps/api/src/modules/reports/README.md`
  - `apps/web/src/modules/reports/README.md`
  - `docs/cutover-runbook.md` (§6 Smoke and "After the cutover")
  - `CLAUDE.md` (one line under Key File Paths: `Reports: apps/api/src/modules/reports (generic), services/lab/reports (lab definitions)`)

- [ ] **Step 1:** Write "Wiring it into another app". It covers:
  - `createRegistry` and `createReportRoutes` mounting;
  - re-exporting `schema.js` from the app's drizzle schema index and
    generating the migration;
  - writing one `defineReport` (a worked 15-line example with no domain
    words);
  - the `roles` default, `provideCapability`, the env var
    `REPORTS_COVERAGE_FROM`;
  - the web routes, plus the Sidebar entries for the index and dashboards;
  - the bench.
- [ ] **Step 2:** Add these runbook lines:
  - In §6 Smoke: "Open Dashboard › Sales and compare YTD with Labzona's
    Sales tab. Ours is invoice subtotal (no tax/shipping) by issue date, so
    note the difference; do not fail on it."
  - In §6 Smoke: "Open Reports › Client Health; the band counts should be
    in the same range as Labzona's Insights tab."
  - In §7 / After: "Set `REPORTS_COVERAGE_FROM=<cutover date>` on the
    Cloud Run service."
  - In §7 / After: "Staff star their favourite reports. Labzona's starred
    reports are already featured; nothing to re-enter."
- [ ] **Step 3:** Run the `no-domain-words` test again. Expected: PASS, with
  domain words only inside the README's wiring example section, if at all.
- [ ] **Step 4:** Commit with the message `docs(reports): wiring guide, cutover smoke and coverage env`.
