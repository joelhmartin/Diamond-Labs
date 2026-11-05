# Piece 10: Pricing and account extras (design)

_2026-11-05 · roadmap: `2026-11-05-lab-parity-roadmap.md` (binding) · builds on
piece 1 (catalog and client pricing), piece 3 (invoicing and AR) and the shared
DataTable (`plans/2026-10-28-data-tables.md`) · slug `pricing-exports`_

## Intent

The lab prices most clients from a few named templates ("Centre 2024",
"Centre Remake/Reprint", "Master Remake/Reprint") and runs statements in bulk
once a month. It also exports invoices for its accountant. Diamond Labs has
per-client variant prices, a per-client statement email and table CSV, but
none of the rest. This piece adds:

- named price lists, assigned to clients (one at a time or in bulk);
- copying prices from one client to one or many others, with a preview diff;
- a "same pricing" view that groups clients whose effective prices match;
- a generic `exports` module (named formats over a query; CSV now) and an
  invoice export screen;
- an account-level credit (the gap in Labzona's Adjustments screen);
- a monthly "generate and email all statements" run.

## Goals and non-goals

Goals:
- **One price-resolution path.** Every price the shop, the catalog and lab
  invoicing see comes from the same loader and the same pure rule.
- Bulk actions live on the existing tables (users, receivables) as DataTable
  configuration.
- The `exports` module has no lab words and accepts new formats by
  registration alone.

Non-goals (deferred by the user 2026-11-05, or out of scope):
- QuickBooks Online, IIF, QB Transaction Pro and Xero formats. The format
  interface is defined and documented; no format other than CSV is built.
- Automatic (scheduled) statement runs. A job definition exists, but
  enabling Cloud Scheduler is a recurring commitment that needs the user's yes.
- Remake-specific list semantics (see Ruling R2).
- An account-level **charge** (a debit not tied to a lab order; see Ruling R7).

## What exists today (survey, file:line)

- `client_prices` (`apps/api/src/db/schema/client-prices.js:8`): one row per
  (client user, variant), `source` manual | imported | inferred, review stamps.
- The price is decided in one pure place: `unitPriceFor(variant, clientPriceCents)`
  (`apps/api/src/lib/pricing.js:15`): client price wins, else base.
- One loader feeds it: `loadClientPrices(clientUserId, variantIds, db)`
  (`apps/api/src/services/pricing.service.js:31`). Its callers:
  `priceLabOrderLines` (lab invoices, `services/billing/invoices.service.js:53`),
  `priceShopCart` (cart and checkout, `routes/checkout.routes.js:204`), and the
  catalog view (`routes/catalog.routes.js:25` → `lib/catalog-variants.js:67`).
  **Repointing this one loader covers every price in the app.**
- Remakes are priced at zero after resolution (`asRemakeLines`,
  `services/billing/invoice-rules.js:53`).
- Admin client pricing: `GET/PUT/DELETE /admin/clients/:userId/prices[/:variantId]`
  and `/prices/review` (`routes/admin-catalog.routes.js:75-114`); page
  `apps/web/src/pages/app/AdminClientPricingPage.jsx`, which still renders a
  raw `<table>` (line 106), not the shared DataTable.
- Statements: `statementFor` / `statementPdfFor` (`services/billing/statements.service.js:60-73`)
  and a per-client `POST /admin/clients/:userId/statement/email`
  (`routes/receivables.routes.js:27`). The Receivables page has an "Email
  statements" bulk action that loops that route per selected row
  (`AdminReceivablesPage.jsx:115`). It only reaches clients **with an open
  balance**, records nothing about what was sent, and re-sends on a second click.
- Adjustments: per-invoice credit (`recordCredit`,
  `services/billing/invoice-actions.service.js:91`), void, and negative
  `adjustment` lines on a draft. Manual payments allocate oldest-first across
  a client's open invoices (`planManualPayment`, `invoice-rules.js:332`).
- CSV: only in the browser (`apps/web/src/lib/data-table/csv.js`, with
  formula-injection neutralizing). No server CSV writer.
- Jobs: `defineJob({ name, description, handler({ dryRun, log, runId }) })`
  (`jobs/registry.js:10`), runner records `job_runs`. The admin Jobs page can
  only trigger dry runs.
- Audit: `auditService.log(entry, tx)` / `logSafe(entry)`.

## Premises corrected

1. **The roadmap says "register the same-pricing report via piece 9's
   `defineReport`", but piece 10 merges before piece 9** (merge order
   7 → 6 → 8 → 10 → 9). `defineReport` will not exist when this merges. See
   Ruling R4.
