# Shared DataTable + Lab Board Table View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every list table in the web app becomes one shared, column-defined `DataTable` with one look, search, filters, pagination, and multi-row selection with bulk actions (click, ⌘/Ctrl-click, Shift-click); the lab production board gains a table view of collapsible per-status sections (all collapsed by default) with the same move buttons, as single and bulk actions.

**Architecture:** Pure logic (selection, filtering/sorting/paging, CSV) lives in `apps/web/src/lib/data-table/` and is unit-tested in node. A `useDataTable` hook owns table state in two modes: `client` (rows already loaded) and `server` (a `fetchPage` callback; the API pages). `<DataTable table={t} columns={…} …/>` renders toolbar, bulk bar, table, and pagination from that state. Four list APIs gain optional `limit`/`offset` and return `total`, so the 20k-row invoice and order lists are reachable.

**Tech Stack:** React 18, Tailwind, lucide-react, react-router v7, axios (`config/api.js`), vitest; adds `jsdom` + `@testing-library/react` (dev) for render tests. Fastify + Drizzle + zod (`@my-app/shared` schemas) on the API.

**Spec:** No separate spec. The user's requests (2026-10-28, in chat) are the spec, restated here:
1. "All these tables … need to be a shared component … a modular table setup where we can create columns for different use cases, but share a single design system."
2. "They also all need pagination", search (keep), and "should all have the capability to add filters."
3. "Bulk actions should be a feature on all these tables with all the normal functionality like cmd click to select multiple rows and all that stuff."
4. Production board: "make it possible to view as a table with simple rows … same 'move to production' buttons and move them along but have manageable tables in a column stack. expandable and collapseable none open by default."
The user said "just build it": no mockups, no questions. Decisions below marked **(call)** are the planner's, made under that instruction.

## Global Constraints

- Never use `alert()`, `confirm()`, `prompt()`. Confirmation = `components/ui/ConfirmButton.jsx` (arm on first click, commit on second) or a modal; messages = `useToast()`.
- Source files under 1,000 lines; functions under 150 (components with markup: 300).
- One implementation per capability: reuse `components/ui/Pagination.jsx`, `lib/requests.js` (`errorText`, `isStale`), `ConfirmButton`, `useToast`. Delete a page's local `Th`, its hand-rolled debounce and its request-sequence guard when the page moves to `useDataTable`.
- No PHI in logs. Patient names are encrypted at rest and are not server-searchable; never add a patient-name server search.
- Browser storage only for per-viewer conveniences, every access in try/catch, page works without it.
- One look **(call)**: the admin "navy/surface" family, applied to doctor pages too:
  - wrapper `overflow-hidden rounded-2xl border border-surface-300/50 bg-white` (inner `overflow-x-auto`)
  - thead `bg-surface-50 text-[10px] font-mono uppercase tracking-widest text-navy/40`; th `px-4 py-3 font-medium text-left`
  - row `border-t border-surface-300/40`, hover `hover:bg-surface-50/60`, selected `bg-brand-500/5`; td `px-4 py-3 text-sm text-navy`
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; push with `git push origin feat/own-the-lab-data-tables` (never bare `git push`).
- Tests: web `pnpm --filter @my-app/web test`, api `pnpm --filter @my-app/api test`; web build `pnpm --filter @my-app/web build` must pass at the end of every web task.

## Decisions (calls)

- **Selection model** (Finder/Gmail):
  - checkbox click or ⌘/Ctrl+click on a row toggles that row and sets the anchor.
  - Shift+click (row or checkbox) adds the range from the anchor to the clicked row, in the current visible order.
  - plain click on a row runs `onRowClick` when the table has one, otherwise selects only that row.
  - the header checkbox selects or clears every selectable row on the current page.
  - Esc clears the selection.
  - Clicks on `a, button, input, select, textarea, label, [data-row-ignore]` inside a row never select and never trigger `onRowClick`.
  - Selection survives paging. It clears when search, filters or sort change.
  - Rows can be unselectable (`isRowSelectable`).
