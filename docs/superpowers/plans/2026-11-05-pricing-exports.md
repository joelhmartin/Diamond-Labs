# Pricing and Account Extras (piece 10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff get named price lists that they assign to clients one at a time or in bulk, copy prices between clients with a preview, see clients grouped by identical pricing, export invoices through a generic format registry (CSV now), give an account-level credit, and run all monthly statements in one idempotent action.

**Architecture:**
- **Generic module `exports`** (`apps/api/src/modules/exports/`, `apps/web/src/modules/exports/`, `packages/shared/src/exports/`). Sources and formats are registered, with no lab words. The invoice source and the page are glue.
- **Price lists extend the existing single pricing path.** `lib/pricing.js` gets a pure `resolveClientPrices`, and `services/pricing.service.js` gets `loadEffectiveClientPrices`. `loadClientPrices` becomes a wrapper, so the shop, the catalog and lab invoicing all resolve prices the same way.
- **Billing glue:** `statement_sends` makes the monthly run idempotent, and the account credit reuses `planManualPayment`.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle 0.36 / drizzle-kit (Postgres 15), Zod (`@my-app/shared`), Vitest + `node:assert/strict` with `apps/api/src/test/fake-tx.js`, React 18 + Vite + Tailwind, lucide-react, axios (`config/api.js`), the shared DataTable (`components/ui/data-table`, `hooks/useDataTable.js`).

**Spec:** `docs/superpowers/specs/2026-11-05-pricing-exports-design.md` (binding roadmap: `docs/superpowers/specs/2026-11-05-lab-parity-roadmap.md`).

## Global Constraints

- Generic module code (`modules/exports`, `packages/shared/src/exports`, `apps/web/src/modules/exports`) contains no lab, doctor, dental, patient or invoice words. The invoice source lives in `apps/api/src/exports/`.
- Every list is `DataTable` + `useDataTable`. Bulk actions are `bulkActions` config. Selection, paging and filters are never per-page code.
- Never `alert()`, `confirm()` or `prompt()`. Destructive or bulk commits use `ConfirmButton` (arm, then commit). Messages use `useToast()`.
- Money is integer cents end to end. Percent adjustments round half away from zero to the cent (`lib/money.js` helpers).
- No PHI: exports have no patient column, audit metadata is ids, counts and cents only, and statement and credit emails carry no free text.
- No Seazona calls anywhere.
- Admin-only routes: `[authenticate, requireAdmin]` (`ADMIN` from `routes/admin-invoice.routes.js:16`). The `lab` role sees no money.
- Files under 1,000 lines, functions under 150 (components 300).
- Migrations: this piece owns two (Task 4 price lists, Task 10 statement sends). On rebase onto `feat/own-the-lab`, drop this piece's generated SQL and journal entries and re-run `pnpm --filter @my-app/api db:generate`.
- Tests: `pnpm --filter @my-app/api test`, `pnpm --filter @my-app/web test`, `pnpm --filter @my-app/shared test`. Web tasks also pass `pnpm --filter @my-app/web build`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only with `git push origin <branch>`.

## Review Focus

1. **A list price must never silently change an already-issued invoice or a quoted cart.** Issued invoices are immutable already. Checkout's `assertQuotedTotal` must refuse with PRICE_CHANGED when a list edit lands between the quote and the charge. (Task 4 test `a list edit between quote and checkout is PRICE_CHANGED, not a silent charge`.)
2. **Copy applied after the source or target changed since preview.** It must 409, not apply a stale plan. (Task 7 test `apply with a stale previewHash is refused`.)
3. **Statement run double-click or retry.** No client gets two notices for the same month from the bulk run. (Task 10 test `a second run for the same month sends nothing new`.)
4. **Archived list still assigned.** Its prices stop applying (it resolves as if unassigned), and the client page shows it struck through. (Task 4 test `an archived list is skipped in resolution`.)
5. **Export over 20k legacy invoices.** It streams in pages without loading everything, and a value that starts with `=` opens as text. (Task 1 test `csv neutralizes formula-leading text but not negative numbers`; Task 2 test `fetchPage pages with limit/offset and a stable order`.)