2. **"Statements: a monthly bulk action if it doesn't exist."** A bulk action
   exists, but it only reaches clients with an open balance, is not
   idempotent, and leaves no record. The lab's monthly run reaches every
   client with activity. This piece replaces it with a server-side run (R6).
3. **"Adjustments are covered by piece 3."** Per-invoice credits and voids
   are. An account-level adjustment (a credit spread across a client's
   invoices without picking each one) is not. See R7.
4. **The client pricing page is not on DataTable** (violates roadmap rule 2).
   This piece converts it, because it rewrites that page anyway.

## Module boundaries

**Generic module `exports`** (no lab words):
- `packages/shared/src/exports/csv.js`: the one CSV field encoder
  (`csvField`, `csvRow`), with RFC 4180 quoting and formula neutralizing. The
  browser `lib/data-table/csv.js` switches to it, so there is one encoder.
- `apps/api/src/modules/exports/`:
  - `registry.js`: `createExportRegistry()` → `{ defineSource, defineFormat, source(key), format(key), list() }`.
  - `formats/csv.js`: the built-in `csv` format.
  - `export.service.js`: `runExport` (validates params, pages the source,
    pipes rows through the format) and `previewExport` (one page plus total).
  - `routes.js`: `createExportsRoutes({ registry, preHandler, audit })`, a
    Fastify plugin factory.
  - `README.md`.