- **"Select all matching"** banner: in client mode, once the whole page is selected, offer "Select all N matching". Server mode selects page-wide only.
- **Built-in bulk action:** "Export CSV" on every table (selected rows; a column's `exportValue(row)` or its string cell). It can be disabled with `exportable={false}`.
- **Bulk actions report** `{ ok: number, failed: [{ id, message }] }`; DataTable toasts a summary ("12 moved, 1 failed: #100231 changed since you loaded it") and the caller reloads.
- **Board view:**
  - Table view is the default; the Board/Table choice is remembered in `localStorage["lab.board.view"]`.
  - Table view is a stack of one collapsible section per `LAB_BOARD_COLUMNS` status, all collapsed on every load. A header shows the label, the count and the overdue count.
  - Each section is a client-mode DataTable with page size 20 and no search box of its own; the page-level search and filter bar applies.
  - The kanban view also gets "Show 25 more" per column (first 25 cards), so it stops stretching.
- **Bulk move** loops the existing `POST /lab/orders/:id/status { to, expectedVersion }` one order at a time (no new endpoint), collects failures, then reloads once.
  - The offered moves are the statuses in `quickMoves()` of every selected card (intersection), labelled the same as the card buttons.
- **Server paging:**
  - An optional `limit` (1–200) and `offset` (≥0) are added to `/admin/invoices`, `/lab/orders`, `/admin/payments` and `/lab/shipments`. When `limit` is sent, the response adds `total`.
  - Without `limit`, each endpoint behaves exactly as today. The board keeps calling `/lab/orders` without it.
  - `/admin/invoices` gains `q`: a digits-only q matches the invoice number by prefix, otherwise it matches the client's practice/account or doctor name with case-insensitive contains.
  - `/lab/shipments` gains `q`: tracking number or order number.
- **Rx cases** stays client mode (counts on its status pills come from loaded rows). Moving it to server mode is noted as a follow-up, not done here.

## Review Focus

1. Shift+click when the anchor row is not on the current page, or after a re-sort: treat it as a plain toggle, never select rows the user cannot see. (Task 1 test `shift-click with an off-page anchor toggles only the clicked row`.)
2. A bulk action where some rows fail (stale version, already shipped): the others still apply, the toast names the failures, the list reloads, and rows that left the view drop out of the selection. (Task 1 test `selection prunes ids no longer present`, Task 3 test `moveOrders keeps going after a stale failure`.)
3. Typing fast in a server-mode search: only the newest response renders, and the page resets to 1 when search or filters change. (Task 1 test `server mode ignores a slower older response` and `changing a filter resets page to 1`.)
4. A click on a link or button inside a row (the order-number link, Refund, Email statement) must not select the row or fire `onRowClick`. (Task 1 render test `inner controls neither select nor fire onRowClick`.)
5. Shift+click must not leave the page's text highlighted (`select-none` on the row while Shift is held, or `user-select: none` on rows). (Task 1 render test asserts the row class includes `select-none`.)

---

### Task 1: DataTable core (logic, hooks, component, test setup)

**Files:**
- Create: `apps/web/src/lib/data-table/selection.js`, `table-state.js`, `csv.js`, `index.js`
- Create: `apps/web/src/hooks/useDebouncedValue.js`, `apps/web/src/hooks/useLatestRequest.js`, `apps/web/src/hooks/useDataTable.js`
- Create: `apps/web/src/components/ui/data-table/DataTable.jsx`, `DataTableToolbar.jsx`, `BulkBar.jsx`, `FilterControl.jsx`, `index.js`
- Modify: `apps/web/src/components/ui/Pagination.jsx` (replace the fixed `id="page-size"` with `useId()`)
- Modify: `apps/web/package.json` (devDeps `jsdom`, `@testing-library/react`)
- Test: `apps/web/src/lib/data-table/__tests__/selection.test.js`, `table-state.test.js`, `csv.test.js`; `apps/web/src/components/ui/data-table/DataTable.test.jsx` (first line `// @vitest-environment jsdom`)

**Interfaces (Produces, used by every later task):**
- `selection.js`:
  - `emptySelection() → { ids: Set<string>, anchor: string|null }`
  - `clickRow(sel, { id, orderedIds, toggle, range, replace }) → sel`. Exactly one of `toggle` (⌘/Ctrl/checkbox), `range` (Shift), `replace` (plain click); `orderedIds` is the visible order.
  - `setPage(sel, pageIds, on) → sel`
  - `selectAll(sel, ids) → sel`
  - `prune(sel, presentIds) → sel`
  - `clear() → sel`
- `table-state.js` (pure, client mode):
  - `applyClient(rows, { q, filters, sort, searchFn, filterDefs, columns }) → rows`. Filters apply each def's `match(row, value)`, skipping empty values; sort uses the column's `sortValue` with `{ id, dir: "asc"|"desc" }`.
  - `pageSlice(rows, page, pageSize) → rows`
  - `isEmptyFilterValue(v) → boolean`
- `csv.js`: `toCsv(rows, columns) → string` (RFC 4180 quoting; uses `exportValue` or a string/number cell result; skips columns with `export: false`); `downloadCsv(filename, csv)`.
- `useDebouncedValue(value, ms = 300)`; `useLatestRequest() → (promiseFactory) => Promise<{ stale: boolean, value }>`.
- `useDataTable(options)`:
  - **Options:** `{ mode: "client"|"server", rows?, fetchPage?({ page, pageSize, q, filters, sort }) → Promise<{ rows, total }>, searchFn?(row, q), filters?: FilterDef[], initialFilters?, initialPageSize = 20, initialSort?, urlKey?: string, getRowId = (r) => r.id, isRowSelectable?, deps?: any[] }`
  - **Returns:** `{ rows /* visible page */, total, loading, error, reload, q, setQ, filters, setFilter(id, v), resetFilters, sort, setSort, pagination /* props for <Pagination> */, selection: { ids, count, isSelected(id), click(row, event, orderedIds), togglePage(on), selectAllMatching(), allMatchingAvailable, clear, selectedRows }, filterDefs, getRowId, isRowSelectable, mode }`
  - **Behaviour:** with `urlKey`, `q`, filters and page are mirrored to search params prefixed by `urlKey` (e.g. `inv.status`). In server mode, `q` is debounced 300 ms before `fetchPage`, `useLatestRequest` drops stale responses, and changing q, filters or sort resets page to 1 and clears the selection.
- `FilterDef = { id, label, type: "select"|"multiselect"|"toggle"|"date", options?: [{ value, label }], placeholder?, match?(row, value) }` (`match` is required in client mode).
- `<DataTable>`:
  - **Props:** `table` (from `useDataTable`), `columns: Column[]`, `bulkActions?: BulkAction[]`, `onRowClick?(row, event)`, `rowClassName?(row)`, `renderExpanded?(row) → node|null` (adds a chevron column; one row open at a time), `footer?: node` (a `<tr>` in `<tfoot>`), `toolbarRight?: node`, `searchable = true`, `searchPlaceholder`, `itemLabel = "rows"`, `exportable = true`, `exportFileName = "export.csv"`, `emptyText = "Nothing to show."`, `notice?: node`, `selectable = true`, `dense = false`.
  - `Column = { id, header, cell(row) → node, sortValue?(row), exportValue?(row), export?: boolean, align?: "left"|"right"|"center", className?, headerClassName? }`
  - `BulkAction = { id, label, icon?, tone?: "default"|"danger", confirmLabel? /* uses ConfirmButton */, run(selectedRows) → Promise<{ ok, failed }|void>, disabled?(selectedRows) → boolean }`

- [ ] **Step 1:** Add `jsdom` and `@testing-library/react` as web devDependencies (`pnpm --filter @my-app/web add -D jsdom @testing-library/react`); confirm `pnpm --filter @my-app/web test` still passes.
- [ ] **Step 2: Write the failing logic tests** (`selection.test.js`, `table-state.test.js`, `csv.test.js`). They include:
  - `toggle adds then removes an id and moves the anchor`
  - `replace selects only the clicked row`
  - `shift-click selects the inclusive range from the anchor in visible order` (orderedIds `[a,b,c,d]`, anchor `b`, click `d` → `{b,c,d}`)
  - `shift-click with an off-page anchor toggles only the clicked row`
  - `setPage on selects every page id; off removes only page ids`
  - `selection prunes ids no longer present`
  - `applyClient searches, filters (skipping empty values) and sorts asc/desc with sortValue`
  - `pageSlice returns the right window and an empty array past the end`
  - `toCsv quotes commas, quotes and newlines and uses exportValue`
- [ ] **Step 3:** Run `pnpm --filter @my-app/web test -- data-table`. Expected: FAIL (modules missing).
- [ ] **Step 4:** Implement `selection.js`, `table-state.js`, `csv.js`, `index.js`.
- [ ] **Step 5:** Run the same command. Expected: PASS.
- [ ] **Step 6: Write the failing render tests** in `DataTable.test.jsx`:
  - `renders headers and cells from column defs and paginates client rows (25 rows, page size 20 → 20 rows, "1–20 of 25")`
  - `cmd-click toggles, shift-click extends, header checkbox selects the page`
  - `inner controls neither select nor fire onRowClick`
  - `bulk bar shows the count and runs an action with the selected rows; a ConfirmButton action needs two clicks`
  - `a failing bulk result toasts the failures`: wrap in the real `ToastProvider` from `components/ui/Toast.jsx`, or mock `useToast`.
  - `server mode ignores a slower older response`
  - `changing a filter resets page to 1`
  - `rows carry select-none`
- [ ] **Step 7:** Implement the hooks and components to pass. Style exactly as Global Constraints. The search input sits left in the toolbar with filters beside it and `toolbarRight` at the right. The bulk bar replaces the toolbar row while the selection is non-empty: navy background, "N selected", action buttons, Clear. `<Pagination>` renders below the table only when `total > pageSize`'s smallest option. Show the loading and error states (`lib/requests.js` `errorText`) inside the table body.
- [ ] **Step 8:** Run `pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`. Expected: all pass, build succeeds.
- [ ] **Step 9:** Commit `feat(web): shared DataTable with selection, bulk actions, filters and pagination`.

### Task 2: List APIs page on the server

**Files:**
- Modify: `packages/shared/src/schemas/billing.schema.js` (`invoiceListQuerySchema`), `packages/shared/src/schemas/lab.schema.js` (`labOrderListQuerySchema`), the shipment list query schema (find it in `packages/shared/src/schemas/`, or its inline definition in `apps/api/src/routes/shipping.routes.js`), the admin payments query (`apps/api/src/routes/payment.routes.js:36`)
- Modify: `apps/api/src/services/billing/invoice-queries.js` (list at ~`:19–83`), `apps/api/src/services/lab/lab-orders.service.js` (`listLabOrders` ~`:138–186`), `apps/api/src/services/shipping/shipments.service.js` (~`:180`), the admin payments handler
- Test: the existing tests beside each service/route (`*.test.js` next to the file, or `apps/api/src/routes/__tests__/`)

**Interfaces (Produces):**
- **Query params:** `limit` = `z.coerce.number().int().min(1).max(200).optional()` and `offset` = `z.coerce.number().int().min(0).optional()`, added to all four.
- `/admin/invoices` adds `q: z.string().trim().min(1).max(100).optional()`.
- `/lab/shipments` adds the same `q`.
- **Responses when `limit` is sent** (`offset` defaults to 0): `/admin/invoices` → `{ invoices, total }`; `/lab/orders` → `{ orders, total }`; `/admin/payments` → `{ payments, total }`; `/lab/shipments` → `{ shipments, total }`. `total` counts every match ignoring `limit`/`offset`. The order is the same as today. Without `limit`, every response is byte-for-byte as today.
- **Invoice `q`:** if `/^\d+$/`, the invoice number starts with q (cast to text); else ILIKE `%q%` on the client's practice/account name and doctor name columns. Read the schema and use only plaintext columns.
- **Shipment `q`:** tracking number ILIKE or order number prefix.

- [ ] **Step 1: Write the failing tests.** For each endpoint/service:
  - `limit/offset page the list and total counts all matches`
  - `without limit the response is unchanged (truncated flag kept)`
  - for invoices: `q digits matches invoice number prefix` and `q text matches practice name case-insensitively`
  - for shipments: `q matches tracking number`
  - `limit over 200 is rejected (400)`
  Follow the existing test style in those files (DB-backed or mocked, whichever the neighbouring tests use).
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- invoice-queries lab-orders shipments payment`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use one `where` builder for both the page query and the `count(*)` query, so they cannot disagree. Admin payments already filters in memory: apply `offset` before the slice and return its existing `total`.
- [ ] **Step 4:** Run the full API suite: `pnpm --filter @my-app/api test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): optional limit/offset/total on invoice, order, payment and shipment lists; invoice and shipment search`.

### Task 3: Production board table view + bulk move

**Files:**
- Modify: `apps/web/src/lib/lab-board.js` (add `commonMoves`, `moveOrders`), `apps/web/src/pages/lab/LabBoardPage.jsx`
- Create: `apps/web/src/components/lab/BoardTableView.jsx`, `apps/web/src/components/lab/BoardCard.jsx` (move `Card` out of the page), `apps/web/src/components/lab/board-columns.jsx` (the shared `Column[]` for a lab order row), `apps/web/src/components/ui/SegmentedControl.jsx`
- Test: `apps/web/src/lib/__tests__/lab-board.test.js` (extend), `apps/web/src/components/lab/BoardTableView.test.jsx` (jsdom)

**Interfaces:**
- **Consumes:** `useDataTable`, `DataTable`, `quickMoves(card)` and `groupByStatus(cards)` (existing in `lib/lab-board.js`).
- **Produces:**
  - `commonMoves(cards) → [{ to, label }]`: the moves offered by `quickMoves` for every card, in the first card's order.
  - `moveOrders(cards, to, post = (id, body) => api.post(...)) → Promise<{ ok, failed: [{ id, message }] }>`: sequential, uses each card's `version`, and `message` comes from `errorText(err)` prefixed with `#orderNumber`.
  - `SegmentedControl({ value, onChange, options: [{ value, label, icon? }] })`.