---

### Task 1: `exports` generic module scaffold + shared CSV encoder

**Files:**
- Create: `packages/shared/src/exports/csv.js`, `packages/shared/src/exports/csv.test.js`. Export from `packages/shared/src/index.js`.
- Modify: `apps/web/src/lib/data-table/csv.js` (use the shared `csvField`; keep `toCsv` and `downloadCsv` signatures).
- Create: `apps/api/src/modules/exports/registry.js`, `formats/csv.js`, `export.service.js`, `routes.js`, `README.md`, `index.js`.
- Test: `apps/api/src/modules/exports/registry.test.js`, `export.service.test.js`, `routes.test.js`.

**Interfaces:**
- Produces (shared):
  - `csvField(value) → string`: null → `""`; numbers and booleans as String; strings formula-neutralized (leading `= + - @ \t \r` gets a `'` prefix unless it is a plain number) and RFC 4180 quoted.
  - `csvRow(values[]) → string` (comma-joined, no line ending); `CSV_EOL = "\r\n"`.
- Produces (api):
  - `createExportRegistry() → { defineSource(def), defineFormat(def), source(key), format(key), list() }`. Defining a duplicate key throws. `list()` returns `[{ key, label, params, fields, formats: [formatKey] }]` using each format's `supports(source)`.
  - A source def is `{ key, label, params, paramsSchema, fields: [{ key, label, type }], fetchPage(db, params, { limit, offset }) → { rows, total } }`.
  - A format def is `{ key, label, extension, contentType, supports(source), header?(source), serializeRow(row, source), footer?(source) }`.
  - `csvFormat`: header = field labels; row = `csvRow(fields.map(f => cell(row[f.key], f.type)))`. Cents render as `"123.45"`; dates as `YYYY-MM-DD`.
  - `runExport({ registry, db, sourceKey, formatKey, params, pageSize = 1000 }) → { filename, contentType, stream: AsyncIterable<string>, countPromise }`.
  - `previewExport({ registry, db, sourceKey, params, limit, offset }) → { rows, total, fields }`.
  - `createExportsRoutes({ registry, preHandler, audit, pathPrefix = "/exports" })` → a Fastify plugin with the three routes in the spec. `audit({ actorId, sourceKey, formatKey, params, rowCount })` is called after the stream ends.

