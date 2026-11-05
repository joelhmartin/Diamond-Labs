# Lab parity — pieces 6–10 (roadmap)

_2026-11-05. Branch: each piece on its own branch, PR into `feat/own-the-lab`._

## Why

The Labzona audit (`Labzona-to-Diamond-Labs-Audit.pdf`, 60 screenshots,
2026-11-05) listed every screen the lab has. Pieces 1–5 cover catalog,
orders + board, invoicing/AR, shipping labels and the import. The user wants
**everything else built too**, including what looked optional. On top of that
they want it **modular and reusable**: this whole setup is meant to be a guide
for building the same thing for a different client later.

## Binding rules (every piece)

1. **Generic module, then thin glue.** Each capability is a generic module
   with no lab/doctor/dental words in it. It lives in
   `apps/api/src/modules/<name>/` (service + pure rules + adapters + routes
   factory), with UI in `apps/web/src/modules/<name>/` and shared schemas in
   `packages/shared/src/<name>/`. Lab-specific vocabulary, statuses, report
   definitions and email copy live in config/glue files outside the module.
   Each module ships a `README.md` covering purpose, public interface,
   configuration, data model, and "wiring it into another app" steps.
2. **Every list is the shared table.** Use `DataTable` + `useDataTable` /
   `usePagedList` (`apps/web/src/components/ui/data-table/`). Pagination,
   search, filters, row selection (click, ⌘/Ctrl-click, Shift-range), bulk
   actions and CSV export are table configuration, never per-page code. If a
   piece needs a table feature that doesn't exist (e.g. row grouping, a
   column chooser), extend the shared component. Do not build a one-off.
3. **Extend before parallel-build.** Before writing anything, check whether
   the app already does the job (email.service, jobs runner, audit log,
   ConfirmButton, Toast, PDF services, carrier-adapter pattern,
   `lab_order_events`). Extend it; never build a second one.
4. **Adapters for anything external** (SMS provider, scanner portals),
   modelled on `services/shipping/carrier-registry.js`. They stay switched off
   until their credentials exist, and come with fixtures and a sandbox smoke
   command.
5. **No PHI in logs, emails or notifications.** Message and notification
   emails say *that* something happened and link in; the text stays in the
   app. Patient-bearing columns are encrypted like `lab-order-crypto.js`.
6. **House rules.** Keep files under 1,000 lines and functions under 150 (300
   for a component with its markup). Never use alert/confirm/prompt. Use the
   inline ConfirmButton for destructive steps. Money is integer cents. Each
   piece owns its own migrations.
7. **Nothing calls Seazona.** Data the API never exposed starts fresh at
   cutover; the cutover runbook gets a re-entry step for each such item.

## Evidence that shapes the design (import data, 20,696 orders)

- `panNumber` is filled on **99%** of orders and printed on the lab slip.
  Our `lab_orders` has **no pan field**. Piece 6 adds it and the import
  maps it.
- `assignedTo` is filled on 10 of 20,696 orders, `department` on 0, and
  product `settings` on 0. Per-tech assignment and product settings are
  configured but unused. Build them as optional; import nothing.
- Order labels, stars, enclosed items, materials/lots, remake reasons,
  messages, pickups and workflow tasks are **not in the API**. They are built
  new, and the cutover runbook lists what staff re-enter by hand (open pickups,
  open messages).
- The lab enters discounts as free-text lines ("courtesy discount per MR",
  "VA patient", "model discount", "no charge for remake"). Piece 6's
  remake/discount reasons should offer these as a pick-list with free text
  still allowed.
- Workflow tasks: 2,109 are past due and none was ever completed. Ruling:
  turnaround workflows compute the due date and a per-stage target schedule
  (shown on the slip and board, flagged when a case is behind), with no
  per-step checkbox list. Cost if wrong: the checklist is an additive table
  later.

## Pieces

| # | Piece | Generic modules it introduces | Lab glue |
|---|---|---|---|
| 6 | **Production desk** | `record-tags` (labels + stars on any record), `barcode-lookup` (scan → record) | Staff order entry (full + quick, any practice), pan numbers (+ import mapping), enclosed items, materials & lot numbers per line, remake/discount reason list, merge cases, lab-slip additions |
| 7 | **Scheduling** | `business-calendar` (lead time, closed weekdays, holidays, capacity per day by orders/units), `workflows` (named turnaround templates → due date + stage targets) | 8 lab workflows seeded; due date defaults on order entry/release; orders calendar page; board daily tiles (past due / today / tomorrow / hold / at risk) |
| 8 | **Messaging, notifications, logistics** | `messaging` (threads on any record, participants, unread, attachments), `notifications` (event → in-app + email + SMS, per-user prefs, alert center), `sms` adapter (Twilio impl, off) | Lab↔practice case threads; new-order / pickup / message alerts; pickups (doctor requests in portal, lab schedules/completes) and local-delivery route list |
| 9 | **Reports & dashboards** | `reports` (report = definition: query, params, columns, chart; rendered on DataTable with CSV; registry + index with search/favorites per user) | All Labzona report groups whose data exists after 6–8 (accounting, clients, departments, operations, planning, productivity, products, sales), Pulse / Operations / Insights / Sales dashboards, client health score |
| 10 | **Pricing & accounts extras** | `exports` (named CSV export formats over a query, format registry so QuickBooks/Xero drop in later) | Named price lists (templates assigned to clients), copy prices client→client, same-pricing report, invoice export screen (CSV now) |

Deferred by the user: QuickBooks/Xero formats (piece 10's exporter takes them
later) and scanner-portal APIs (Dexis/iTero/Medit/…), which need vendor
developer accounts. Piece 6 builds a generic **scanner-export upload** (a
file drop that creates a draft order with the files attached); the portal
adapters come later.

## Shared interfaces (pieces must agree on these names)

- `modules/business-calendar`: `addBusinessDays(date, n, calendar)`,
  `isOpen(date, calendar)`, `capacityFor(date, calendar)`;
  `getCalendar(db)` loads the lab's settings.
- `modules/workflows`: `planFor({ workflowKey, startAt, rush }, calendar)` →
  `{ dueAt, stages: [{ key, label, targetAt }] }`. Piece 6's order entry calls
  `planFor` to default the due date. Until 7 merges, piece 6 uses the existing
  due logic behind a single `defaultDueAt()` seam, which 7 then repoints.
- `modules/notifications`: `notify(db, { event, recordType, recordId,
  audience, data })`. Pieces 6, 7 and 10 emit through this once 8 merges,
  and use no-op calls behind the same seam before that.
- `modules/record-tags`: `tagsFor(recordType, ids)`, used by board, orders
  and reports filters.
- `modules/reports`: `defineReport({ key, group, title, params, run(db,
  params, actor), columns, chart? })`. Other pieces may register reports in
  their glue.

## Merge order and conflicts

All five are planned and built in parallel, each in its own worktree.
They merge **in the order 7 → 6 → 8 → 10 → 9**. Each later piece rebases
onto the updated `feat/own-the-lab` and **regenerates its own migrations**
(drop the piece's generated SQL and journal entries, then
`pnpm db:generate`) instead of hand-merging the drizzle journal. Shared
registration points (route index, nav config, job definitions index) are
one-line appends, so conflicts there are mechanical.