- [ ] **Step 1: Write the failing tests:**
  - `commonMoves returns only moves every card allows`
  - `commonMoves of an empty list is empty`
  - `moveOrders keeps going after a stale failure` (the second of three posts rejects with a 409 STALE → `ok: 2`, one failure naming its order number)
  - `moveOrders sends each card's own expectedVersion`
  - render test `sections start collapsed; clicking a header expands it and shows its rows with move buttons`
  - render test `selecting two rows offers "Move to <label>" for their common move`
- [ ] **Step 2:** Run `pnpm --filter @my-app/web test -- lab-board BoardTableView`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - **The page:** keep the page's loading, filter bar and refresh. Add the Board/Table `SegmentedControl` beside Refresh, defaulting to `"table"` and persisted with try/catch.
  - **Table view:** one `<section>` per `LAB_BOARD_COLUMNS` status, collapsed on every load. The header button shows a chevron, `LAB_STATUS_LABELS[status]`, the count, and "· N overdue" in red when N > 0. The section body is a client-mode DataTable (page size 20, `searchable={false}`).
  - **Columns:** Order # (link to `labOrderPath`), Practice, Device, Due (red and with the alert icon when overdue), Assignee initials, Flags (rush, remake and label badges, the same as the card), and Actions (the card's quick-move buttons).
  - **Bulk actions:** `commonMoves(selectedRows)` mapped to `{ label: "Move to …", run: rows => moveOrders(rows, to) }`, then `load()`.
  - **Kanban:** render the first 25 cards per column plus a "Show 25 more" button.
  - **Shared card logic:** `BoardCard` and the table row use the same badge and due helpers. Don't duplicate them.