- [ ] **Step 1: Write failing tests.**
  - shared `csv.test.js`: `csv neutralizes formula-leading text but not negative numbers` (`csvField("=SUM(A1)") === "'=SUM(A1)"`, `csvField("-12.50") === "-12.50"`); `quotes comma, quote and newline` (`csvField('a,"b"\n') === '"a,""b""\n"'`).
  - `registry.test.js`: `duplicate source key throws`; `list() shows only formats whose supports() accepts the source`.
  - `export.service.test.js`: `runExport pages until rows run out and emits header once` (a fake source with 2,500 rows and pageSize 1000 is called 3 times, giving 2,501 lines); `unknown format or a format that does not support the source is refused with EXPORT_FORMAT_UNSUPPORTED`; `params failing paramsSchema throw EXPORT_PARAMS_INVALID`.
  - `routes.test.js` (Fastify inject, fake registry): `download sets Content-Disposition from source key and dates and calls audit with rowCount`; `preHandler runs before every route`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/shared test -- exports && pnpm --filter @my-app/api test -- modules/exports`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the files above. Stream with `reply.type(contentType).send(Readable.from(stream))`, after writing a UTF-8 BOM for csv. The web `csv.js` keeps its tests green, now built on `csvField`.
- [ ] **Step 4:** Write `README.md` sections: Purpose, Public interface (registry, source and format contracts), Configuration (none), Data model (none; stateless), and "Adding a format" (worked prose for a QuickBooks IIF format: map `fields` keys to IIF `!TRNS/!SPL` rows in `serializeRow`, `supports: s => s.key === "invoices"`). Leave "Wiring into another app" as a heading for Task 11.
- [ ] **Step 5:** Run the api, web and shared tests. Expected: PASS.
- [ ] **Step 6:** Commit `feat(exports): generic export registry, CSV format and shared encoder`.

### Task 2: Invoice export source (glue) + route mounting

**Files:**
- Create: `apps/api/src/exports/invoices.export.js`, `apps/api/src/exports/index.js`.
- Create: `packages/shared/src/schemas/exports.schema.js` (`invoiceExportParamsSchema`).
- Modify: `apps/api/src/index.js` (one line: register `createExportsRoutes({ registry: appExports, preHandler: ADMIN, audit })` with prefix `/api/v1/admin`).
- Test: `apps/api/src/exports/invoices.export.test.js`.

**Interfaces:**
- Consumes: Task 1 registry, `csvFormat`; `withBalances` (`services/billing/ledger.service.js`); the joins in `services/billing/invoice-queries.js` `listInvoices`.
- Produces:
  - `appExports` (a registry with `csv` and `invoices`).
  - `invoiceExportParamsSchema = { dateField: "ordered"|"due"|"issued", from: ISO date, to: ISO date (≥ from, ≤ 366 days apart), statuses?: ("open"|"paid"|"void"|"draft")[] }`.
  - Fields, in order: `invoiceNumber`, `kind`, `status`, `accountNumber`, `practice`, `clientName`, `orderNumber`, `orderedOn` (lab-local date of `lab_orders.received_at`), `issuedOn`, `dueOn`, `subtotal`, `tax`, `shipping`, `total`, `paid`, `balance`. There is no patient field (R5).
  - Status mapping: `open` = issued with balance > 0; `paid` = issued with balance ≤ 0; `void`; `draft`.
  - Order: `invoice_number asc`. Date filters use the lab timezone (`LAB_TIMEZONE`). For `ordered`, legacy invoices without a lab order fall back to `issued_at`.
- [ ] **Step 1: Write failing tests** with `fakeTx`:
  - `fields never include a patient column` (assert no field key matches `/patient/i`).
  - `fetchPage pages with limit/offset and a stable order` (the SQL source contains `order by` on invoice number; limit and offset are passed through).
  - `status open/paid is derived from the ledger balance, not stored`.
  - `dateField ordered falls back to issued_at for an invoice without a lab order`.
  - `schema refuses a range over 366 days and to < from`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- exports/invoices`. Expected: FAIL.
- [ ] **Step 3:** Implement. The audit callback writes `auditService.logSafe({ action: "export.downloaded", targetType: "export", targetId: sourceKey, metadata: { format, params, rowCount } })`.
- [ ] **Step 4:** Run again. Expected: PASS. Run the full api suite.
- [ ] **Step 5:** Commit `feat(exports): invoice export source, admin-only and audited`.

### Task 3: Export screen (generic web module + admin page)

**Files:**
- Create: `apps/web/src/modules/exports/ExportScreen.jsx`, `ParamsForm.jsx`, `index.js`, `README.md` (short; it points to the api README).
- Create: `apps/web/src/pages/app/AdminExportsPage.jsx`.
- Modify: `apps/web/src/config/routes.js` (`ADMIN_EXPORTS: "/admin/exports"`), the router file that maps admin routes, `apps/web/src/components/layout/Sidebar.jsx` (adminItems: `{ label: "Exports", to: ROUTES.ADMIN_EXPORTS, icon: Download }` after Payments).
- Test: `apps/web/src/modules/exports/ExportScreen.test.jsx` (jsdom).

**Interfaces:**
- Consumes: `GET /admin/exports`, `/admin/exports/:source/preview`, `/admin/exports/:source/download.:format`.
- Produces: `<ExportScreen basePath="/admin/exports" defaultSource?="invoices" />`. It renders a source picker, `ParamsForm` (date → `<input type="date">`, select/multiselect → the existing `FilterControl` styles), a DataTable in server mode whose `fetchPage` calls preview and whose columns come from `fields` (cents formatted), a format picker and a Download button.
- Download uses an axios blob, `responseType: "blob"`, then `downloadCsv`-style anchor saving. A generic `saveBlob(filename, blob)` goes in `lib/download.js`, and `downloadCsv` uses it.
- [ ] **Step 1: Write failing render tests:** `renders params from the source descriptor and previews on change`; `Download is disabled until required params are filled`; `format picker lists only the formats the source supports`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/web test -- modules/exports`. Expected: FAIL.
- [ ] **Step 3:** Implement. The page is a wrapper with the title "Export invoices" and the copy "By ordered, due or issued date and status. QuickBooks and Xero formats come later."
- [ ] **Step 4:** Run the web test and build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): export screen module and Admin › Exports`.