- `apps/web/src/modules/exports/`: `ExportScreen.jsx` (choose a source, fill
  its params, preview in DataTable server mode, download) and
  `params-form.jsx` (renders a source's param descriptors).

**Source interface:**
```
defineSource({
  key, label,
  params: [{ id, label, type: "date"|"select"|"multiselect", options?, required? }],
  paramsSchema,                        // zod; the route validates against it
  fields: [{ key, label, type: "text"|"cents"|"date"|"int" }],
  fetchPage(db, params, { limit, offset }) → Promise<{ rows, total }>,
})
```

**Format interface** (how QuickBooks or Xero drop in later):
```
defineFormat({
  key, label, extension, contentType,
  supports(source) → boolean,          // csv: always; qbo-iif: source.key === "invoices"
  header?(source) → string,
  serializeRow(row, source) → string,  // one line or block, already encoded
  footer?(source) → string,
})
```
A new accounting format is one file under the glue folder that maps a
source's `fields` to the target layout, plus one `defineFormat` call. No
module code changes. The README walks through a worked IIF skeleton as prose
(not code).

**Lab glue:**
- `apps/api/src/exports/index.js`: builds the app's registry, registers `csv`
  and the `invoices` source.
- `apps/api/src/exports/invoices.export.js`: the invoice source.
- `apps/web/src/pages/app/AdminExportsPage.jsx`: the page wrapper.

**Pricing (lab glue, existing pricing services, no new generic module):**
price lists are part of the app's own pricing domain. The roadmap lists them
as glue. They extend `lib/pricing.js` and `services/pricing.service.js`, and
new files sit beside them:
- `services/price-lists.service.js` (CRUD, items, assignments, bulk assign);
- `services/price-copy.service.js` (preview and apply);
- `services/same-pricing.service.js` (groups);
- `lib/price-copy.js` and `lib/same-pricing.js` (pure).

**Billing glue:** `services/billing/account-credit.service.js` and
`services/billing/statement-run.service.js`.

## Data model

All money is integer cents. No DB foreign keys (repo convention).

`price_lists`
- `id`, `name` varchar(120), unique on `lower(name)`
- `description` text (staff text, no PHI)
- `archived_at`, `created_at`, `updated_at`, `created_by`

`price_list_items`
- `id`, `price_list_id`, `variant_id`, `price_cents` int not null ≥ 0
- `updated_at`, `updated_by`
- unique (`price_list_id`, `variant_id`); index `variant_id`

`client_price_lists` (assignment)
- `id`, `client_user_id`, `price_list_id`, `position` int (0 = highest precedence)
- `assigned_at`, `assigned_by`
- unique (`client_user_id`, `price_list_id`); index `price_list_id`

`client_prices.source` gains `copied` (varchar(12) already fits). Copied rows
are stamped reviewed.

`statement_sends`
- `id`, `client_user_id`, `month` char(7) `YYYY-MM`
- `closing_cents`, `sent_at`, `sent_by`, `run_id` (null for a single send)
- `status` sent | failed | no_email
- unique (`client_user_id`, `month`)

`PRICE_SOURCES` (`packages/shared/src/billing/billing.js:10`) gains `list`.
`invoice_lines.price_source` is varchar(10), so it fits.

## Price resolution (the one path)

Precedence, highest first:
1. The client's own `client_prices` row (manual, imported, inferred or copied).
2. The client's assigned lists, in `position` order. The first list with an
   item for the variant wins.
3. The variant's base price.
4. Otherwise unpriced (the existing behaviour).

Implementation:
- Pure `resolveClientPrices({ overrides: Map<variantId,cents>, lists: [{ listId, items: Map<variantId,cents> }] })`
  in `lib/pricing.js` returns `Map<variantId, { cents, source: "client"|"list", listId|null }>`.
- `loadEffectiveClientPrices(clientUserId, variantIds|null, db)` in
  `services/pricing.service.js` loads overrides plus assignments plus items in
  three queries and calls it.
- `loadClientPrices` keeps its signature and becomes a thin wrapper that
  returns `Map<variantId, { cents, source }>`. Every caller only hands the
  map's values to `unitPriceFor`, so the three callers keep working unchanged.
- `unitPriceFor(variant, effective)` accepts a number (old callers) or a
  `{ cents, source }`, and passes `source` through. List-priced invoice lines
  record `priceSource: "list"`.
- Remakes stay at zero after resolution (`asRemakeLines` is untouched).

## API routes (all admin-only: `[authenticate, requireAdmin]`; the lab role sees no money)

Price lists (`routes/admin-price-lists.routes.js`):
- `GET /admin/price-lists`: lists with item and client counts.
- `POST /admin/price-lists` `{ name, description? }`.
- `PATCH /admin/price-lists/:id` `{ name?, description?, archived? }`.
- `GET /admin/price-lists/:id/items` and `PUT /admin/price-lists/:id/items/:variantId`
  `{ priceCents }`; `DELETE` the same path.
- `POST /admin/price-lists/:id/items/bulk` `{ items: [{ variantId, priceCents }] }` (≤ 500; paste or fill-from-base).
- `GET /admin/clients/:userId/price-lists`; `PUT /admin/clients/:userId/price-lists`
  `{ listIds: [] }`, ordered (sets the whole assignment).
- `POST /admin/price-lists/assign` `{ clientUserIds: [≤500], listId, mode: "add"|"replace" }`
  (the bulk action from Users). It returns `{ ok, failed }`.
- `GET /admin/clients/:userId/prices` gains `effective`: every variant the
  client has a non-base price for, with `source` and `listName`.

Copy (`routes/admin-price-lists.routes.js`):
- `POST /admin/prices/copy/preview` `{ fromClientUserId, toClientUserIds: [≤200], mode: "replace"|"merge" }`
  returns per target `{ clientUserId, changes: [{ variantId, beforeCents, beforeSource, afterCents, afterSource }], listsBefore, listsAfter }`.
- `POST /admin/prices/copy` takes the same body plus `previewHash`. It is
  refused (409) if the plan changed since the preview.

Same pricing:
- `GET /admin/prices/same-pricing` returns
  `{ groups: [{ signature, size, clients: [{ id, name, accountNumber, practice }], lists: [names], overrideCount }] }`.
  Singletons are excluded unless `?includeSingles=1`.

Exports (`createExportsRoutes`, mounted at `/api/v1/admin`):
- `GET /admin/exports`: sources with params, fields and the formats that support each.
- `GET /admin/exports/:source/preview?…params&limit&offset`.
- `GET /admin/exports/:source/download.:format?…params`: streamed;
  `Content-Disposition` is `<source>-<from>-<to>.<ext>`.

Account credit:
- `POST /admin/clients/:userId/account-credit` `{ amountCents, reason, allocations? }`.

Statements run (`routes/statement-run.routes.js`):
- `GET /admin/statements/run?month=YYYY-MM`: the preview, one row per client
  `{ clientUserId, name, practice, accountNumber, email|null, openingCents, closingCents, activityCount, alreadySentAt }`.
- `POST /admin/statements/run` `{ month, clientUserIds? }` sends to everyone
  in the preview who is not yet sent and has an email (or only the ids
  given). It returns `{ sent, skipped, failed }`.
- The single-client email route writes a `statement_sends` row too. A
  re-send is allowed there, explicitly, and overwrites `sent_at`.

## UI screens

All lists are DataTable. All confirmations use ConfirmButton. All messages
use Toast.
- **Admin › Price lists** (`/admin/price-lists`, new sidebar entry "Price
  lists" under the admin group): a DataTable of lists (name, items, clients,
  updated). It has search, an "Archived" toggle filter and a "New list"
  button. Row click goes to the list editor.
- **List editor** (`/admin/price-lists/:id`): a header (name and description
  editable inline), then a DataTable of catalog variants (family, variant,
  code, base, list price, delta %). It has an inline price edit, a filter
  "Only priced in this list", a family filter, and bulk actions "Set to base
  price", "Adjust by %" (rounded to cents, preview in the bulk bar) and
  "Remove from list". A "Clients on this list" tab is a DataTable of
  assigned clients.
- **Client pricing** (`/admin/users/:userId/pricing`, rewritten on
  DataTable):
  - an "Assigned lists" strip, ordered by precedence, with add, remove and
    move up/down;
  - the price table shows the effective price with a source chip (Client /
    List: name / Base) and the existing review flow for inferred rows;
  - a "Copy prices from…" button opens the copy modal with this client as
    the target.
- **Users table** (`AdminUsersPage.jsx`) gains bulk actions:
  - "Assign price list…" opens a modal: pick a list, choose add or replace.
  - "Copy prices from…" opens the copy modal with the selected users as
    targets.
- **Copy modal** (`components/admin/CopyPricesModal.jsx`):
  - pick the source client;
  - choose a mode;
  - see the preview: a DataTable with one row per target and the number of
    changes, which expands to the per-variant before/after;
  - apply with ConfirmButton.
- **Same pricing** (`/admin/price-lists/same-pricing`, a tab on the Price
  lists page): a DataTable with one row per group (size, lists, overrides,
  first three client names). It expands to the client list and supports CSV
  export.
- **Exports** (`/admin/exports`, sidebar "Exports"): `ExportScreen` with the
  invoice source pre-selected. Its params are date field (Ordered / Due /
  Issued), from, to and status (Open, Paid, Void, Draft; multi), followed by
  a preview table, a format picker (CSV only today) and Download.
- **Receivables**:
  - the "Email statements" bulk action is replaced by a "Monthly statements"
    button that opens a panel: month picker (defaults to last month), a
    DataTable preview (email, closing, already sent) and ConfirmButton
    "Send N statements";
  - each AR row gains "Account credit…" next to "Email statement".

## Audit rows → coverage

| Audit row | Covered by |
|---|---|
| Price lists (PriceList.aspx; HEAVY USE) | `price_lists` + items + assignment; list editor; R1, R2 |
| Client pricing: edit (CustomerPricing.aspx) | Existing, now on DataTable with list awareness |
| Client pricing: copy | Copy preview and apply, single and bulk |
| Client pricing: same prices | Same-pricing view (R4) |
| Reports › Clients › Same Pricing | The same view; piece 9 registers the report over `sameClientPricingGroups` |
| Reports › Products › Price List | Out of scope here. The list editor's CSV export covers it; piece 9 may register a report over `listItems` |
| Export invoices (ExportData.aspx; CSV/QB/Xero) | `exports` module + invoice source; CSV only (QB/Xero deferred) |
| Adjustments (Adjustment.aspx; LIGHT USE) | Per-invoice credit/void exist; account credit added; account charge deferred (R7) |
| Statements (Statement.aspx; HEAVY USE, monthly bulk) | Statement run with `statement_sends` (R6) |

## Cutover and import impact

- Seazona's API never exposed price lists or their assignments (cutover
  design §"Out of the load"). **Staff re-enter the 3 lists, their item
  prices and which clients are on each.** The runbook gets a step: before
  unfreeze, the admin creates the lists, bulk-fills items (paste from
  Labzona's PriceList screen, or "Set to base" then edit), and bulk-assigns
  clients from the Users table. Then the admin opens Same pricing to compare
  group sizes against Labzona's Same Pricing report.
- Per-client overrides keep their piece 1/5 path (`imported`/`inferred`).
  Once lists exist, an inferred override equal to the client's list price is
  redundant. The client pricing page flags it ("Same as list"), and staff can
  remove it in bulk.
- `statement_sends` starts empty. The first run after cutover sends to
  everyone, which is correct, because Labzona's last run was the prior month.
- Exports and account credits create no import data.

## Rulings

- **R1. A client's own override beats every list; lists apply in assignment
  order.** Why: overrides are the most specific thing staff entered, and the
  lab's lists are templates. Cost if wrong: a precedence flip inside one pure
  function plus its tests.
- **R2. Lists carry no "remake" meaning; remakes stay $0.** The
  "Remake/Reprint" list names suggest list-priced remakes or reprints, but
  nothing shows how Labzona applies them, and today every remake is free
  (`asRemakeLines`). Why: guessing would silently bill remakes. Cost if
  wrong: add `price_lists.applies_to` (`standard`|`remake`) and have
  `asRemakeLines` consult a remake list. That is additive.
- **R3. Copy has two modes.** `replace` makes the target identical to the
  source: same list assignment, same overrides, and target-only overrides
  are removed. `merge` sets the source's overrides on the target, keeps the
  target's other overrides and appends the source's lists the target lacks.
  Copied overrides are `source: "copied"`, reviewed. Why: replace is what
  "same prices" means, and merge covers "give B A's deal on these items".
  Cost if wrong: one more mode in the pure planner.
- **R4. Same pricing is a page in this piece, not a `defineReport`
  registration.** Why: piece 9 merges after piece 10, so `defineReport`
  doesn't exist yet. The grouping is a pure function plus a service
  (`sameClientPricingGroups(db)`) that piece 9's glue wraps in one
  `defineReport({ key: "clients.same-pricing", group: "clients", … })` call.
  Cost if wrong: none. The page remains as the editor-side view.
- **R5. Invoice exports carry no patient column.** A downloaded file leaves
  the app's encryption and audit. Why: the roadmap's no-PHI rule and the
  accountant's needs (number, client, dates, money). Cost if wrong: one
  field in the source behind an explicit admin toggle, plus an audit flag.
- **R6. The statement run is server-side and idempotent per (client,
  month).** It reaches every doctor with activity in the month or a non-zero
  closing balance, and sends one notice per client user, the same unit as
  the existing per-client action (`receivables.routes.js:27`). It uses
  `sendStatementNotice` directly, not piece 8's `notify`: a statement is a
  billing document every client gets regardless of in-app preferences. Why:
  the existing bulk action double-sends on retry and skips zero-balance
  clients with activity. Cost if wrong: per-practice dedupe is a filter in
  the planner.
- **R7. Account-level credit is built; account-level charge is deferred.**
  A credit is allocated across the client's open invoices oldest-first (or
  to chosen invoices), as `credit` ledger rows sharing one
  `credit:<groupId>` transaction id. It reuses `planManualPayment`'s
  allocation, and the reason is required and encrypted. A credit larger than
  the open balance is refused, because there is no unapplied-credit model. A
  standalone debit would need a new invoice kind. Labzona shows none entered
  in November (LIGHT USE). Cost if wrong: a new `kind: "adjustment"` invoice
  with one line, about one task.
- **R8. Exports are admin-only and audited** (`export.downloaded`, with
  source, format, params and row count; no row data). Why: the lab role sees
  no money. Cost if wrong: a role check change.
- **R9. One CSV encoder, in `packages/shared`.** The browser table export
  and the server exporter both use it. Why: two encoders would drift on
  formula neutralizing. Cost if wrong: none.
