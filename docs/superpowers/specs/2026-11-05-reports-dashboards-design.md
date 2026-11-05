# Piece 9: Reports and dashboards (design)

_2026-11-05 · roadmap: `2026-11-05-lab-parity-roadmap.md` (binding) · merges
LAST (7 → 6 → 8 → 10 → 9) · audit rows: Dashboard (4), Client activity /
health score, Reports (index + 8 groups)_

## Intent

The lab opens Labzona on its dashboards every morning, and it uses about 80
reports. Diamond Labs has neither. This piece adds:

1. A **generic `reports` module**. A report is a definition: params, a query,
   columns and an optional chart. The module provides a registry, a searchable
   index with groups and per-user favorites, a runner with time limits, CSV
   export, and dashboards built from the same definitions.
2. **Lab glue** that registers every report in the audit's 8 groups (63
   reports), four dashboards (Pulse, Operations, Insights, Sales) and the
   client health score.

The module is meant to be lifted into another app. It has no lab, dental,
doctor or order words in it.

## What exists today (survey 2026-11-05, commit aa54f20)

- **Charting:** none. `apps/web/package.json` has no chart dependency, and no
  SVG chart exists in `apps/web/src`.
- **DataTable** (`apps/web/src/components/ui/data-table/`, hook
  `hooks/useDataTable.js`) has client and server modes, filters (`toggle`,
  `chip`, `date`, `select`, `multiselect`), URL mirroring and selection.
  - CSV export exists **only for selected rows**, as a BulkBar action
    (`BulkBar.jsx`, `lib/data-table/csv.js`).
  - Server mode selects page-wide only, so a 9,000-row report could never be
    exported whole. Task 2 extends the shared table with a toolbar "Export
    CSV" for the whole result (`exportAll`).
- **Data the reports read** (all on the branch now):
  - `lab_orders`: status, `receivedAt` / `startedAt` / `shippedAt`, `dueDate`,
    `rush`, `isRemake`, `departmentId`, `assigneeUserId`, `clientUserId`,
    `source`.
  - `lab_order_lines` (qty, code, variant) and `lab_order_events` (status /
    assign / department / due / hold / shipment, with `byUserId` and `at`).
  - `invoices` + `invoice_lines` (kind item / shipping / fee / adjustment,
    `priceSource`) and `invoice_payments` (signed ledger, `source`, `paidOn`).
  - `shipments` (carrier, charge, `shippedAt`, `deliveredAt`).
  - `users` (role doctor = client), `doctor_profiles`, `memberships`,
    `client_prices`, catalog `product_families.category` /
    `product_variants`.
  - `rx_cases.recordsMethod` and `rx_case_files.kind = scan` (intake channel).
- **Reusable logic:**
  - `services/billing/aging.js` (`ageBalances`, `buildReceivables`) and
    `ledger.service.js` (`openReceivableInvoices`, `withBalances`).
  - `statements.service.js` (`loadClient`).
  - `isoDateIn` / `LAB_TIMEZONE` (`packages/shared/src/lab/lab-order-status.js:84`).
  - The overdue rule `isOverdue` (`lab-order-rules.js`).
  - `lib/list-query.js` (`pageOf`, `containsPattern`).
  - `audit.service.logSafe`.
  - The registry style of `jobs/registry.js`.
- **Tests:** vitest with `fakeTx` (`apps/api/src/test/fake-tx.js`). No test
  touches a real database.
- **Pool:** postgres.js with max 20 connections in production
  (`config/database.js`). No statement timeout is set anywhere.

### Premises in the brief/roadmap that the code contradicts

1. **Departments are not "pieces 6–8 data".** `lab_departments`,
   `lab_orders.department_id` and `department` events already exist
   (`apps/api/src/db/schema/lab-orders.js:22-29,49,104`), with an admin page
   at `/admin/lab/departments`. The same is true of per-tech assignment
   (`assignee_user_id`, `lab-orders.js:50`).
   - So the Department reports and Technician Workload are **buildable now**.
     They are simply empty until the lab names departments and assigns work.