### Task 4: Price lists schema + single resolution path

**Files:**
- Create: `apps/api/src/db/schema/price-lists.js` (`priceLists`, `priceListItems`, `clientPriceLists`). Export from `schema/index.js`.
- Create: the migration via `pnpm --filter @my-app/api db:generate` (the next number after 0033).
- Modify: `apps/api/src/lib/pricing.js` (add `resolveClientPrices`; `unitPriceFor` accepts a number or `{ cents, source }`), `apps/api/src/services/pricing.service.js` (add `loadEffectiveClientPrices`; `loadClientPrices` wraps it), `packages/shared/src/billing/billing.js` (`PRICE_SOURCES` + `"list"`), and the web price-source label map (grep `PRICE_SOURCES`/`priceSource` labels in `apps/web/src/lib/invoices.js`; label "Price list").
- Modify: `apps/api/src/db/schema/client-prices.js` comment (`copied` source).
- Test: `apps/api/src/lib/pricing.test.js`, `apps/api/src/services/pricing.service.test.js` (create if absent).

**Interfaces:**
- Produces:
  - `resolveClientPrices({ overrides: Map<string, number>, lists: Array<{ listId, name, items: Map<string, number> }> }) → Map<variantId, { cents, source: "client"|"list", listId: string|null, listName: string|null }>`. The caller passes `lists` already in precedence order with archived lists removed.
  - `loadEffectiveClientPrices(clientUserId, variantIds|null, database = db) → Promise<Map<…>>`. `null` variantIds means every variant (pricing page and same-pricing). Three selects: overrides, assignments joined to non-archived lists ordered by `position`, and items for those lists.
  - `loadClientPrices(clientUserId, variantIds, database)`: unchanged signature, returns `Map<variantId, { cents, source }>`. `unitPriceFor` reads `.cents` and `.source` (or a bare number for older tests).
  - `unitPriceFor(variant, effective) → { cents, source: "client"|"list"|"base" } | null`.
- [ ] **Step 1: Write failing tests:**
  - `client override beats every list`.
  - `first assigned list with an item wins; a later list fills variants the first lacks`.
  - `an archived list is skipped in resolution` (service test via fakeTx: the archived list row filtered by `isNull(archivedAt)` in the query source).
  - `priceLabLines marks a list-priced line priceSource "list"`.
  - `a remake stays $0 even when list-priced` (`asRemakeLines` over a list-priced line).
  - `a list edit between quote and checkout is PRICE_CHANGED, not a silent charge`: `assertQuotedTotal` with a quote built before the list price changed throws `PRICE_CHANGED`.
  - `loadClientPrices keeps its callers' contract` (catalog-variants still prices with a Map from the wrapper).
- [ ] **Step 2:** Run `pnpm --filter @my-app/api test -- pricing`. Expected: FAIL.
- [ ] **Step 3:** Implement the schema per the spec's Data model (unique `lower(name)` via `uniqueIndex(...).on(sql\`lower(${t.name})\`)`), generate the migration, and implement resolution.
- [ ] **Step 4:** Run the full api suite (every existing pricing, catalog and checkout test must stay green). Expected: PASS.
- [ ] **Step 5:** Commit `feat(pricing): named price lists in the one price-resolution path`.

### Task 5: Price list service + admin routes (CRUD, items, assignment, bulk assign)