- [ ] **Step 4:** Run `pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(lab): production board table view with collapsible status sections and bulk moves`.

### Task 4: Admin lists that page on the server

**Files:** Modify `apps/web/src/pages/app/AdminInvoicesPage.jsx`, `AdminOrdersPage.jsx`, `AdminPaymentsPage.jsx` (+ `components/admin/PaymentRow.jsx` → becomes the `renderExpanded` content and cells), `apps/web/src/pages/lab/ShipmentsPage.jsx`. Test: extend or add a jsdom test per page only where the page has logic beyond columns (Invoices URL sync).

**Interfaces:** Consumes Task 1 (`useDataTable` server mode) and Task 2 (the `limit`/`offset`/`q`/`total` contract).

- [ ] **Step 1:** Write the failing test `AdminInvoicesPage keeps status, needsPrice, clientUserId and q in the URL and sends them with limit/offset` (jsdom; mock `config/api.js`).
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Convert each page to `useDataTable({ mode: "server", fetchPage })`.
  - Keep each page's existing filters as `FilterDef`s:
    - Invoices: status select, needs-price toggle, client (from the AR link, `urlKey: "inv"`).
    - Orders: status, source, department, assignee, rush toggle, due-before date. All are server params that already exist.
    - Payments: none beyond search.
    - Shipments: status, carrier, from/to dates.
  - Keep each page's columns, links and per-row actions.
  - **Bulk actions:**
    - Invoices: export only.
    - Orders: "Move to …" through `commonMoves` and `moveOrders` from Task 3.
    - Shipments: "Mark shipped" and "Refresh tracking", each looping the existing per-row endpoint and returning `{ ok, failed }`.
    - Payments: export only.
  - **Remove the caps:** the Invoices "outstanding" total becomes "outstanding on this page" (call: a page-local sum, labelled so). Remove the "newest 1,000" and "500 cap" notices.
