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

## Rulings after planning (2026-11-05, binding over the plans where they differ)

- **R-A `defaultDueAt`:** piece 7 owns it, at `apps/api/src/services/lab/lab-scheduling.js`:
  `defaultDueAt(tx, { variantIds, requestedDueDate, rush, workflowKey, startAt }) → { dueDate, plan }` and
  `saveSchedule(tx, labOrderId, plan)`.
  Piece 6 builds in parallel against a **stub with the identical path, exports and signature** (today + 13 days, skipping Sat/Sun; `plan: null`; `saveSchedule` is a no-op).
  When piece 6 rebases onto piece 7 it deletes the stub and keeps piece 7's file. Piece 6's plan text calling it "piece 6's seam" is superseded.
- **R-B notify seam:** `apps/api/src/services/notify-seam.js` exports `async function notify(db, { event, recordType, recordId, audience, data })`. It is a no-op that resolves to undefined.
  Whichever piece needs it first creates it with exactly that content, and a later piece keeps the existing file. Piece 8 repoints its body at `modules/notifications`.
- **R-C module vocabulary guard:** piece 7 creates `apps/api/src/modules/` and `apps/web/src/modules/` and the test that fails on lab/doctor/patient/dental/rx words inside modules.
  A piece that builds a module before rebasing onto 7 adds the same guard only if it is missing, and keeps piece 7's on rebase.
- **R-D reuse across pieces:**
  - Piece 8 message attachments use piece 6's `record-files` module.
  - Piece 9 report favorites use piece 6's `record_stars` (`recordType "report"`).
  - Piece 9 registers piece 10's `sameClientPricingGroups` as `clients.same-pricing`.
  - Piece 8's local-delivery list reads piece 6's `lab_orders.delivery_method`.
- **R-E migrations:** on rebase, regenerate. Hand-written seed migrations (piece 6 `seed_adjustment_reasons`, piece 7 calendar/workflow seed) are re-created with the same SQL under the new number, never dropped.
- **R-F lab timezone:** `LAB_TIMEZONE` stays America/Chicago until the user confirms. The audit shows a La Mesa, CA address, and the cutover runbook carries a confirm step.
- **R-G `delivery_method` belongs to piece 6**, which merges before 8 and adds `lab_orders.delivery_method` with `LAB_DELIVERY_METHODS`. Piece 8 drops its own column task (its Task 10 migration) and reads piece 6's column. Piece 8 may keep its "default from the client's last order" rule as behaviour on top of piece 6's column.
- **R-H notify import path:** call sites import from `apps/api/src/services/notify-seam.js` (R-B), not `services/notify.js`. Piece 8 puts the real implementation in `modules/notifications` and makes `notify-seam.js` delegate to it. Its return value (delivery counts) is a superset of R-B's `undefined`, so seam callers must not depend on it.
- **R-I attachments:** piece 8 stores message attachments through piece 6's `record-files` (`attachFiles`, `filesFor`, `relinkFiles`, `signedUrlFor`). It does not add its own generic upload to `storage.service.js`; piece 6 owns that refactor.