**Files:**
- Create: `apps/api/src/services/price-lists.service.js`, `apps/api/src/routes/admin-price-lists.routes.js`, `packages/shared/src/schemas/price-lists.schema.js`.
- Modify: `apps/api/src/index.js` (register routes), `apps/api/src/routes/admin-catalog.routes.js` (`GET /admin/clients/:userId/prices` adds `effective` from `loadEffectiveClientPrices` with `listName`).
- Test: `apps/api/src/services/price-lists.service.test.js`, `apps/api/src/routes/__tests__/admin-price-lists.test.js`.

**Interfaces:**
- Consumes: Task 4 schema and `loadEffectiveClientPrices`.
- Produces (service):
  - `listPriceLists({ includeArchived })` → `[{ id, name, description, archivedAt, itemCount, clientCount, updatedAt }]`.
  - `createPriceList({ name, description, byUserId })`; `updatePriceList(id, patch, byUserId)` (a name clash raises `PriceListError("NAME_TAKEN")`, mapped to 409).
  - `listItems(listId)` → variants with `basePriceCents`, `familyName`, `listPriceCents|null`.
  - `setItem`, `removeItem`, `setItems(listId, items[], byUserId)` (≤ 500, one transaction).
  - `clientLists(clientUserId)`; `setClientLists(clientUserId, listIds[], byUserId)` (replaces the assignment and positions follow array order).
  - `assignListToClients({ listId, clientUserIds, mode: "add"|"replace", byUserId }) → { ok, failed: [{ id, message }] }`. `add` appends at the lowest precedence; non-doctor users fail with "Not a client".
- Every write is audited: `price_list.created|updated|item_set|item_removed|items_set|assigned` (ids, counts and cents).
- Routes as listed in the spec, all `ADMIN`.
- [ ] **Step 1: Write failing tests:** `bulk assign add appends at lowest precedence and skips a duplicate`; `bulk assign replace leaves only that list`; `a non-doctor target is reported in failed, others apply`; `setItems refuses more than 500 and negative cents`; `route is 403 for the lab role`; `duplicate name is 409 NAME_TAKEN`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full api suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(pricing): price list admin API with bulk assignment`.

### Task 6: Price list UI (lists page, list editor, client pricing on DataTable, Users bulk assign)

**Files:**
- Create: `apps/web/src/pages/app/AdminPriceListsPage.jsx` (tabs: Lists | Same pricing; the Same pricing tab is filled in Task 8), `apps/web/src/pages/app/AdminPriceListEditorPage.jsx`, `apps/web/src/components/admin/AssignPriceListModal.jsx`, `apps/web/src/lib/price-lists.js` (pure: `adjustByPercent(cents, pct)`, `sourceChip(effective)`).
- Modify: `apps/web/src/pages/app/AdminClientPricingPage.jsx` (rewrite onto DataTable; add the assigned-lists strip and source chips; keep `priceDelta` and `clientLabel` exports), `apps/web/src/pages/app/AdminUsersPage.jsx` (bulk action "Assign price list…"), `apps/web/src/config/routes.js` (`ADMIN_PRICE_LISTS: "/admin/price-lists"`, `ADMIN_PRICE_LIST_DETAIL: "/admin/price-lists/:id"`), the router, `Sidebar.jsx` (`{ label: "Price lists", to: ROUTES.ADMIN_PRICE_LISTS, icon: Tags }` after Products).
- Test: `apps/web/src/lib/__tests__/price-lists.test.js`, `AdminClientPricingPage.test.jsx` (extend), `AdminPriceListEditorPage.test.jsx`.

**Interfaces:**
- Consumes: Task 5 routes.
- Produces: `<AssignPriceListModal clientUserIds={[]} onDone(result) />`, reused by Task 7's Users bulk menu.
- Editor bulk actions: "Set to base price", "Adjust by %…" (an inline number input in the bulk bar, then a ConfirmButton that names the count) and "Remove from list". Each sends one `items/bulk` (or per-row DELETE) call and reports `{ ok, failed }`.
- [ ] **Step 1: Write failing tests:** `adjustByPercent rounds half away from zero to the cent` (`adjustByPercent(1005, -10) === 905`, `adjustByPercent(1000, 12.5) === 1125`); `client pricing shows the List chip with the list name for a list-priced variant`; `an inferred override equal to the list price shows "Same as list"`; `editor "Set to base price" sends one bulk call with the selected variants`; `Users bulk Assign price list posts clientUserIds and toasts ok/failed`.
- [ ] **Step 2:** Run `pnpm --filter @my-app/web test`. Expected: FAIL.
- [ ] **Step 3:** Implement. There is no raw `<table>` left in these pages.
- [ ] **Step 4:** Run the web tests and build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): price lists, list editor, list-aware client pricing`.