- [ ] **Step 4:** Run `pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(admin): invoices, orders, payments and shipments use the shared table with server paging`.

### Task 5: Admin lists that page in the browser

**Files:** Modify `apps/web/src/pages/app/AdminUsersPage.jsx`, `AdminAutoPayPage.jsx`, `AdminRxCasesPage.jsx`, `AdminReceivablesPage.jsx`, `AdminJobsPage.jsx` (run history table only).

**Interfaces:** Consumes Task 1 (`useDataTable` client mode).

- [ ] **Step 1:** Write the failing test `AdminUsersPage bulk "Send invitations" posts the selected user ids to /admin/users/bulk-email` (jsdom, mocked api). It replaces the page's hand-built selection.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Convert each page, keeping its data loading, columns, per-row actions and stat tiles:
  - **Users:** search `searchFn` (email, name, account, Seazona #, role); filters role (select), Seazona-only (toggle), passwordless-only (toggle); bulk Send invitations and Send password resets (`ConfirmButton` labels as today), each through `POST /admin/users/bulk-email`.
  - **AutoPay:** search as today; add a status filter (enabled/paused/disabled from the row's existing fields).
  - **Rx cases:** the status pills become a multiselect filter (counts stay in the stat tiles); row click navigates as today.
  - **Receivables:** the past-due toggle becomes a filter; the totals row goes in `footer`; bulk "Email statements" loops the per-row endpoint.
  - **Jobs runs:** a job filter and a status filter.
  - **All pages:** export on, with `exportValue` where a cell renders markup. Delete the local `Th` components.
- [ ] **Step 4:** Run `pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(admin): users, autopay, rx cases, receivables and job runs use the shared table`.

### Task 6: Doctor pages

**Files:** Modify `apps/web/src/pages/doctor/MyCasesPage.jsx`, `InvoicesPage.jsx`, `PaymentsPage.jsx`.

**Interfaces:** Consumes Task 1 (client mode). `isRowSelectable` = the invoice is payable (`isPayable` from `lib/invoices.js`).

- [ ] **Step 1:** Write the failing test `doctor InvoicesPage: only payable invoices are selectable and "Pay selected" opens the payment modal with them` (jsdom, mocked api).
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Convert the pages:
  - **Invoices:** the hand-built Set selection and `usePagination` give way to `useDataTable`; "Pay selected" becomes a bulk action that opens the existing modal with the selected invoices.
  - **Filters:** status (Open, Past due, Paid via `statusOf`) on Invoices; status on MyCases.
  - **Search:** case #, device and patient for MyCases (searched in the browser; the patient comes back decrypted to its owner); invoice # for Invoices; reference for Payments.
  - **Styling:** apply the shared look (the gray family goes).
  - **Pagination:** if `usePagination` has no remaining user, delete it and make `CatalogSection.jsx` use `pageSlice` and `Pagination`. Otherwise keep it.
- [ ] **Step 4:** Run `pnpm --filter @my-app/web test && pnpm --filter @my-app/web build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(doctor): cases, invoices and payments use the shared table`.

## Not converted (stay hand-built, on purpose)

These are editors or embedded grids, not lists:
- `DraftLinesEditor`, `InvoiceView` line items, `rx/fields.jsx` MatrixField
- `LabOrderDetailPage` lines
- `AdminDepartmentsPage` inline grid
- `AdminClientPricingPage` (tens of rows plus an add form)
- `AdminCatalogPage` variant editors
- `AdminRxMappingPage` preview groups

They may adopt the shared cell and header classes later.