2. **"80 reports in 9 groups":** the audit names 63 reports in 8 groups
   (9+9+8+10+7+7+5+8). The other 17, and the 9th group, are not in any
   screenshot.
   - This piece builds the 63 by name. Adding a missed one later is one
     `defineReport` call in the glue.
3. **Historic remakes are not imported.**
   - `import/map-orders.js:49` hard-codes `isRemake: false`, yet the census
     shows `isRemake` filled on 20,696/20,696 orders. Remake rates before
     cutover therefore read 0.
   - Naively setting it true would also take legacy rows out of the partial
     unique index `lab_orders_source_idx` (`where is_remake = false`).
   - This piece does not change the import. The Remakes report carries a
     coverage note, and the fix is handed to the owner of `map-orders.js`
     (piece 6 already edits it for pan numbers).
4. **Product-level history is partial.**
   - Legacy invoices carry real lines only where invoice detail was fetched
     (3,096 of about 20k). The rest have one summary line
     (`import/map-invoices.js:77-86`).
   - Legacy orders carry lines only from the 583 fetched details.
   - Money totals by day, client or month are complete. Products / Units /
     Category reports are complete only from cutover on.
   - Those reports show a coverage note whenever their range starts before
     the cutover date.

## Goals

- Every list and report is rendered by the shared `DataTable`, with
  pagination, search, filters, selection, selected-row CSV and whole-result
  CSV.
- Every one of the 63 audit reports has a definition. A report that
  depends on pieces 6, 7, 8 or 10 is written against the roadmap
  interfaces and declares `requires`. Until its capability is registered,
  the index lists it as "Not available yet: needs <capability>".
- Four dashboards match the audit's tiles and charts:
  - Pulse: daily numbers plus a live activity feed with no AI.
  - Operations, Insights and Sales.
- Client health score, with a stated rule (below).
- At about 20k orders and 20k invoices, each report runs in under 2 s on the
  main DB, with hard time limits and planned indexes. No warehouse and no
  nightly rollups.

## Non-goals

- No AI daily brief, because the user said "no AI". Pulse shows numbers and a
  feed.
- No scheduled or emailed reports, and no saved custom report builder.
- No per-report column chooser. If one is wanted later, it is a DataTable
  extension.