### Task 7: Copy prices client→client(s) with preview diff

**Files:**
- Create: `apps/api/src/lib/price-copy.js` (pure), `apps/api/src/services/price-copy.service.js`, `apps/web/src/components/admin/CopyPricesModal.jsx`.
- Modify: `apps/api/src/routes/admin-price-lists.routes.js` (two routes), `packages/shared/src/schemas/price-lists.schema.js` (`priceCopySchema`), `AdminClientPricingPage.jsx` ("Copy prices from…" button), `AdminUsersPage.jsx` (bulk "Copy prices from…").
- Test: `apps/api/src/lib/price-copy.test.js`, `apps/api/src/services/price-copy.service.test.js`, `apps/web/src/components/admin/CopyPricesModal.test.jsx`.

**Interfaces:**
- Produces:
  - `planCopy({ source: { overrides: Map, listIds: string[] }, target: { overrides: Map, listIds: string[] }, mode }) → { overrides: { upsert: [{ variantId, cents }], remove: [variantId] }, listIds: string[] }`.
  - `diffEffective(beforeMap, afterMap) → [{ variantId, beforeCents, beforeSource, afterCents, afterSource }]`. After is computed by `resolveClientPrices` over the planned state.
  - `previewHash(plans) → string`: sha256 of the canonical JSON of every target's plan.
  - Service: `previewCopy({ fromClientUserId, toClientUserIds, mode }) → { targets: [{ clientUserId, changes, listsBefore, listsAfter }], previewHash }`. `applyCopy({ ...same, previewHash, byUserId }) → { ok, failed }` recomputes the plans inside one transaction, throws `PriceCopyError("STALE")` (409) on a hash mismatch, and writes copied overrides `source: "copied"`, reviewed, with no note text.
  - `from` in `to` is refused (INVALID); at most 200 targets.
  - Audit `client_price.copied` per target (from, to, change count).
- [ ] **Step 1: Write failing tests:** `replace makes the target's effective prices identical to the source's`; `merge keeps target-only overrides and appends missing lists`; `diff lists only variants whose effective cents or source change`; `apply with a stale previewHash is refused`; `copying a client onto itself is INVALID`; `modal applies only after ConfirmButton's second click`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The modal's preview is a DataTable with one row per target (name, changes count) and `renderExpanded` for the per-variant before/after.
- [ ] **Step 4:** Run the api and web suites and the web build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(pricing): copy prices between clients with preview`.

### Task 8: Same-pricing view (+ seam for piece 9's report)

**Files:**
- Create: `apps/api/src/lib/same-pricing.js` (pure), `apps/api/src/services/same-pricing.service.js`.
- Modify: `apps/api/src/routes/admin-price-lists.routes.js` (`GET /admin/prices/same-pricing`), `AdminPriceListsPage.jsx` (Same pricing tab).
- Test: `apps/api/src/lib/same-pricing.test.js`, `apps/api/src/services/same-pricing.service.test.js`.

**Interfaces:**
- Produces:
  - `pricingSignature(effective: Map) → string`: sorted `variantId:cents` pairs joined by `|`, then hashed (sha1 hex). Source is ignored: same cents means same pricing. An empty map gives the signature `"base"`.
  - `groupBySignature(clients: [{ id, effective, listNames, overrideCount }]) → [{ signature, size, clientIds, lists, overrideCount }]`, sorted by size desc.
  - `sameClientPricingGroups(database = db, { includeSingles = false }) → { groups: [{ signature, size, clients: [{ id, name, accountNumber, practice }], lists, overrideCount }] }`. It loads all overrides, assignments and items in three queries (not per client) for every approved doctor. **This is the function piece 9 wraps in `defineReport`.**
- [ ] **Step 1: Write failing tests:** `two clients on the same list with no overrides group together`; `an override equal to the list price does not split the group`; `clients with nothing beyond base share the "base" group`; `singles are excluded unless includeSingles`; `the service runs a fixed number of queries regardless of client count` (fakeTx select count).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The tab is a DataTable (size, lists, overrides, clients preview) with `renderExpanded` listing the clients (links to their pricing page). CSV export works through `exportValue`.
- [ ] **Step 4:** Run the suites and the web build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(pricing): same-pricing groups`.

### Task 9: Account-level credit (the Adjustments gap)

**Files:**
- Create: `apps/api/src/services/billing/account-credit.service.js`, `apps/web/src/components/admin/AccountCreditModal.jsx`.
- Modify: `apps/api/src/services/billing/invoice-rules.js` (add `planAccountCredit`), `apps/api/src/routes/receivables.routes.js` (`POST /admin/clients/:userId/account-credit`), `packages/shared/src/schemas/billing.schema.js` (`accountCreditSchema`), `AdminReceivablesPage.jsx` (row action "Account credit…").
- Test: `apps/api/src/services/billing/invoice-rules.test.js` (extend), `account-credit.service.test.js`.

**Interfaces:**
- Consumes: `planManualPayment`, `openInvoicesForClient`, `loadPayingClient` pattern, `underInvoiceLocks`, `sealLedgerRow`, `CREDIT_SOURCE` (all in `invoice-actions.service.js` / `invoice-rules.js`).
- Produces:
  - `planAccountCredit({ openInvoices, amountCents, allocations?, reason, todayIso }) → { allocations: [{ invoiceId, invoiceNumber, amountCents }], reason }`. It reuses `planManualPayment` with `paidOn = todayIso`; reason is required (REASON_REQUIRED); an amount over the open balance is OVERPAY.
  - `recordAccountCredit({ clientUserId, amountCents, reason, allocations, byUserId }) → { transactionId, allocations }`. One `credit:<groupId>` transactionId across all rows, `source: "credit"`, encrypted `note` = reason, inside the invoice locks. It audits `invoice.credited` per invoice with `{ amountCents, accountCredit: true }`. It sends no email.