- No patient data in any report (see Rulings).
- No QuickBooks/Xero formats (piece 10's `exports`).

## Module boundaries

```
apps/api/src/modules/reports/          GENERIC (no lab words)
  registry.js        defineReport, defineDashboard, defineLookup, provideCapability, list/get
  params.js          param spec → zod schema; date-range presets (uses packages/shared/src/reports)
  runner.js          runReport(): permission, params, read-only tx + statement_timeout, row cap, paging, timing
  csv.js             server CSV from column specs (streams, formula-safe)
  dashboards.js      resolveDashboard(): tiles in parallel, per-tile timeout + isolation, 60 s cache
  health.js          activityHealth({ recent, baseline, lastAt, asOf }, thresholds) → band (pure)
  favorites.service.js
  schema.js          report_favorites (re-exported from db/schema/index.js)
  routes.js          createReportRoutes({ registry, db, preHandler, canView, audit })
  README.md
packages/shared/src/reports/           GENERIC, shared by API + web
  params.js          PARAM_TYPES, DATE_PRESETS, resolveDateRange(preset|{from,to}, today, tz)
  columns.js         COLUMN_TYPES (text,int,money,date,datetime,pct,duration_days,link,badge), formatCell()
apps/web/src/modules/reports/          GENERIC UI
  ReportsIndexPage.jsx, ReportPage.jsx, DashboardPage.jsx
  ReportParamsForm.jsx, LookupField.jsx, ReportTable.jsx (DataTable wrapper), Chart.jsx, StatTile.jsx, FeedTile.jsx
  api.js, useReport.js, README.md
apps/api/src/services/lab/reports/     LAB GLUE
  index.js           registerLabReports(registry): every group + dashboards + lookups + capabilities
  accounting.reports.js clients.reports.js departments.reports.js operations.reports.js
  planning.reports.js productivity.reports.js products.reports.js sales.reports.js
  lab-metrics.js     shared lab queries (sales cents, open-order counts, health inputs) used by reports AND tiles
  dashboards.js      Pulse, Operations, Insights, Sales
  catalog.test.js    every audit name is defined once
```

**One implementation per number.** Each dashboard tile reads a report or a
`lab-metrics.js` function, and so does the matching report. For example, "Sales
today" on Pulse and the Daily Sales report call the same `salesCents()`, so the
two cannot drift.

## Public interface (roadmap name kept, fields added)

```js
defineReport({
  key: "sales.daily",                    // unique, dotted
  group: "sales", title: "Daily Sales",  // group key + label come from defineGroup
  description: "…",                      // searchable
  params: [{ name: "range", type: "dateRange", default: "last30", maxDays: 1830 }, …],
  run(db, params, actor, ctx),           // ctx = { page: {limit,offset}|null, sort, now, today, signal }
                                         //   → { rows, total?, summary?, notice? }
  columns: [{ id, label, type, align?, link?: "/x/{id}", sortable? }],
  chart?: { type: "line"|"bar"|"groupedBar"|"stackedBar", x, series: [{ field, label }] },
  roles?: ["admin"],                     // who may view; default = registry default
  paging?: "client" | "server",          // default client (≤ ROW_CAP rows)
  requires?: ["pickups"],                // capabilities; unmet → listed, not runnable
  featured?: true,                       // shown under "Lab favorites" by default
  timeoutMs?: 10000,                     // ≤ 30000
});
defineDashboard({ key, title, params?, tiles: [{ id, kind: "stat"|"chart"|"table"|"feed", report?|metric?, span?, roles? }] });
defineMetric({ key, roles?, run(db, params, actor, ctx) → { value, previous?, format, href? } });
defineLookup({ key: "client", roles?, search(db, q, actor) → [{ value, label }] , label(db, value) });
provideCapability("pickups");            // pieces 6/7/8/10 glue (or this piece's glue after rebase) calls it
```

`run(db, params, actor)` is the roadmap signature. The fourth `ctx` argument is
optional and additive, so a definition written to the roadmap signature still
works.

**Params** are validated server-side by a zod schema built from the spec. The
types are:

- `dateRange`: presets today, yesterday, last7, last30, mtd, lastMonth, qtd,
  ytd, lastYear, last12m, or custom `{from,to}`, resolved in `LAB_TIMEZONE`.
- `date`, `select` (with options), `multiselect`, `number` (min/max) and
  `toggle`.
- `lookup` (source = a registered lookup, e.g. `client`, `product`,
  `department`, `staff`, `category`, `tag`).

The web form is drawn from the same spec, and the params are mirrored into
the URL (`p.<name>`), so a report link is shareable.

**Columns are data, not React.** The API serves them, the web formats them
with `formatCell`, and the server CSV uses the same formatter, so the screen
and the export agree. Money stays integer cents until it is formatted.

## Data model

One new table and new indexes (migrations are detailed in the plan).

```
report_favorites
  user_id     varchar(128) not null
  report_key  varchar(120) not null
  created_at  timestamptz  not null default now()
  primary key (user_id, report_key)
```

Indexes (task 7, chosen for the date-range and group-by paths):

| Index | Serves |
|---|---|
| `lab_orders (received_at)` | Daily/Monthly Orders, Orders, Insights volume |
| `lab_orders (shipped_at) where shipped_at is not null` | Orders Completed, Turnaround, Daily Shipments |
| `lab_orders (client_user_id, received_at)` | Client health, Top/Bottom, Inactive, New Client Orders |
| `lab_orders (due_date) where status not in ('shipped','cancelled')` | Past due / today / tomorrow / at risk, TBD |
| `lab_orders (department_id)`, `lab_orders (assignee_user_id)` (partial, not null) | Department and Workload reports |
| `lab_order_events (at)`, `lab_order_events (type, at)` | Pulse feed, Tasks Completed, Dept Moved |
| `invoices (status, issued_at)` | Every sales report |
| `invoices (client_user_id, issued_at)` | Sales by Doctor, No Recent Sales |
| `invoice_payments (paid_on)`, `invoice_payments (created_at)` | Payments Received, Pulse feed |
| `invoice_lines (variant_id)` | Products/Units Sold |
| `shipments (shipped_at)` | Daily Shipments, Shipping |

No data is imported, and nothing is re-entered beyond favorites (see Cutover).

## Definitions the lab reports share (lab glue, `lab-metrics.js`)

- **Sales** = `invoices.subtotal_cents` (goods and adjustments, excluding tax
  and shipping) of invoices with `status = 'issued'`, dated by the lab-local
  day of `issued_at`. Void invoices and drafts are excluded. Legacy invoices
  are included.
  - Gross = positive item/fee lines.
  - Discounts = negative `adjustment` lines plus the reduction on
    `priceSource = 'remake'` lines.
  - Net = Gross − Discounts = subtotal.
- **Order received** = `lab_orders.received_at`. **Completed** =
  `shipped_at`. Cancelled orders are excluded unless a report says otherwise.
- **Turnaround** = calendar days from received to shipped. After piece 7 it is
  business days via `addBusinessDays` / `isOpen(date, calendar)`, swapped in
  behind `turnaroundDays(order, calendar?)`.
- **Past due** = the existing `isOverdue`. Due today, due tomorrow, on hold and
  **at risk** come from **piece 7's board daily tiles**:
  - Reports call 7's count function; they do not re-derive at-risk.
  - Until rebase, a local `boardDayCounts()` seam uses the interim at-risk
    rule: open, not on hold, due within 2 calendar days, and still `received`
    or `in_production`.
- **Client** = a user with role `doctor`. The display name is
  `doctor_profiles.company_name`, falling back to `users.name`.

## Client health score (rule)

The pure function lives in the module (`activityHealth`), and the lab glue sets
the thresholds.

- `recent` = orders received in the last 30 days.
- `baseline` = orders received in the 180 days before that (days 31–210),
  divided by 6. That is the monthly average of the prior 6 months.
- `lastAt` = the most recent order.

The band is decided in this order:

1. **Inactive**: no order in the last 90 days (`lastAt` missing or older).
2. **Declining**: `recent / baseline < 0.5`. This includes `recent = 0` with
   an order 31–90 days ago.
3. **Stable**: `0.5 ≤ recent / baseline < 0.85`.
4. **Healthy**: `recent / baseline ≥ 0.85`, or `baseline = 0` and
   `recent ≥ 1`. A new client is marked `isNew`.

The report also shows:

- `trend` = `recent / baseline` as a percent;
- 30-day sales;
- average turnaround over the last 30 days;
- 6 monthly counts as a sparkline series.

Insights uses the same rule for "158 active (35 declining, 111 inactive)":
active = not Inactive. Clients who have never ordered are excluded.

## API routes (module factory, mounted at `/api/v1`)

| Method | Path | Who | Returns |
|---|---|---|---|
| GET | `/reports` | staff | `{ groups, reports:[{key,group,title,description,featured,favorite,available,missing,params,columns,chart,paging}] }` filtered by role |
| GET | `/reports/:key/run` | per report | `{ rows, total, truncated, summary?, notice?, generatedAt, tookMs }`; query = params + `limit/offset/sort` (server paging) |
| GET | `/reports/:key/export.csv` | per report | streamed CSV of the whole result (cap 100,000 rows); audit `report.exported` (key + param names only) |
| PUT/DELETE | `/reports/:key/favorite` | staff | `{ favorite }` |
| GET | `/reports/lookups/:source?q=` | per lookup | `[{ value, label }]` (≤ 20) |
| GET | `/dashboards` | staff | list visible to the actor |
| GET | `/dashboards/:key` | staff | `{ tiles:[{ id, kind, ok, data | error }] }` tiles the actor may see |

Errors:

- An unknown key returns 404.
- A role failure returns 403.
- Invalid params return 400 with the field.
- An unmet `requires` returns 409 `REPORT_UNAVAILABLE`.
- A timeout returns 503 `REPORT_TIMEOUT`, with the message "This report took
  too long. Try a shorter date range."

## UI screens

- **Nav:** add a staff item "Reports" (`/reports`). Add "Dashboard" as the
  first staff item: `/lab/dashboard`, opening on Pulse. `roleHome` for `lab`
  stays `/lab`, and admins land on the dashboard.
- **Reports index (`/reports`):**
  - a search box, which matches title, description and group;
  - sections in order: Favorites (the user's stars), Lab favorites
    (`featured`), then the 8 groups;
  - a star toggle on each report;
  - unavailable reports greyed out with the reason.
- **Report page (`/reports/:key`):**
  - the params form at the top, with a Run button. A report runs on load
    with its defaults.
  - the chart, if any, above the table.
  - `ReportTable`, a thin DataTable wrapper:
    - columns built from specs;
    - client or server mode from `paging`;
    - search across text columns;
    - selection with selected-row CSV;
    - the new toolbar "Export CSV" (whole result).
  - the notice/coverage banner, the summary/footer row, and "took 0.4 s".
- **Dashboards (`/lab/dashboard/:key?`):**
  - tabs for Pulse, Operations, Insights and Sales;
  - a grid of tiles. Stat tiles show the value and the delta vs. the previous
    period. Chart tiles show a Chart. Table tiles show a compact DataTable.
    The feed tile shows the last 50 events, polling every 30 s while visible.
  - Each tile loads and fails on its own.
- **Monitoring Boards** (the Departments report) has a "Wall view" toggle:
  full screen, large type, auto-refresh every 60 s, with the table under the
  chart.

## Dashboards (lab glue)

| Dashboard | Tiles (audit) |
|---|---|
| **Pulse** | Stat tiles:<br>• Past due<br>• At risk<br>• New cases today<br>• Sales today ($, admin)<br>• Shipped today / yesterday<br>• On hold<br><br>At-risk order list (table).<br>Live activity feed: status moves, holds, shipments, payments recorded (admin). The feed shows order numbers, client names and statuses, never notes. |
| **Operations** | Stat tiles: Past due, Due today, Due tomorrow, On hold.<br>Product counts in open orders by category (table + bar chart).<br>Orders due per day, next 14 days (bar chart).<br>Turnaround trend: weekly average, last 26 weeks (line chart). |
| **Insights** (admin) | Orders in the last 30 days, with the % change vs. the prior 30.<br>Active clients, with the declining and inactive counts.<br>Average turnaround over 30 days.<br>Top clients by volume (table).<br>Health band distribution (bar chart). |
| **Sales** (admin) | YTD sales, with the % change vs. the same period last year.<br>Month to date ($ and order count).<br>3-year comparison by month (grouped bar chart).<br>Monthly totals (table). |

## Coverage of every audit report

The Status column uses three values:

- **Now** = buildable from tables on the branch today.
- **Needs N** = depends on piece N's data. The report is defined now, ships
  with `requires`, and lights up after rebase.
- **+N** = buildable now and enriched by piece N.

Reports marked ★ were starred in Labzona and are `featured` here. Roles: A =
admin only (money or pricing), S = staff (admin + lab).

### Accounting (9). Role A.

| Report | Status | Source |
|---|---|---|
| Account Balance | Now | `openReceivableInvoices` + `buildReceivables` (one row per client) |
| Adjustments | Now | `adjustment` lines and `credit` ledger rows by date |
| Aging Summary | Now | `buildReceivables` buckets, with totals |
| Discounts | Now, +6 (reason column from piece 6's reason list) | negative adjustment lines + remake-priced lines |
| Invoices | Now (server paging) | invoices by issue date, status and client |
| Invoices Summary | Now | count / subtotal / tax / shipping / total by day, month or client |
| Invoices & Payments | Now (server paging) | each invoice with paid, balance and last payment date |
| Payments Received | Now (server paging) | ledger rows > 0 by `paidOn ?? created`, by source, with reference |
| Statements Summary | Now | per client for a month: opening, invoiced, paid, closing |

### Clients (9). Role A, except the two lists, which are S.

| Report | Status | Source |
|---|---|---|
| ★ Client Health | Now | health rule above |
| Client List (S) | Now | doctor users + profile, account number, active, last order |
| Doctors List (S) | Now | doctor users with their practice memberships |
| Top Clients | Now | sales in the range, top N (param, default 25) |
| Bottom Clients | Now | the lowest N among clients with ≥ 1 order in the prior 12 months |
| Inactive Clients | Now | no order in N days (default 90), with last order and lifetime sales |
| New Client Orders | Now | clients whose first-ever order falls in the range |
| No Recent Sales | Now | sales in the prior period but none in the last N days |
| Same Pricing | Needs 10 | groups clients with an identical price set; calls piece 10's same-pricing query |

### Departments (8). Role S.

| Report | Status | Source |
|---|---|---|
| ★ Monitoring Boards | Now | open orders by department × status, with wall view |
| Dept Orders | Now | orders in each department (open, or received in range) |
| Dept Completed | Now | `department` events leaving a department, plus shipments, by department |
| Dept Moved | Now | `department` events in range (from, to, by, at) |
| Dept Summary | Now | counts and units per department |
| Dept Tasks | Needs 7 | stage targets falling in range, grouped by stage/department |
| Dept Tasks Summary | Needs 7 | counts of stage targets: due / behind |
| Dept Units | Now | Σ line qty per department |

### Operations (10). Role S.

| Report | Status | Source |
|---|---|---|
| ★ Case Submission | Now, +6 | digital vs. physical intake per day. Today it uses `rx_cases.recordsMethod` and scan files. Piece 6's enclosed items and scanner-export upload refine it. |
| Daily Orders | Now | received per day |
| Daily Shipments | Now | shipments and orders shipped per day, by carrier |
| Daily Tasks | Needs 7 | stage targets due on a day |
| Deliveries | Needs 8 | piece 8's local-delivery route list by date |
| Pan Numbers | Needs 6 | orders with pan number, status and due date |
| Pick Ups | Needs 8 | pickups by date and status |
| Production Tasks | Needs 7 | open orders by current stage vs. target |
| Shipping | Now (server paging) | shipments: carrier, service, tracking, charge, orders |
| TBD Orders | Now | open orders with no due date |

### Planning (7). Role S.

| Report | Status | Source |
|---|---|---|
| ★ Calendar | Needs 7 | due counts and units per day vs. `capacityFor(date, calendar)`, linking to piece 7's calendar page |
| ★ Tasks Schedule | Needs 7 | stage targets per day for the next 14 days |
| ★ Technician Workload | Now | open orders and units per assignee (unassigned shown as its own row) |
| Assigned Orders | Now | orders per assignee in range |
| Assigned Tasks | Needs 7 | stage targets of orders assigned to each tech |
| Assigned Tasks Summary | Needs 7 | the same, counted |
| Assigned Units Chart | Now | units per assignee (bar chart) |

### Productivity (7). Role S.

| Report | Status | Source |
|---|---|---|
| ★ Orders | Now, +6 (tag filter via `tagsFor`) | orders received, by client / status / source |
| ★ Orders Completed | Now | shipped in range, per assignee |
| ★ Tasks Completed | Now | status-move events per user per stage (`lab_order_events` type `status`, `byUserId`). Piece 7 relabels them by stage. |
| Monthly Counts | Now | orders and units per month |
| Monthly Orders | Now | orders per month per client (pivot of 12 columns) |
| Remakes | Now, +6 (reasons) | `isRemake` orders, the original, the client and the rate. Coverage note: history before cutover is not flagged. |
| Turnaround Times | Now, +7 | average and median days by product category and month |

### Products & Services (5).

| Report | Status | Source |
|---|---|---|
| Materials Used (S) | Needs 6 | materials and lots per line in range |
| Price List (A) | Now, +10 | catalog variants with base price. Piece 10 adds a named price-list param. |
| Products Sold (A) | Now | invoice lines by variant/code: qty and $. Coverage note before cutover. |
| Units Sold (S) | Now | qty by product |
| Units Sold Detail (S) | Now (server paging) | line-level, with order and invoice number |

### Sales (8). Role A.

| Report | Status | Source |
|---|---|---|
| ★ Sales Comparison | Now | monthly sales for 3 years (grouped bar) |
| ★ Sales Summary | Now | gross, discounts, net, tax, shipping and total for a range |
| Daily Sales | Now | per day |
| Lab Sales | Now | by channel (`invoices.kind`: order / shop / legacy) |
| Net Sales Chart | Now | net per month (line chart) |
| Product Category Sales | Now | lines → variant → family `category`. Coverage note. |
| Sales By Doctor | Now (server paging) | per client |
| Sales By Rep | Needs 6 | sales grouped by client tag (piece 6 `record-tags` on `client` records); the lab tags each client with its rep |

The totals are 49 Now and 14 Needs. The Needs reports split as: piece 6 ×3
(Pan Numbers, Materials Used, Sales By Rep), piece 7 ×8, piece 8 ×2 and
piece 10 ×1.

## Performance

- Data size is about 20.7k orders, about 20k invoices, about 30k lines and
  growing about 30 orders a day. At that size every report is one or two
  grouped queries, and the indexes above make each range query an index
  range scan.
- Each run is wrapped by `runner.js` in a
  `transaction(… { accessMode: "read only" })` with
  `SET LOCAL statement_timeout = <timeoutMs>`:
  - 10 s by default and 30 s at most;
  - dashboards get 5 s per tile.
- On timeout the user gets a clear message, never a hung request.
- **Row cap:** a client-paged report returns at most 5,000 rows, with
  `truncated: true` and a notice. Large reports are declared `paging:
  "server"`. CSV export streams up to 100,000 rows in pages of 2,000.
- **Concurrency:** at most 4 report runs per instance, enforced by a module
  semaphore. A fifth waits up to 5 s, then gets 503 "Reports are busy". This
  protects the 20-connection pool that payments share.
- **Cache:** dashboard tiles are cached in memory for 60 s per (tile, params,
  role set). Reports are not cached.
- **Bench:** `pnpm --filter @my-app/api reports:bench` (Task 7) seeds a
  disposable local DB (`diamond_labs_bench`) with 21k synthetic, non-PHI
  orders, invoices, lines, events and payments. It runs every available
  report and dashboard with default params, prints the timings, and exits
  non-zero if any one takes over 2 s.

## Cutover / import impact

- Nothing imports. Every report reads data that is already imported (orders,
  invoices, payments, clients) or created after cutover.
- **Re-entry:** Labzona's starred reports are carried over as `featured` in
  code, so nobody re-enters them. Per-user favorites start empty, and staff
  star their own. The runbook gets one optional smoke line: open Pulse and
  Sales and compare YTD sales with Labzona's Sales tab.
  - The two numbers can differ. Labzona's YTD may include tax/shipping;
    ours is subtotal by the stated rule. The runbook says to note the
    difference, not to fail on it.
- Coverage notes are visible on product-level and remake reports for ranges
  before the cutover date. The date is read from config
  (`REPORTS_COVERAGE_FROM`, an ISO date, set at cutover; unset = no note).

## Rulings

- **Ruling: Chart.js 4, tree-shaken and lazy-loaded behind one `<Chart>`
  wrapper.**
  - Why: the app has no charting. The charts needed are line, bar, grouped
    bar and stacked bar.
    - Chart.js covers all four with about 45 KB gz once registered
      selectively. It has no React peer-dependency churn (we use a 40-line
      `useEffect` wrapper, not `react-chartjs-2`).
    - uPlot is smaller but is awkward for categorical bars. Recharts is about
      twice the size and pulls d3.
    - The chunk loads only on report and dashboard routes.
    - The DataTable under every chart is the accessible fallback.
  - Cost if wrong: one file, `Chart.jsx`, to swap. Chart specs are data and
    stay the same.
- **Ruling: columns, params and charts are serializable specs, not React
  cells.**
  - Why: one definition drives the API, the web table and the server CSV, so
    an export can never disagree with the screen. It also keeps the module
    portable.
  - Cost if wrong: a report needing a bespoke cell needs a new column `type`
    in `packages/shared/src/reports/columns.js`.
- **Ruling: dependent reports are defined now with `requires`, and are hidden
  from running until a capability is provided.**
  - Why: the index shows all 63 from day one. Piece 9 merges last, so after
    rebase its glue calls `provideCapability` for what exists, and the
    reports light up with no further release.
  - Cost if wrong: a few definitions are written against interface names
    that piece 6/7/8/10 rename. That is fixed at rebase (Task 9 checks each
    one).
- **Ruling: "tasks" means piece 7's workflow stage targets, and "Tasks
  Completed" means status moves from `lab_order_events`.**
  - Why: the roadmap rules out per-step checkboxes, and status moves already
    record who did what and when.
  - Cost if wrong: if a task-checklist table is added later, Tasks Completed
    re-points to it in one definition.
- **Ruling: no patient data in reports; reports never decrypt.**
  - Why: reports are exported to CSV and shared. An order number links to the
    order page, which already shows the patient with audit logging.
  - Cost if wrong: if the lab needs patient on Pan Numbers, add a
    `phi: true` column type that decrypts, audit-logs and is excluded from CSV.
- **Ruling: money reports are admin-only, and operations reports are staff.**
  - Why: the `lab` role is "never pricing, payments, users"
    (`db/schema/users.js:4-6`). Pulse hides money tiles from lab staff.
  - Cost if wrong: one `roles` field per report.
- **Ruling: Sales = issued invoice subtotal by issue date** (definitions
  above).
  - Why: it excludes pass-through tax and shipping, and drafts are not sales.
  - Cost if wrong: Sales tiles disagree with Labzona's figure. It is one
    function, `salesCents()`, to change.
- **Ruling: the health thresholds are 90-day inactive, < 0.5 declining and
  < 0.85 stable, on a 30-day vs. 6-month trend.**
  - Why: these match Labzona's band names and the audit's "30-day orders vs.
    6-month trend". The numbers are in lab glue.
  - Cost if wrong: retune three constants.
- **Ruling: live computation with indexes, time limits and a 60 s tile cache;
  no rollup tables.**
  - Why: at about 20k rows, grouped queries take milliseconds, and the brief
    forbids a warehouse.
  - Cost if wrong: if volume grows 10× and the bench exceeds 2 s, add one
    nightly rollup job (the jobs framework exists).
- **Ruling: whole-result CSV is a DataTable extension (`exportAll`), not
  per-page code.**
  - Why: roadmap rule 2. Server-mode tables have no way to select all rows.
  - Cost if wrong: none for other pages, because the prop is optional.
- **Ruling: Pulse's feed polls every 30 s; no websockets.**
  - Why: there is no realtime infrastructure, and piece 8's notifications
    module owns push.
  - Cost if wrong: one hook re-points to piece 8's alert stream.
- **Ruling: do not change the legacy import here** (the isRemake premise
  above).
  - Why: it changes the unique-index semantics of the import, and that is
    piece 5/6 territory.
  - Cost if wrong: historic remake rates stay at zero until the import owner
    maps it.