- [ ] **Step 1: Write failing tests:** `credit spreads oldest-first across open invoices`; `credit larger than the open balance is OVERPAY`; `reason is required`; `every row shares one credit:<id> transactionId and source credit`; `the statement model shows each row as Credit` (via `buildStatementModel`).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The modal has amount, reason and an optional "choose invoices" picker (a DataTable of open invoices with amount inputs), and commits with ConfirmButton.
- [ ] **Step 4:** Run the suites and the web build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): account-level credit across open invoices`.

### Task 10: Monthly statement run (idempotent bulk send)

**Files:**
- Create: `apps/api/src/db/schema/statement-sends.js` (export from `schema/index.js`) and its generated migration.
- Create: `apps/api/src/services/billing/statement-run.service.js`, `apps/api/src/routes/statement-run.routes.js`, `apps/api/src/jobs/definitions/monthly-statements.job.js` (import it in `jobs/definitions/index.js`), `apps/web/src/components/admin/MonthlyStatementsPanel.jsx`.
- Modify: `apps/api/src/routes/receivables.routes.js` (the single send upserts a `statement_sends` row; its logic moves to `sendStatementFor(clientUserId, month, { byUserId, runId })` in the new service, and the route calls it), `apps/api/src/index.js`, `AdminReceivablesPage.jsx` (remove the "Email statements" bulk action; add the "Monthly statements" button and panel).
- Test: `apps/api/src/services/billing/statement-run.service.test.js`, `apps/api/src/jobs/definitions/monthly-statements.job.test.js`, `apps/web/src/components/admin/MonthlyStatementsPanel.test.jsx`.

**Interfaces:**
- Consumes: `statementFor`, `practiceUserIds`, `loadStatementActivity`, `sendStatementNotice`.
- Produces:
  - `planStatementRun({ candidates: [{ clientUserId, email, activityCount, closingCents, alreadySentAt }], onlyIds? }) → { send: [ids], skip: [{ id, reason: "already_sent"|"no_email"|"no_activity" }] }` (pure).
  - `previewStatementRun(month, database = db) → rows[]`. Candidates are approved doctors with ≥ 1 statement activity in the month **or** closing ≠ 0. Activity is loaded in one `loadStatementActivity` call over all candidate ids, and the model is built per client.
  - `runStatements({ month, clientUserIds?, byUserId, runId = null, dryRun = false }) → { sent, skipped, failed }`. It sends sequentially; each success inserts `statement_sends` with `onConflictDoNothing` on (client, month) **before** sending, in a status `sending` → `sent`/`failed`, so a crash cannot double-send. It audits `statement.emailed` per client with `{ month, closingCents, runId }`.
  - `sendStatementFor(clientUserId, month, { byUserId, force = true })`: the single action; `force` overwrites `sent_at`.
  - Job `monthly-statements`: handler `({ dryRun, log, runId })` runs last month (lab-local). A dry run returns the plan counts only. It is not scheduled (scheduling needs the user's yes).
  - Routes: `GET /admin/statements/run?month=` and `POST /admin/statements/run` (spec). Month must be ≤ the current lab-local month.
- `statement_sends.status` enum values: `sending | sent | failed | no_email`.
- [ ] **Step 1: Write failing tests:** `a second run for the same month sends nothing new`; `a zero-balance client with activity in the month gets a statement`; `a client with no activity and zero closing is skipped as no_activity`; `no email → skip no_email and record it`; `a send failure marks failed and the next run retries it`; `dry-run job returns counts and sends nothing`; `the panel's Send button needs two clicks and names the count`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The `statement_sends` migration is generated by `db:generate` (rebase rule in Global Constraints).
- [ ] **Step 4:** Run the suites and the web build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(billing): monthly statement run with per-client idempotency`.

### Task 11: READMEs ("wiring into another app"), runbook re-entry, docs

**Files:**
- Modify: `apps/api/src/modules/exports/README.md` (complete "Wiring into another app"), `apps/web/src/modules/exports/README.md`.
- Modify: `docs/cutover-runbook.md`: in "6. Smoke" or right before "7. Unfreeze", add **"Re-enter price lists"**.
- Modify: `CLAUDE.md` (Key File Paths: one line each for `modules/exports` and `services/price-lists.service.js`; no subsystem detail).
- Test: none (docs). Run the full api, web and shared suites and the web build one last time.

- [ ] **Step 1:** README "Wiring into another app" has 5 steps:
  1. Copy `modules/exports` and `packages/shared/src/exports`.
  2. Create `createExportRegistry()` in the app's glue and register `csvFormat`.
  3. `defineSource` per query (params, zod schema, fields, `fetchPage`).
  4. Mount `createExportsRoutes({ registry, preHandler, audit })`.
  5. Render `<ExportScreen basePath=… />`.

  Add how to add a format (the Task 1 prose, final) and the rule that sources choose which fields leave the app (no sensitive columns by default).
- [ ] **Step 2:** Write the runbook step. Before unfreeze, an admin:
  - (a) creates the 3 lists by name;
  - (b) fills each list's prices (editor bulk "Set to base", then edit, reading Labzona's PriceList screen);
  - (c) bulk-assigns clients to each list from Users (filter by practice, select, "Assign price list…");
  - (d) opens Price lists › Same pricing and compares group sizes against Labzona's Same Pricing report; a mismatch is re-checked before unfreeze;
  - (e) notes that `statement_sends` starts empty, so the first Monthly statements run after cutover covers the month after Labzona's last run.

  No client or patient names are written in the runbook.
- [ ] **Step 3:** Run all suites and the web build. Expected: PASS.
- [ ] **Step 4:** Commit `docs: exports module wiring, price-list re-entry at cutover`.
