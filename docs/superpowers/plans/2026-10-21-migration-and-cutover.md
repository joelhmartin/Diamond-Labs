# Migration and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tools, schema, UI and runbooks that move the lab off Seazona in one rehearsed, reversible cutover: fetch Seazona into an encrypted raw store, load clients, legacy invoices, opening balances and legacy orders into the app (rehearsal first, production with the same command), prove parity, and pause payments for the window. Nothing in this plan writes the production DB, touches `main`, or calls Seazona; those are operator steps in the runbooks.

**Architecture:**
- **Raw store** (`diamond_labs_import`, its own drizzle config and migrations, never applied to the app DB): `seazona_records` (sealed JSON per record), `fetch_runs` (request counts, cursor), `import_files` (the sealed balance export), `key_check`, `parity_reports`.
- **Fetcher** (`apps/api/src/import/seazona-fetch.js` + `fetch-cli.js`): the only importer of Seazona reads. Summaries are a handful of list calls; detail fetches take an explicit filter, print the request count and minutes first, refuse a live run over 100 requests without `--approved <count>`, stop on the first block (403/429/network) and resume from a cursor.
- **Loader** (`map-*.js` pure mappers, `load-*.js` steps, `load-cli.js`): raw store → app tables, idempotent by legacy keys, dry run by default, `--target rehearsal|production` (fixed database names, production needs `--confirm-production diamond_labs`). Steps: `clients`, `invoices`, `balances` (per-invoice or per-client export), `orders`. Seed checks guard the number sequences. `parity-cli.js` reports ids, counts and cents.
- **App changes**: three encrypted legacy columns (one migration, 0033), a `legacy` lab order source and price source, a `legacy_settlement` ledger source, legacy display on invoices, statements and lab orders, legacy orders never billed again, and the `PAYMENTS_PAUSED` maintenance flag.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle ORM 0.36 / drizzle-kit 0.30 (Postgres 15), postgres-js, Zod 3.23 (`@my-app/shared`), Vitest (+ `node:assert/strict`), React + Vite + Tailwind, axios (`apps/web/src/config/api.js`), lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-21-migration-and-cutover-design.md` (builds on `docs/superpowers/plans/2026-10-15-invoicing-and-ar.md`, `2026-10-07-lab-orders-and-production.md`, `2026-10-19-shipping-labels.md`; clone recipe from `2026-10-06-staging-environment.md`).

**Estimated size:** about **137 changed files** against `feat/own-the-lab` (counted task by task), including the spec and this plan:
- **Shared + API + docs** (Tasks 1–2, 3's API half, 5–14, 15's API half, 16): about 127 files, of which 13 are fixtures and generated migration files and 1 is a deletion.
- **Web** (Task 3's web half, Task 15's web half): 10 files.
- Task 4 changes nothing on this branch (it is the separate `main` PR).

That is under CodeRabbit's 150-file cap, so the user's batching rule applies: **one PR** into `feat/own-the-lab`. The margin is thin: if the real count crosses ~145, split along the seam — PR A = Tasks 1–14 (+ docs), PR B = Task 15 stacked on A (≈22 files). Don't add unplanned files.

## Spec corrections

Each item is a load-bearing claim in the spec that is wrong or incomplete against the real code or the Seazona facts. The plan builds the corrected version.

1. **The fetcher can't see a 403 today.** `seazona.service.js` `request()` returns the body or `null`; the status stays inside `requestRaw`, and the body text ("temporarily disabled") is only logged. Task 7 adds status-carrying reads (`listClientsResult`, `listUsersResult`, `listProductsResult`, `getAllInvoicesResult` + `status`, `getAllOrdersResult`, `getInvoiceResult`, `getOrderResult`). The fetcher treats **any 403** as the block, and stops on every other failure too (429 after the service's one retry, network or `SEAZONA_DISABLED` status 0, 5xx). Only a 404 for one record is skipped and counted.
2. **No high-water-mark delta.** The `ordered` filter returns orders *placed* since a date, so an old order that shipped after the last fetch would never refresh, and the invoice archive's `lastModified` was bulk-restamped. Summaries are cheap (≈6 list requests for everything), so every summary fetch is **full**. "Delta" means: re-fetch all summaries, then fetch detail only for records with no detail yet or whose summary `lastModified` is newer than the detail's (the default; `--refetch` overrides).
3. **`users.status` has no `inactive`.** The enum is `active | suspended | deleted`. A client with no email gets a `suspended` doctor with `passwordHash: null` and the placeholder email `client-<seazonaClientId>@seazona-clients.invalid` (`.invalid` is a reserved TLD). `email.service.js` `deliver()` drops `.invalid` recipients, so nothing is ever sent to one. Whether to create them at all is the `--no-email placeholder|skip` flag (default `placeholder`; user decision 4).
4. **`doctor_profiles` can't be "filled in".** Its `npi_number`, `company_name`, `address1`, `city`, `state` and `zip` are NOT NULL, so no profile ever has a missing address; imported doctors simply have **no profile**. The clients step creates a profile only for a doctor with none whose Seazona client carries a complete address, with `npiNumber: ""` (the lab fills it later). Existing profiles are never changed.
5. **A Seazona invoice summary has no issue date** (`{ id, invoiceNumber, patient, clientId, fullName, company, sales, tax, discounts, total, status, due, lastModified }`; `lastModified` was bulk-restamped). `issuedAt` comes from the first date field present on the detail or the summary (`date`, `invoiceDate`, `created`, `createdAt`), else the due date. It is stored at noon lab time so the lab-local day never shifts. The parity report counts the approximations.
6. **The summary line can't be "priced at the total"** when tax is shown separately: subtotal + tax would exceed Seazona's total. Legacy invoices keep `totalCents` = Seazona's `total` exactly, `taxCents` = `tax`, and their lines sum to `total − tax`: the summary line is priced at `total − tax`; detail lines that don't add up get one `adjustment` line for the difference. Legacy lines use a new price source `legacy` ("Seazona"). The plaintext `description` column holds a fixed `Carried over from Seazona` and the real text goes, sealed, into `legacy_description`.
7. **Seazona-era `invoice_payments` rows stay unlinked.** The schema comment says "piece 5's import fills `invoiceId`". It must not: those portal payments are already inside Seazona's open balances, so linking them to legacy invoices would count them twice. Task 12 corrects the comment.
8. **Settlement rows** (`source: legacy_settlement`, `transactionId: legacy:<seazonaInvoiceId>`) carry `userId: null` and `paidOn` = the invoice's issue day, so a past month's statement nets the invoice against its settlement. They are kept out of payment history and the refund screen with the shop rows (`HISTORY_EXCLUDED_SOURCES`).
9. **Open legacy orders already have a Seazona invoice.** Seazona invoices carry the order's workflow status (`In Production`, `Hold`, `Shipped`), so an order still on the bench at cutover is already billed and imported as a legacy invoice with its balance. The spec's "the bench keeps working on them" would bill them a second time when they ship (`issueForShippedLabOrder` drafts an invoice for any non-shop order without one). Legacy lab orders are never billed by the new system: `issueForShippedLabOrder` returns `{ issued: false, reason: "legacy" }` for them.
10. **The bench needs the patient on a legacy order.** `lab_orders` copies no PHI; the board, detail page and ticket read it from the Rx case, and a legacy order has none. This plan adds a fourth encrypted column, `lab_orders.legacy_patient`. When a portal Rx case was pushed to that Seazona order (`rx_cases.seazona_order_id`), the detail page links it, so its files are one click away.
11. **"Legacy orders show read-only"** applies to terminal ones (history). Open legacy orders stay workable on the board (status moves, hold, label), as the spec's open-order mapping intends. Their lines are a snapshot like every lab order's.
12. **Credit balances are not written.** A negative balance becomes a `credits` entry in the balance plan and the parity report, for staff to apply with the existing credit tool after cutover (the spec's "or reported for staff" branch). No ledger row ever pushes an invoice below zero.
13. **A Cloud SQL backup can't be restored into a second database** on the same instance (a restore overwrites the instance). The rehearsal clone uses the staging recipe: `gcloud sql export sql` to a private, auto-expiring bucket, then `gcloud sql import sql` into `diamond_labs_rehearsal`. PHI stays inside GCP.
14. **Order files.** Whether Seazona order files can be downloaded is still unknown. Probing it is a Seazona call that needs the user's OK. This plan does not copy files: the legacy order panel says where they are (the linked portal case, else Seazona). If the probe shows downloads work, copying open orders' files is a follow-up task.
15. **`PAYMENTS_PAUSED` must not refuse `/payments/hosted-complete`.** Authorize.net has already captured the card when that call arrives; refusing it is a `[PAYMENT][CAPTURED_NOT_RECORDED]`. The pause refuses everything that **starts** a payment or **writes** the ledger by hand: doctor `charge-saved` and `hosted-token`, admin `charge-saved`, refunds, staff credits, manual payments. It goes on at least 35 minutes before the migrate step (the hosted binding TTL is 30 minutes), so no hosted payment can still be completing when 0030 drops `applied_amount`.
16. **The PHI key must be the production key.** `node --env-file=.env` loads a developer's `PHI_ENCRYPTION_KEY` if the shell doesn't set one, and a raw store or a production load sealed with it would be unreadable by production. Every import CLI checks the key against a `key_check` row in the import DB, and the loader also decrypts a sealed value from the target (`rx_cases.patient_first`) before writing.
17. **The Cloud SQL socket-URL parsing already exists twice** (`config/database.js`, `db/migrate.js`, "kept in sync"). The import tools would be the third copy. Task 5 extracts `config/pg-client.js` and `db/run-migrations.js` and points all of them at it.
18. **The new app migration is `0033`** (0031–0032 are piece 4's). The import DB's first migration is its own `0000` in `src/import/db/migrations/`.

## Global Constraints

- **Safety rules.** These bind every task in this piece (verbatim from the spec):
  1. **Branches.** Work happens on `feat/own-the-lab-5-cutover`, in the separate `own-the-lab-3` worktree, merged into `feat/own-the-lab`.
     - Nothing touches `main` or the production DB before the cutover.
     - The cutover itself needs the user's explicit go.
  2. **Seazona calls** go only through `seazona.service.js` (50/min limiter, one stream).
     - Every bulk fetch is dry-run first.
     - Every fetch over ~100 requests needs the user's OK, given the request count and the expected duration.
     - No fetch runs from Cloud Run.
  3. **Patient data.** PHI never lands on a laptop disk. Fetched records are written straight into a Cloud SQL database, with patient fields sealed by the existing `PHI_ENCRYPTION_KEY` helpers.
  4. **Load target.** Every load runs against a rehearsal copy first. The production load uses the same command with a different target.
- All work happens in `/Users/bif/Developer/sites/Diamond-Labs/.claude/worktrees/own-the-lab-3` on `feat/own-the-lab-5-cutover`. Never `cd` to the main checkout. Push only with `git push origin feat/own-the-lab-5-cutover`, never a bare `git push` (`push.default=matching` would push local `main`).
- **Implementers never call Seazona, never connect to a Cloud SQL database, and never run `import:fetch --live`, `import:load --live` or anything against `diamond_labs*`.** Every test uses a fake Seazona service, `fakeTx` / `fakeDb`, or fixtures. Live fetches and loads are operator steps in `docs/import-operations.md` and `docs/cutover-runbook.md`, each needing the user's OK.
- **Task 4 (the `main` PR) is instructions only.** Implementers must not create its branch, commit to `main`, push, or open the PR. The user signs it off and it is opened by the user (or on the user's explicit instruction at that moment).
- **No PHI in logs, reports, fixtures or commits.** CLI output, `fetch_runs`, `parity_reports` and log lines carry Seazona ids, invoice/order numbers, account numbers, counts and cents only. Never a patient name, client name, email, address or line text. Fixtures are synthetic ("Test Patient", `@example.test`).
- **Money is integer cents** (`toCents`, `parseMoneyInput`, `formatCents`, `assertCents` from `@my-app/shared`). Seazona dollars become cents once, in a mapper or the export parser.
- **No native `alert()` / `confirm()` / `prompt()`.** Web feedback goes through `useToast`; the pause is a banner.
- **No DB foreign keys** (repo convention). Ids are cuid2 via `createId()` (`apps/api/src/lib/id.js`), `varchar(128)`.
- **Migrations come only from drizzle-kit.** App: `cd apps/api && pnpm db:generate` → exactly one new `0033_<random>.sql` (+ `meta/0033_snapshot.json`, `_journal.json`). Import DB: `cd apps/api && pnpm import:db:generate` → `src/import/db/migrations/0000_<random>.sql` (+ meta). Never hand-write or edit a migration. The import DB's config and folder are never pointed at the app DB, and the app's `drizzle.config.js` never sees the import schema.
- **Staging scrub:** every new app column is classified in `apps/api/src/db/scrub/plan.js` and `COLUMNS.md`; `plan.test.js` fails otherwise.
- **New env vars are documented in `.env.example`** in the task that adds them.
- **Source files under 1,000 lines; functions under 150; a React component under 300 including markup** (excluding blanks, comments, tests). `LabOrderDetailPage.jsx` is already ~380 lines; this plan adds ≤ 6 lines to it and puts the legacy block in its own component. Splitting the page is a follow-up for the PR body.
- **One implementation per job.** Reuse, never copy: `encryptField` / `encryptJson` / `decryptField` / `decryptJson` / `fieldSealer` (`lib/crypto.js`), `sealInvoice` / `sealLine` / `openInvoice` / `openLine` (`services/billing/invoice-crypto.js`), `allocateSequenceNumber` + `INVOICE_NUMBER_LOCK` (`services/sequence.service.js`, `services/billing/invoices.service.js`), `initialsFor` (`services/lab/lab-order-rules.js`), `slugify` / `isoDateIn` / `LAB_TIMEZONE` (`@my-app/shared`), `handlerSource` (`routes/__tests__/_source.js`), `fakeTx` / `fakeDb` (`src/test/fake-tx.js`). The client importer is moved, not copied: `db/import-seazona-clients.js` is deleted in Task 10.
- **Tests:** Vitest. New files import `{ test } from "vitest"` and `assert from "node:assert/strict"`. Tests that seal set `process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";` before importing (pattern from `lib/crypto.test.js`).
- **Verification bar for every task:**
  - `pnpm test` at the repo root passes.
  - `pnpm --filter @my-app/web build` succeeds.
  - After Task 2, `cd apps/api && pnpm db:generate` prints "No schema changes"; after Task 6, so does `pnpm import:db:generate`.
- **Commits:** messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (or the model that did the work). Subagents run on Sonnet at minimum, never Haiku.

## Sequencing

- **Base.** `feat/own-the-lab-5-cutover` = `feat/own-the-lab` with pieces 1–4 merged, plus the spec commit `4c73530`.
- **PR.** One PR into `feat/own-the-lab` (see Estimated size). Merging there deploys **staging only** (`deploy-staging-on-own-the-lab`); staging runs `SEAZONA_DISABLED=true`, so even an accidental fetch there makes no call (and the CLIs refuse on Cloud Run anyway).
- **Mid-branch states.** From Task 2 the columns exist; nothing writes them until Tasks 11–13. The CLIs appear in Tasks 9 and 14. Tests pass at every task.
- **Operator work after the PR merges** (not part of this plan's execution): create `diamond_labs_import` and its role, migrate it, run the summary fetch (≈6 requests, under the 100-request bar, still announced to the user), estimate detail counts, get the user's OK, fetch, clone the rehearsal, load, parity, lab walkthrough, then the cutover runbook.

## Review Focus

These are the five input classes most likely to bite a real person, each pinned to a test in the task that owns it:

1. **Seazona refusing mid-fetch** (a 403 block on request 37 of 400, a 429 after the service's retry, the network dropping, `SEAZONA_DISABLED` on a laptop). The fetcher must stop at once without another call, keep everything fetched so far, record the cursor and resume exactly there; a single record's 404 is skipped and counted. Pinned by the `fetchDetails` stop/resume/404 tests and the dry-run-makes-no-call test in **Task 9**, and the `getInvoiceResult` 403 status test in **Task 7**.
2. **The portal's real export file** (HTML table saved as `.xls`, UTF-16 or UTF-8, `&nbsp;` and `&amp;`, `$1,234.56`, `(12.00)` negatives, blank cells, a "Total" footer row, a duplicate invoice, a header that isn't on the first row, a renamed column). Every row is either parsed to cents or reported with its row number; a missing column fails with the headers it found. Pinned by the `readExport` tests in **Task 8**.
3. **The wrong database or the wrong key** (`--target production` without `--confirm-production diamond_labs`, a rehearsal URL that points at `diamond_labs`, `REHEARSAL_DATABASE_URL` unset, a developer `PHI_ENCRYPTION_KEY`, running inside Cloud Run). Every one is refused before any write. Pinned by the `resolveTarget` / `assertNotCloudRun` / `keyMatches` tests in **Task 5**.
4. **A re-run, or a run after a partial failure** (the same `invoices` step twice, balances re-run with the same export, orders re-run after more detail was fetched). Nothing is inserted twice and the second report says so. Pinned by the `insertMissing` tests in **Task 11**, the settlement re-run test in **Task 12**, and the existing-order skip test in **Task 13**.
5. **Imported history on the live screens** (a legacy shipped order dated 2019 must not flood the board's 14-day shipped window; a settlement row must not appear as a doctor's "payment"; a legacy order that ships in the new system must not get a second invoice; a placeholder client must never be emailed). Pinned by the `mapLegacyOrder` shippedAt test in **Task 13**, the `issueForShippedLabOrder` legacy test in **Task 13**, the payment-history exclusion test in **Task 15**, and the `.invalid` delivery test in **Task 10**.

---

## File Structure

**Shared (`packages/shared/src`)**
- Modified: `lab/lab-order-status.js` (+ test): `LAB_ORDER_SOURCES`, `LAB_ORDER_SOURCE_LABELS`. `schemas/lab.schema.js` (+ test): the list query's `source` enum. `billing/billing.js` (+ test): price source `legacy`, `LEGACY_SETTLEMENT_SOURCE`, `OPENING_BALANCE_PREFIX`, `isOpeningBalanceInvoice`, `HISTORY_EXCLUDED_SOURCES`.

**API (`apps/api`)**
- New config/plumbing: `src/config/pg-client.js` (+ test), `src/db/run-migrations.js`.
- Modified: `src/config/database.js`, `src/db/migrate.js`, `src/config/env.js`, `package.json`, `drizzle.config.js` (untouched; asserted by a test).
- App schema: `src/db/schema/invoices.js`, `lab-orders.js` (+ their tests), generated `src/db/migrations/0033_*.sql` + `meta/0033_snapshot.json` + `meta/_journal.json`; `src/db/scrub/plan.js`, `plan.test.js`, `COLUMNS.md`; `src/db/schema/invoice-payments.js` (comment).
- Import DB (new): `drizzle.import.config.js`; `src/import/db/schema.js` (+ test), `src/import/db/migrate.js`, generated `src/import/db/migrations/0000_*.sql` + `meta/0000_snapshot.json` + `meta/_journal.json`.
- Import tools (new, `src/import/`): `import-errors.js`, `targets.js` (+ test), `cli-args.js` (+ test), `key-check.js` (+ test), `raw-store.js` (+ test), `export-table.js` (+ test), `seazona-records.js` (+ test), `fetch-plan.js` (+ test), `seazona-fetch.js` (+ test), `fetch-cli.js`, `map-clients.js` (+ test), `load-clients.js` (+ test), `map-invoices.js` (+ test), `load-writer.js` (+ test), `seed-check.js` (+ test), `load-invoices.js`, `balance-plan.js` (+ test), `load-balances.js`, `map-orders.js` (+ test), `load-orders.js`, `load-cli.js`, `parity.js` (+ test), `parity-queries.js`, `parity-cli.js`, `report.js`.
- Fixtures (new): `test-fixtures/seazona/{clients,invoices,invoice-details,orders,order-details}.json`, `test-fixtures/seazona/{statements-export,invoices-export}.xls`.
- Deleted: `src/db/import-seazona-clients.js`.
- Seazona: `src/services/seazona.service.js`, new `src/services/seazona-result-reads.test.js`; guards `src/routes/__tests__/seazona-invoice-retired.test.js`, `seazona-order-retired.test.js`.
- Billing/lab read side: `src/services/billing/invoice-crypto.js` (+ new test), `invoice-queries.js`, `invoice-views.js` (+ test), `statement-model.js` (+ test), `ledger.service.js` (+ test), `invoices.service.js` (+ test); `src/services/lab/lab-orders.service.js`, `lab-order-rules.js` (+ test), `ticket-model.js` (+ test); `src/services/email.service.js`, new `src/services/email-invalid.test.js`.
- Payments pause: new `src/middleware/payments-paused.js` (+ test); `src/routes/invoice-payment.routes.js`, `admin-payment.routes.js`, `refund.routes.js`, `admin-invoice.routes.js`; `src/routes/__tests__/payment-routes-split.test.js`; new `src/routes/__tests__/payments-paused-wiring.test.js`.

**Web (`apps/web/src`)**
- New: `hooks/usePaymentsPaused.js`, `components/doctor/PaymentsPausedBanner.jsx`, `components/lab/LegacyOrderPanel.jsx`.
- Modified: `pages/doctor/InvoicesPage.jsx`, `pages/doctor/InvoiceDetailPage.jsx`, `lib/invoices.js` (+ `lib/__tests__/invoices.test.js`), `components/billing/InvoiceView.jsx`, `pages/app/AdminInvoiceDetailPage.jsx`, `pages/lab/LabOrderDetailPage.jsx`.

**Root:** `.env.example`, `CLAUDE.md` (the bulk-import paragraph), `docs/import-operations.md` (new), `docs/cutover-runbook.md` (new), this plan.

## Task order

| # | Task |
|---|---|
| 1 | Shared vocabulary: `legacy` lab order source, `legacy` price source, settlement and opening-balance markers |
| 2 | App schema: encrypted legacy columns (0033), scrub classification, sealers |
| 3 | `PAYMENTS_PAUSED` on the branch: env, guard, six routes, status endpoint, doctor banner |
| 4 | The standalone `main` PR for `PAYMENTS_PAUSED` (instructions and exact diff; user sign-off; do not open or push) |
| 5 | Connection plumbing: one pg client, one migration runner, import targets and refusals, CLI args, key check |
| 6 | Import DB: own schema, drizzle config, generated migration, migrate script, raw store |
| 7 | Seazona service: status-carrying reads, one capped-list walker; guards allow only the fetcher |
| 8 | Export parser: the portal's HTML-table `.xls` with column mapping |
| 9 | Fetcher: plan, record vocabulary, runner (stop on block, resume), `import:fetch` CLI |
| 10 | Clients: mapper over the raw store and the `clients` load step; old importer deleted; no mail to `.invalid` |
| 11 | Legacy invoices: mapper, `insertMissing` writer, seed check, the `invoices` load step |
| 12 | Opening balances: per-invoice and per-client plans, the `balances` load step |
| 13 | Legacy orders: mapper, the `orders` load step; legacy orders never billed again |
| 14 | `import:load` CLI and the parity report (`import:parity`) |
| 15 | Read side: legacy invoices, statements, payment history, legacy lab orders (API and web) |
| 16 | Runbooks, CLAUDE.md, whole-piece verification and PR |

---
### Task 1: Shared vocabulary: `legacy` lab order source, `legacy` price source, settlement and opening-balance markers

**Files:**
- Modify: `packages/shared/src/lab/lab-order-status.js`, `packages/shared/src/lab/lab-order-status.test.js`
- Modify: `packages/shared/src/schemas/lab.schema.js`, `packages/shared/src/schemas/lab.schema.test.js`
- Modify: `packages/shared/src/billing/billing.js`, `packages/shared/src/billing/billing.test.js`

**Interfaces:**
- Produces (all exported from `@my-app/shared`):
  - `LAB_ORDER_SOURCES = ["rx_case", "shop_order", "legacy"]`, `LAB_ORDER_SOURCE_LABELS` (`legacy: "Seazona history"`).
  - `labOrderListQuerySchema.source` accepts every `LAB_ORDER_SOURCES` value.
  - `PRICE_SOURCES` gains `"legacy"` (label `"Seazona"`).
  - `LEGACY_SETTLEMENT_SOURCE = "legacy_settlement"`, `OPENING_BALANCE_PREFIX = "opening:"`, `isOpeningBalanceInvoice(invoice) → boolean`, `HISTORY_EXCLUDED_SOURCES = ["shop_card", "legacy_settlement"]`, `LEGACY_LINE_DESCRIPTION = "Carried over from Seazona"`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/lab/lab-order-status.test.js` (add `LAB_ORDER_SOURCES, LAB_ORDER_SOURCE_LABELS` to its import list):

```js
test("lab orders come from an Rx case, a shop order, or Seazona history", () => {
  assert.deepEqual(LAB_ORDER_SOURCES, ["rx_case", "shop_order", "legacy"]);
  for (const s of LAB_ORDER_SOURCES) assert.ok(LAB_ORDER_SOURCE_LABELS[s], s);
  assert.equal(LAB_ORDER_SOURCE_LABELS.legacy, "Seazona history");
});
```

Append to `packages/shared/src/schemas/lab.schema.test.js`:

```js
test("the order list filters by every lab order source, legacy included", () => {
  assert.equal(labOrderListQuerySchema.parse({ source: "legacy" }).source, "legacy");
  assert.equal(labOrderListQuerySchema.safeParse({ source: "seazona" }).success, false);
});
```

Append to `packages/shared/src/billing/billing.test.js` (extend its import with `PRICE_SOURCES, PRICE_SOURCE_LABELS, LEGACY_SETTLEMENT_SOURCE, OPENING_BALANCE_PREFIX, isOpeningBalanceInvoice, HISTORY_EXCLUDED_SOURCES, SHOP_PAYMENT_SOURCE, LEGACY_LINE_DESCRIPTION`):

```js
test("legacy vocabulary: a price source, a ledger source, and the opening-balance marker", () => {
  assert.ok(PRICE_SOURCES.includes("legacy"));
  assert.equal(PRICE_SOURCE_LABELS.legacy, "Seazona");
  assert.ok("legacy".length <= 10, "invoice_lines.price_source is varchar(10)");
  assert.equal(LEGACY_SETTLEMENT_SOURCE, "legacy_settlement");
  assert.deepEqual(HISTORY_EXCLUDED_SOURCES, [SHOP_PAYMENT_SOURCE, LEGACY_SETTLEMENT_SOURCE]);
  assert.equal(LEGACY_LINE_DESCRIPTION, "Carried over from Seazona");
});

test("only a legacy invoice keyed opening:<client> is an opening balance", () => {
  assert.equal(isOpeningBalanceInvoice({ kind: "legacy", legacySeazonaInvoiceId: `${OPENING_BALANCE_PREFIX}1324` }), true);
  assert.equal(isOpeningBalanceInvoice({ kind: "legacy", legacySeazonaInvoiceId: "8f2c-uuid" }), false);
  assert.equal(isOpeningBalanceInvoice({ kind: "order", legacySeazonaInvoiceId: "opening:1324" }), false);
  assert.equal(isOpeningBalanceInvoice(null), false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @my-app/shared test`
Expected: FAIL. `LAB_ORDER_SOURCES` and the legacy billing exports are undefined; `source: "legacy"` is refused.

- [ ] **Step 3: Implement**

In `packages/shared/src/lab/lab-order-status.js`, after `REASON_REQUIRED_STATUSES`:

```js
/**
 * Where a lab order came from. `legacy` is an order imported from Seazona at
 * cutover (own-the-lab piece 5): source_id is the Seazona order id, and it is
 * never billed by this system (its bill is the imported legacy invoice).
 */
export const LAB_ORDER_SOURCES = ["rx_case", "shop_order", "legacy"];
export const LAB_ORDER_SOURCE_LABELS = { rx_case: "Rx case", shop_order: "Shop order", legacy: "Seazona history" };
```

In `packages/shared/src/schemas/lab.schema.js`, change the import line to
`import { LAB_ORDER_STATUSES, LAB_ORDER_SOURCES } from "../lab/lab-order-status.js";` and the list query's source to:

```js
  source: z.enum(LAB_ORDER_SOURCES).optional(),
```

In `packages/shared/src/billing/billing.js`, change `PRICE_SOURCES` and `PRICE_SOURCE_LABELS` to:

```js
export const PRICE_SOURCES = ["client", "base", "manual", "remake", "unpriced", "shipment", "legacy"];
```

```js
export const PRICE_SOURCE_LABELS = {
  client: "Client price", base: "Base price", manual: "Manual", remake: "Remake (no charge)", unpriced: "Needs a price", shipment: "Shipping label",
  legacy: "Seazona",
};
```

and after `SHOP_PAYMENT_SOURCE` add:

```js
/**
 * Own-the-lab piece 5. A legacy invoice's settled part (total − Seazona's open
 * balance) is one ledger row with this source and transactionId
 * `legacy:<seazonaInvoiceId>`. It is bookkeeping, not a payment anyone made.
 */
export const LEGACY_SETTLEMENT_SOURCE = "legacy_settlement";
/** Ledger rows kept out of payment history and the refund screen. */
export const HISTORY_EXCLUDED_SOURCES = [SHOP_PAYMENT_SOURCE, LEGACY_SETTLEMENT_SOURCE];
/** legacySeazonaInvoiceId of a per-client opening-balance invoice: `opening:<account number>`. */
export const OPENING_BALANCE_PREFIX = "opening:";
export const isOpeningBalanceInvoice = (inv) =>
  inv?.kind === "legacy" && String(inv?.legacySeazonaInvoiceId ?? "").startsWith(OPENING_BALANCE_PREFIX);
/** The plaintext description of every imported Seazona line; the real text is sealed in legacy_description. */
export const LEGACY_LINE_DESCRIPTION = "Carried over from Seazona";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @my-app/shared test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): legacy lab order source, legacy price source, settlement and opening-balance markers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: App schema: encrypted legacy columns (0033), scrub classification, sealers

**Files:**
- Modify: `apps/api/src/db/schema/invoices.js`, `apps/api/src/db/schema/invoices.test.js`
- Modify: `apps/api/src/db/schema/lab-orders.js`, `apps/api/src/db/schema/lab-orders.test.js`
- Generated: `apps/api/src/db/migrations/0033_*.sql`, `meta/0033_snapshot.json`, `meta/_journal.json`
- Modify: `apps/api/src/db/scrub/plan.js`, `apps/api/src/db/scrub/plan.test.js`, `apps/api/src/db/scrub/COLUMNS.md`
- Modify: `apps/api/src/services/billing/invoice-crypto.js`; Create: `apps/api/src/services/billing/invoice-crypto.test.js`
- Modify: `apps/api/src/services/lab/lab-orders.service.js` (one line: `SECRET_ORDER_FIELDS`), `apps/api/src/services/lab/lab-orders.service.test.js` (the regex that pins that line)

**Interfaces:**
- Produces:
  - `invoices.legacyPatient` (`legacy_patient`, text, nullable): Seazona's `patient`, sealed.
  - `invoiceLines.legacyDescription` (`legacy_description`, text, nullable): an imported line's text, sealed.
  - `labOrders.legacyPatient` (`legacy_patient`, text, nullable): a legacy order's patient, sealed.
  - `sealInvoice` / `openInvoice` also seal/open `legacyPatient`; `sealLine` / `openLine` also `legacyDescription`. The lab order sealer (`lab-orders.service.js` `sealOrder`/`openOrder`) also `legacyPatient`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/db/schema/invoices.test.js`:

```js
test("legacy invoices and lines carry their Seazona text sealed, in their own nullable columns", () => {
  assert.equal(invoices.legacyPatient.notNull, false);
  assert.equal(invoices.legacyPatient.columnType, "PgText");
  assert.equal(invoiceLines.legacyDescription.notNull, false);
  assert.equal(invoiceLines.legacyDescription.columnType, "PgText");
});

test("0033 adds exactly the three legacy columns", () => {
  const sql = migration("0033_");
  assert.match(sql, /ALTER TABLE "invoices" ADD COLUMN "legacy_patient" text;/);
  assert.match(sql, /ALTER TABLE "invoice_lines" ADD COLUMN "legacy_description" text;/);
  assert.match(sql, /ALTER TABLE "lab_orders" ADD COLUMN "legacy_patient" text;/);
  assert.equal((sql.match(/ALTER TABLE/g) ?? []).length, 3, sql);
});
```

Append to `apps/api/src/db/schema/lab-orders.test.js` (import `labOrders` if not already imported):

```js
test("a legacy lab order keeps its patient sealed on the order (it has no Rx case)", () => {
  assert.equal(labOrders.legacyPatient.notNull, false);
  assert.equal(labOrders.legacyPatient.columnType, "PgText");
});
```

In `apps/api/src/db/scrub/plan.test.js` `MUST_SCRUB`, change three entries to:

```js
  lab_orders: ["hold_reason", "lab_notes", "legacy_patient"],
  invoices: ["notes", "void_reason", "legacy_patient"],
  invoice_lines: ["description", "price_note", "legacy_description"],
```

Create `apps/api/src/services/billing/invoice-crypto.test.js`:

```js
process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";

const { sealInvoice, openInvoice, sealLine, openLine } = await import("./invoice-crypto.js");

test("a legacy invoice's patient is sealed at rest and opened on read", () => {
  const sealed = sealInvoice({ id: "i1", legacyPatient: "Test Patient", notes: null });
  assert.match(sealed.legacyPatient, /^enc:v1:/);
  assert.equal(sealed.notes, null);
  assert.equal(openInvoice(sealed).legacyPatient, "Test Patient");
});

test("a legacy line's Seazona text is sealed; a normal line has none", () => {
  const sealed = sealLine({ id: "l1", description: "Carried over from Seazona", legacyDescription: "DDSO for Test Patient" });
  assert.match(sealed.legacyDescription, /^enc:v1:/);
  assert.equal(sealed.description, "Carried over from Seazona");
  assert.equal(openLine(sealed).legacyDescription, "DDSO for Test Patient");
  assert.equal(openLine({ id: "l2", description: "x" }).legacyDescription, undefined);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/db src/services/billing/invoice-crypto.test.js`
Expected: FAIL. The columns are undefined, there is no `0033_` migration, the scrub plan lacks the columns, and `legacyPatient` comes back unsealed.

- [ ] **Step 3: Add the columns**

In `apps/api/src/db/schema/invoices.js`, in `invoices` after `legacySeazonaInvoiceId`:

```js
  // Piece 5: Seazona's `patient` on an imported invoice (the doctor matches the
  // bill by it). Encrypted (invoice-crypto.js). Null on every non-legacy invoice.
  legacyPatient: text("legacy_patient"),
```

and in `invoiceLines` after `description`:

```js
  // Piece 5: an imported line's Seazona text (can name a patient). Encrypted;
  // `description` then holds LEGACY_LINE_DESCRIPTION. Null on every other line.
  legacyDescription: text("legacy_description"),
```

Extend the `priceSource` comment to `// client | base | manual | remake | unpriced | shipment | legacy`.

In `apps/api/src/db/schema/lab-orders.js`, in `labOrders` after `sourceId`:

```js
  // Piece 5: a legacy (Seazona) order has no Rx case to read the patient from,
  // so its patient lives here. Encrypted (lab-orders.service sealOrder). Null otherwise.
  legacyPatient: text("legacy_patient"),
```

and change the `// rx_case | shop_order` comment above `source` to `// rx_case | shop_order | legacy (packages/shared LAB_ORDER_SOURCES)`.

- [ ] **Step 4: Generate the migration**

Run: `cd apps/api && pnpm db:generate`
Expected: one new `src/db/migrations/0033_<random_name>.sql` with exactly the three `ALTER TABLE … ADD COLUMN … text;` statements, plus `meta/0033_snapshot.json` and an updated `_journal.json`. Do not edit it.

- [ ] **Step 5: Seal the new columns**

`apps/api/src/services/billing/invoice-crypto.js` becomes:

```js
import { fieldSealer } from "../../lib/crypto.js";

// Staff free text on billing rows can name a patient: encrypted at rest, like
// lab notes (B4). So can the Seazona text piece 5 imports (the invoice's
// patient, a line's description). Decrypted rows are never logged.
const invoiceSecrets = fieldSealer(["notes", "voidReason", "legacyPatient"]);
const lineSecrets = fieldSealer(["priceNote", "legacyDescription"]);
const ledgerSecrets = fieldSealer(["note"]);

export const sealInvoice = invoiceSecrets.seal;
export const openInvoice = invoiceSecrets.open;
export const sealLine = lineSecrets.seal;
export const openLine = lineSecrets.open;
export const sealLedgerRow = ledgerSecrets.seal;
export const openLedgerRow = ledgerSecrets.open;
```

In `apps/api/src/services/lab/lab-orders.service.js`:

```js
const SECRET_ORDER_FIELDS = ["holdReason", "labNotes", "legacyPatient"];
```

and in `apps/api/src/services/lab/lab-orders.service.test.js` update the assertion that pins it:

```js
  assert.match(source, /SECRET_ORDER_FIELDS = \["holdReason", "labNotes", "legacyPatient"\]/);
```

- [ ] **Step 6: Classify the columns for the staging scrub**

In `apps/api/src/db/scrub/plan.js`:
- `lab_orders.columns`: add `legacy_patient: phi("NULL"), // a Seazona order's patient (encrypted)` after `hold_reason`/`lab_notes`.
- `invoices.columns`: add `legacy_patient: phi("NULL"), // Seazona's patient on an imported invoice (encrypted)`.
- `invoice_lines.columns`: add `legacy_description: phi("NULL"), // an imported Seazona line's text (encrypted)`.

In `apps/api/src/db/scrub/COLUMNS.md`, add to the scrubbed-columns table after the `invoice_lines.price_note` row:

```markdown
| invoices.legacy_patient | phi | NULL (Seazona's patient on an imported invoice; encrypted at rest) |
| invoice_lines.legacy_description | phi | NULL (an imported Seazona line's text; can name a patient; encrypted) |
| lab_orders.legacy_patient | phi | NULL (a legacy Seazona order's patient; encrypted) |
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/db src/services/billing src/services/lab`
Expected: PASS.

Run: `cd apps/api && pnpm db:generate`
Expected: "No schema changes, nothing to migrate".

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db apps/api/src/services/billing/invoice-crypto.js apps/api/src/services/billing/invoice-crypto.test.js apps/api/src/services/lab/lab-orders.service.js apps/api/src/services/lab/lab-orders.service.test.js
git commit -m "feat(db): sealed legacy columns for imported invoices, lines and lab orders (0033)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `PAYMENTS_PAUSED` on the branch: env, guard, six routes, status endpoint, doctor banner

**Files:**
- Modify: `apps/api/src/config/env.js`, `.env.example`
- Create: `apps/api/src/middleware/payments-paused.js`, `apps/api/src/middleware/payments-paused.test.js`
- Create: `apps/api/src/routes/__tests__/payments-paused-wiring.test.js`
- Modify: `apps/api/src/routes/invoice-payment.routes.js`, `apps/api/src/routes/admin-payment.routes.js`, `apps/api/src/routes/refund.routes.js`, `apps/api/src/routes/admin-invoice.routes.js`, `apps/api/src/routes/__tests__/payment-routes-split.test.js`
- Create: `apps/web/src/hooks/usePaymentsPaused.js`, `apps/web/src/components/doctor/PaymentsPausedBanner.jsx`
- Modify: `apps/web/src/pages/doctor/InvoicesPage.jsx`, `apps/web/src/pages/doctor/InvoiceDetailPage.jsx`

**Interfaces:**
- Produces:
  - `env.PAYMENTS_PAUSED: boolean` (default `false`).
  - `middleware/payments-paused.js`: `PAYMENTS_PAUSED_MESSAGE`, `paymentsPausedGuard(isPaused?) → preHandler`, `paymentsPaused` (the guard bound to `env`). Replies `503 { error: { code: "PAYMENTS_PAUSED", message } }`.
  - `GET /api/v1/payments/status` (any signed-in user) → `{ data: { paused: boolean } }`.
  - Web: `usePaymentsPaused() → boolean`, `<PaymentsPausedBanner />`.
- The middleware file and its test are **byte-identical** to Task 4's `main` PR, so the eventual merge of `feat/own-the-lab` into `main` sees the same file on both sides. `payments-paused-wiring.test.js` is identical too (it finds routes in whichever file registers them).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/middleware/payments-paused.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { paymentsPausedGuard, PAYMENTS_PAUSED_MESSAGE } = await import("./payments-paused.js");
const { env } = await import("../config/env.js");

const fakeReply = () => ({
  statusCode: 200,
  body: undefined,
  code(c) { this.statusCode = c; return this; },
  send(b) { this.body = b; return this; },
});

test("paused: the request is refused with 503 and the upgrade message", async () => {
  const reply = fakeReply();
  await paymentsPausedGuard(() => true)({}, reply);
  assert.equal(reply.statusCode, 503);
  assert.deepEqual(reply.body, { error: { code: "PAYMENTS_PAUSED", message: PAYMENTS_PAUSED_MESSAGE } });
});

test("not paused: the request passes untouched", async () => {
  const reply = fakeReply();
  assert.equal(await paymentsPausedGuard(() => false)({}, reply), undefined);
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.body, undefined);
});

test("PAYMENTS_PAUSED is off unless set to the string true", () => {
  assert.equal(env.PAYMENTS_PAUSED, false);
});
```

Create `apps/api/src/routes/__tests__/payments-paused-wiring.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Kept byte-identical on main and feat/own-the-lab, so it finds each route in
// whichever file registers it (the two branches lay routes out differently).
// It slices registrations itself instead of importing _source.js, which main lacks.
const routesDir = fileURLToPath(new URL("..", import.meta.url));
const sources = readdirSync(routesDir).filter((f) => f.endsWith(".routes.js")).map((f) => readFileSync(join(routesDir, f), "utf8"));

function registration(marker) {
  for (const src of sources) {
    const start = src.indexOf(marker);
    if (start < 0) continue;
    const next = src.indexOf("\n  fastify.", start + marker.length);
    return src.slice(start, next === -1 ? src.length : next);
  }
  return null;
}

// Every route that starts a card payment or writes the invoice ledger by hand.
const ALWAYS = [
  'fastify.post("/payments/charge-saved",',
  'fastify.post("/payments/hosted-token",',
  'fastify.post("/admin/users/:userId/payments/charge-saved",',
  'fastify.post("/admin/payments/refund",',
];
// Manual ledger writes: main has offline-payment; feat/own-the-lab has credit + manual payments.
const MANUAL = [
  'fastify.post("/admin/invoices/:invoiceId/offline-payment",',
  'fastify.post("/admin/invoices/:id/credit",',
  'fastify.post("/admin/clients/:userId/payments",',
];

test("every payment-starting route is behind the PAYMENTS_PAUSED guard", () => {
  for (const m of ALWAYS) {
    const src = registration(m);
    assert.ok(src, `route not found: ${m}`);
    assert.match(src, /paymentsPaused/, `${m} is not paused`);
  }
  const manual = MANUAL.map(registration).filter(Boolean);
  assert.ok(manual.length > 0, "no manual-payment route found: the guard list is stale");
  for (const src of manual) assert.match(src, /paymentsPaused/, src.slice(0, 80));
});

test("hosted-complete is never paused: the card was already captured when it runs", () => {
  const src = registration('fastify.post("/payments/hosted-complete",');
  assert.ok(src);
  assert.doesNotMatch(src, /paymentsPaused/);
});
```

In `apps/api/src/routes/__tests__/payment-routes-split.test.js`, change the `invoice-payment.routes.js` entry of `FILES` to:

```js
  "../invoice-payment.routes.js": [
    'fastify.post("/payments/charge-saved",', 'fastify.post("/payments/hosted-token",', 'fastify.post("/payments/hosted-complete",',
    'fastify.get("/payments/status",',
  ],
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/middleware/payments-paused.test.js src/routes/__tests__/payments-paused-wiring.test.js src/routes/__tests__/payment-routes-split.test.js`
Expected: FAIL. The middleware does not exist, no route mentions `paymentsPaused`, and `/payments/status` is missing.

- [ ] **Step 3: Add the env flag**

In `apps/api/src/config/env.js`, directly after the `AUTOPAY_LIVE_RUN:` line, add:

```js
  // Cutover freeze (own-the-lab piece 5): "true" refuses every route that
  // starts a card payment or writes the invoice ledger by hand
  // (middleware/payments-paused.js). Never set outside a maintenance window.
  PAYMENTS_PAUSED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
```

In `.env.example`, after `AUTOPAY_LIVE_RUN=false`:

```
# Cutover freeze: "true" pauses doctor and staff payments (docs/cutover-runbook.md).
PAYMENTS_PAUSED=false
```

- [ ] **Step 4: Write the guard**

Create `apps/api/src/middleware/payments-paused.js`:

```js
import { env } from "../config/env.js";

/**
 * Maintenance switch for the cutover freeze (PAYMENTS_PAUSED=true): refuses
 * every request that would START a card payment or write the invoice ledger by
 * hand. It must never guard /payments/hosted-complete: that call records a
 * charge Authorize.net has already captured, and refusing it would lose the
 * record. Keep this file identical on main and feat/own-the-lab.
 */
export const PAYMENTS_PAUSED_MESSAGE = "Payments are paused for an upgrade. Please try again later.";

export function paymentsPausedGuard(isPaused = () => env.PAYMENTS_PAUSED === true) {
  return async function paymentsPaused(request, reply) {
    if (!isPaused()) return;
    return reply.code(503).send({ error: { code: "PAYMENTS_PAUSED", message: PAYMENTS_PAUSED_MESSAGE } });
  };
}

export const paymentsPaused = paymentsPausedGuard();
```

- [ ] **Step 5: Wire it into the six routes and add the status endpoint**

`apps/api/src/routes/invoice-payment.routes.js`:
- Add imports: `import { paymentsPaused } from "../middleware/payments-paused.js";` and `import { env } from "../config/env.js";`.
- Replace the two registrations and add the status route right after them (hosted-complete is unchanged):

```js
  fastify.post("/payments/charge-saved", { ...CHARGE_RATE_LIMIT, preHandler: [authenticate, requireApprovedDoctor, paymentsPaused, validate(chargeSavedSchema)] }, chargeSaved);
  fastify.post("/payments/hosted-token", { ...CHARGE_RATE_LIMIT, preHandler: [authenticate, requireApprovedDoctor, paymentsPaused, validate(hostedTokenSchema)] }, hostedToken);
```

```js
  // The doctor pages read this to show the pause banner instead of a Pay button.
  fastify.get("/payments/status", { preHandler: [authenticate] }, async () => ({ data: { paused: env.PAYMENTS_PAUSED === true } }));
```

`apps/api/src/routes/admin-payment.routes.js`: import `paymentsPaused` and change the admin charge's preHandler to `preHandler: [...guard, paymentsPaused, validate(chargeSavedSchema)],`.

`apps/api/src/routes/refund.routes.js`: import `paymentsPaused` and change to `preHandler: [authenticate, requireAdmin, paymentsPaused, validate(refundSchema)],`.

`apps/api/src/routes/admin-invoice.routes.js`: import `paymentsPaused` and change the two ledger-writing registrations:

```js
  fastify.post("/admin/invoices/:id/credit", { preHandler: [...ADMIN, paymentsPaused, validate(invoiceCreditSchema)] }, (request, reply) =>
```

```js
  fastify.post("/admin/clients/:userId/payments", { preHandler: [...ADMIN, paymentsPaused, validate(manualPaymentSchema)] }, (request, reply) =>
```

(keep each handler body exactly as it is).

- [ ] **Step 6: Run the API tests**

Run: `cd apps/api && pnpm vitest run src/middleware src/routes`
Expected: PASS.

- [ ] **Step 7: The doctor's pause banner**

Create `apps/web/src/hooks/usePaymentsPaused.js`:

```js
import { useEffect, useState } from "react";
import api from "../config/api.js";

/**
 * True while the cutover freeze (PAYMENTS_PAUSED) is on. A failed check reads
 * as "not paused": the API still refuses the payment with the same message.
 */
export function usePaymentsPaused() {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let live = true;
    api.get("/payments/status")
      .then((res) => { if (live) setPaused(res.data?.data?.paused === true); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return paused;
}
```

Create `apps/web/src/components/doctor/PaymentsPausedBanner.jsx`:

```jsx
import { PauseCircle } from "lucide-react";

/** Shown instead of Pay buttons during the cutover freeze. */
export function PaymentsPausedBanner() {
  return (
    <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>Payments are paused for an upgrade. You can still view and download your invoices; paying will be back shortly.</p>
    </div>
  );
}
```

`apps/web/src/pages/doctor/InvoicesPage.jsx`:
- Add imports: `import { usePaymentsPaused } from "../../hooks/usePaymentsPaused.js";` and `import { PaymentsPausedBanner } from "../../components/doctor/PaymentsPausedBanner.jsx";`.
- After `const { addToast } = useToast();` add `const paused = usePaymentsPaused();`.
- Change `{selected.size > 0 && (` (the Pay selected button) to `{selected.size > 0 && !paused && (`.
- Directly after the header `<div className="mb-6 flex flex-wrap items-end justify-between gap-4">…</div>` block, add `{paused && <PaymentsPausedBanner />}`.

`apps/web/src/pages/doctor/InvoiceDetailPage.jsx`:
- Same two imports; after `const { addToast } = useToast();` add `const paused = usePaymentsPaused();`.
- Change `{isPayable(inv) && (` to `{isPayable(inv) && !paused && (`.
- Change `{back}` inside the main return to `{back}{paused && <PaymentsPausedBanner />}`.

- [ ] **Step 8: Verify**

Run: `pnpm test && pnpm --filter @my-app/web build`
Expected: PASS, build succeeds.

- [ ] **Step 9: Commit**

```bash
git add .env.example apps/api/src/config/env.js apps/api/src/middleware apps/api/src/routes apps/web/src/hooks/usePaymentsPaused.js apps/web/src/components/doctor/PaymentsPausedBanner.jsx apps/web/src/pages/doctor/InvoicesPage.jsx apps/web/src/pages/doctor/InvoiceDetailPage.jsx
git commit -m "feat(payments): PAYMENTS_PAUSED maintenance flag for the cutover freeze

Refuses every route that starts a payment or writes the ledger by hand;
hosted-complete stays open (the card is already captured). Doctors see a
banner instead of Pay buttons.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The standalone `main` PR for `PAYMENTS_PAUSED` (instructions and exact diff; user sign-off; do not open or push)

> **NEEDS THE USER'S SIGN-OFF. Implementers must not create this branch, commit to `main`, push, or open the PR.** This task only records, in this plan, the exact change the user (or an agent the user explicitly instructs at that moment) applies to `main` ahead of the cutover window. `main` auto-deploys to production on merge (`deploy-api-on-main`), so the merge itself is a production event. The executing agent marks this task done by checking the diff below still applies to `origin/main` (`git show origin/main:<file>` for each file) and reporting any drift. It writes nothing.

**Why a separate PR:** the cutover's step 1 sets `PAYMENTS_PAUSED=true` on the **current** production revision (built from `main`), which has no such flag. It must be on `main`, deployed and verified before the window.

**Files on `main` (5 changed, 3 new):**
- New: `apps/api/src/middleware/payments-paused.js`, `apps/api/src/middleware/payments-paused.test.js`, `apps/api/src/routes/__tests__/payments-paused-wiring.test.js`: **byte-identical** to Task 3's files (copy them from `feat/own-the-lab-5-cutover`).
- Modified: `apps/api/src/config/env.js`, `.env.example`, `apps/api/src/routes/payment.routes.js`, `apps/api/src/routes/admin-payment.routes.js`, `apps/api/src/routes/invoice.routes.js`.

**How (when the user says go):**

```bash
# in a NEW worktree, never the main checkout
git fetch origin
git worktree add ../main-payments-paused -b chore/payments-paused origin/main
cd ../main-payments-paused
git checkout feat/own-the-lab-5-cutover -- apps/api/src/middleware/payments-paused.js apps/api/src/middleware/payments-paused.test.js apps/api/src/routes/__tests__/payments-paused-wiring.test.js
# apply the diff below, then:
pnpm install && pnpm test
git diff --name-only origin/main...HEAD | wc -l   # expect 8
```

**The exact diff for the five modified files:**

```diff
--- a/apps/api/src/config/env.js
+++ b/apps/api/src/config/env.js
@@
   AUTOPAY_LIVE_RUN: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
+  // Cutover freeze (own-the-lab piece 5): "true" refuses every route that
+  // starts a card payment or writes the invoice ledger by hand
+  // (middleware/payments-paused.js). Never set outside a maintenance window.
+  PAYMENTS_PAUSED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
   // Enrollment floor in dollars. An admin may override it per doctor.
--- a/.env.example
+++ b/.env.example
@@
 AUTOPAY_LIVE_RUN=false
+# Cutover freeze: "true" pauses doctor and staff payments (docs/cutover-runbook.md on feat/own-the-lab).
+PAYMENTS_PAUSED=false
 AUTOPAY_MIN_AMOUNT=200
--- a/apps/api/src/routes/payment.routes.js
+++ b/apps/api/src/routes/payment.routes.js
@@
 import { authenticate } from "../middleware/authenticate.js";
 import { requireApprovedDoctor, requireAdmin } from "../middleware/require-role.js";
 import { validate } from "../middleware/validate.js";
+import { paymentsPaused } from "../middleware/payments-paused.js";
@@
   fastify.post("/payments/charge-saved", {
     ...CHARGE_RATE_LIMIT,
-    preHandler: [authenticate, requireApprovedDoctor, validate(chargeSavedSchema)],
+    preHandler: [authenticate, requireApprovedDoctor, paymentsPaused, validate(chargeSavedSchema)],
   }, async (request, reply) => {
@@
   fastify.post("/payments/hosted-token", {
     ...CHARGE_RATE_LIMIT,
-    preHandler: [authenticate, requireApprovedDoctor, validate(hostedTokenSchema)],
+    preHandler: [authenticate, requireApprovedDoctor, paymentsPaused, validate(hostedTokenSchema)],
   }, async (request, reply) => {
@@
   fastify.post("/admin/payments/refund", {
-    preHandler: [authenticate, requireAdmin, validate(refundSchema)],
+    preHandler: [authenticate, requireAdmin, paymentsPaused, validate(refundSchema)],
   }, async (request, reply) => {
--- a/apps/api/src/routes/admin-payment.routes.js
+++ b/apps/api/src/routes/admin-payment.routes.js
@@
 import { validate } from "../middleware/validate.js";
+import { paymentsPaused } from "../middleware/payments-paused.js";
@@
   fastify.post("/admin/users/:userId/payments/charge-saved", {
     ...ADMIN_CHARGE_RATE_LIMIT,
-    preHandler: [...guard, validate(chargeSavedSchema)],
+    preHandler: [...guard, paymentsPaused, validate(chargeSavedSchema)],
   }, async (request, reply) => {
--- a/apps/api/src/routes/invoice.routes.js
+++ b/apps/api/src/routes/invoice.routes.js
@@
 import { requireApprovedDoctor, requireAdmin } from "../middleware/require-role.js";
+import { paymentsPaused } from "../middleware/payments-paused.js";
@@
   fastify.post("/admin/invoices/:invoiceId/offline-payment", {
-    preHandler: [authenticate, requireAdmin],
+    preHandler: [authenticate, requireAdmin, paymentsPaused],
   }, async (request, reply) => {
```

`/payments/hosted-complete` and `/payments/checkout` are deliberately untouched (Spec correction 15; shop checkout writes no invoice ledger on `main`). Main's web needs no change: `PaymentModal` and the hosted form already toast `err.response.data.error.message`, so a doctor who presses Pay sees "Payments are paused for an upgrade. Please try again later."

**PR body (paste-ready for the user):**

copy below
chore(payments): PAYMENTS_PAUSED maintenance flag for the Seazona cutover

Adds an env flag (default false) that refuses, with 503 "Payments are paused for an upgrade", every route that starts a card payment or writes the invoice ledger by hand: doctor charge-saved and hosted-token, admin charge-saved, refunds, and admin offline payments. hosted-complete is deliberately not paused, because Authorize.net has already captured the card when it runs.

Nothing changes until PAYMENTS_PAUSED=true is set on the Cloud Run service. The cutover runbook sets it at least 35 minutes before the migrate step (the hosted-payment binding lives 30 minutes), so no payment can write the column migration 0030 drops.

8 files. The middleware and both tests are byte-identical to feat/own-the-lab, so the later merge sees the same files on both sides.

Verification: pnpm test passes; with PAYMENTS_PAUSED=true locally, POST /api/v1/payments/charge-saved returns 503 with the message.
end

**After the user merges it:** watch the `deploy-api-on-main` build to completion, then confirm production still takes payments with the flag unset (one doctor-portal page load; no charge needed). Record the merge SHA in the cutover runbook's "Before the window" checklist.

- [ ] **Step 1: Confirm the diff still applies to `origin/main`**

Run (read-only): `git fetch origin && for f in apps/api/src/config/env.js apps/api/src/routes/payment.routes.js apps/api/src/routes/admin-payment.routes.js apps/api/src/routes/invoice.routes.js; do git show origin/main:$f > /dev/null || echo "MISSING $f"; done` and check each `-` line above appears verbatim in `git show origin/main:<file>`.
Expected: every context line is found. If any drifted, update this task's diff in the plan (a docs-only commit) and tell the user. Do not create the branch.

- [ ] **Step 2: Commit (only if the diff text had to change)**

```bash
git add docs/superpowers/plans/2026-10-21-migration-and-cutover.md
git commit -m "docs(plan): refresh the main PAYMENTS_PAUSED diff against origin/main

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Connection plumbing: one pg client, one migration runner, import targets and refusals, CLI args, key check

**Files:**
- Create: `apps/api/src/config/pg-client.js`, `apps/api/src/config/pg-client.test.js`
- Create: `apps/api/src/db/run-migrations.js`
- Modify: `apps/api/src/config/database.js`, `apps/api/src/db/migrate.js`
- Create: `apps/api/src/import/import-errors.js`
- Create: `apps/api/src/import/targets.js`, `apps/api/src/import/targets.test.js`
- Create: `apps/api/src/import/cli-args.js`, `apps/api/src/import/cli-args.test.js`
- Create: `apps/api/src/import/key-check.js`, `apps/api/src/import/key-check.test.js`
- Modify: `.env.example`

**Interfaces:**
- Produces:
  - `config/pg-client.js`: `pgConnectArgs(url, opts) → [url, opts] | [optionsObject]`, `createPgClient(url, opts) → postgres client`. The only Cloud SQL socket-URL parser.
  - `db/run-migrations.js`: `runMigrations({ url, migrationsFolder, label }) → Promise<void>` (throws on failure; never imports `config/env.js`).
  - `import/import-errors.js`: `class ImportRefusal extends Error` (a guard refused; CLIs print the message and exit 2).
  - `import/targets.js`: `IMPORT_DB_NAME = "diamond_labs_import"`, `TARGETS`, `databaseName(url) → string|null`, `assertNotCloudRun(env)`, `resolveImportDb(env) → { name: "import", url, database }`, `resolveTarget(name, env, { confirmProduction }) → { name, url, database }`, `connect(resolved, schema) → { name, database, db, client, close() }`.
  - `import/cli-args.js`: `parseArgs(argv, { allowed, booleans }) → { positional: string[], flags: Record<string, string|true> }`, `intFlag(flags, name) → number|undefined`, `listFlag(flags, name) → string[]|undefined`.
  - `import/key-check.js`: `KEY_CHECK_PLAINTEXT`, `keyMatches(sealed, plaintext?) → boolean`, `assertImportKey(importDb, { keyCheck }) → "created"|"verified"`, `assertTargetKey(targetDb) → void`.
- Env (operator machine only, never Cloud Run): `IMPORT_DATABASE_URL`, `REHEARSAL_DATABASE_URL`, `PRODUCTION_DATABASE_URL`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/config/pg-client.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pgConnectArgs } from "./pg-client.js";

test("a Cloud SQL socket URL becomes an options object", () => {
  const [opts] = pgConnectArgs("postgresql://app:p%40ss@/diamond_labs?host=/cloudsql/proj:us-central1:db", { max: 2 });
  assert.deepEqual(opts, { host: "/cloudsql/proj:us-central1:db", database: "diamond_labs", username: "app", password: "p@ss", max: 2 });
});

test("a TCP URL passes through with its options", () => {
  assert.deepEqual(pgConnectArgs("postgresql://u:p@127.0.0.1:5433/x", { max: 1 }), ["postgresql://u:p@127.0.0.1:5433/x", { max: 1 }]);
});

test("there is one socket-URL parser: database.js and run-migrations.js use pg-client.js", () => {
  for (const f of ["./database.js", "../db/run-migrations.js", "../db/migrate.js"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\?host=\(\.\+\)/, `${f} still parses socket URLs itself`);
  }
});
```

Create `apps/api/src/import/targets.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { databaseName, assertNotCloudRun, resolveImportDb, resolveTarget, IMPORT_DB_NAME } from "./targets.js";
import { ImportRefusal } from "./import-errors.js";

const env = {
  IMPORT_DATABASE_URL: "postgresql://importer:x@127.0.0.1:6001/diamond_labs_import",
  REHEARSAL_DATABASE_URL: "postgresql://admin:x@127.0.0.1:6002/diamond_labs_rehearsal",
  PRODUCTION_DATABASE_URL: "postgresql://admin:x@127.0.0.1:6003/diamond_labs",
};

test("database names come from TCP and Cloud SQL socket URLs", () => {
  assert.equal(databaseName(env.REHEARSAL_DATABASE_URL), "diamond_labs_rehearsal");
  assert.equal(databaseName("postgresql://u:p@/diamond_labs?host=/cloudsql/x"), "diamond_labs");
  assert.equal(databaseName("not a url"), null);
});

test("import commands refuse to run on Cloud Run (service or job)", () => {
  assert.throws(() => assertNotCloudRun({ K_SERVICE: "diamond-labs-api" }), ImportRefusal);
  assert.throws(() => assertNotCloudRun({ CLOUD_RUN_JOB: "diamond-labs-jobs" }), ImportRefusal);
  assert.doesNotThrow(() => assertNotCloudRun({}));
});

test("the import DB must be diamond_labs_import", () => {
  assert.equal(resolveImportDb(env).database, IMPORT_DB_NAME);
  assert.throws(() => resolveImportDb({}), /IMPORT_DATABASE_URL/);
  assert.throws(() => resolveImportDb({ IMPORT_DATABASE_URL: env.PRODUCTION_DATABASE_URL }), /diamond_labs_import/);
});

test("rehearsal must point at diamond_labs_rehearsal; production needs its exact confirmation", () => {
  assert.equal(resolveTarget("rehearsal", env).database, "diamond_labs_rehearsal");
  assert.throws(() => resolveTarget("rehearsal", { REHEARSAL_DATABASE_URL: env.PRODUCTION_DATABASE_URL }), /diamond_labs_rehearsal/);
  assert.throws(() => resolveTarget("production", env), /--confirm-production diamond_labs/);
  assert.throws(() => resolveTarget("production", env, { confirmProduction: "yes" }), /--confirm-production diamond_labs/);
  assert.equal(resolveTarget("production", env, { confirmProduction: "diamond_labs" }).database, "diamond_labs");
  assert.throws(() => resolveTarget("staging", env), /rehearsal or production/);
  assert.throws(() => resolveTarget("rehearsal", {}), /REHEARSAL_DATABASE_URL/);
});

test("DATABASE_URL is never a load target", () => {
  assert.throws(() => resolveTarget("rehearsal", { DATABASE_URL: env.REHEARSAL_DATABASE_URL }), /REHEARSAL_DATABASE_URL/);
});
```

Create `apps/api/src/import/cli-args.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseArgs, intFlag, listFlag } from "./cli-args.js";
import { ImportRefusal } from "./import-errors.js";

const opts = { allowed: ["live", "target", "approved", "ids", "columns"], booleans: ["live"] };

test("positionals, --flag value, --flag=value and booleans", () => {
  const { positional, flags } = parseArgs(["invoices", "--target", "rehearsal", "--approved=120", "--live", "--columns", "balance=Amount Due"], opts);
  assert.deepEqual(positional, ["invoices"]);
  assert.deepEqual(flags, { target: "rehearsal", approved: "120", live: true, columns: "balance=Amount Due" });
});

test("an unknown flag or a missing value is refused, never ignored", () => {
  assert.throws(() => parseArgs(["--lvie"], opts), ImportRefusal);
  assert.throws(() => parseArgs(["--target"], opts), /--target needs a value/);
  assert.throws(() => parseArgs(["--target", "--live"], opts), /--target needs a value/);
});

test("integer and list flags", () => {
  assert.equal(intFlag({ approved: "120" }, "approved"), 120);
  assert.equal(intFlag({}, "approved"), undefined);
  assert.throws(() => intFlag({ approved: "12.5" }, "approved"), /whole number/);
  assert.deepEqual(listFlag({ ids: "a, b,,c" }, "ids"), ["a", "b", "c"]);
});
```

Create `apps/api/src/import/key-check.test.js`:

```js
process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";

const { encryptField } = await import("../lib/crypto.js");
const { keyMatches, assertImportKey, assertTargetKey, KEY_CHECK_PLAINTEXT } = await import("./key-check.js");
const { ImportRefusal } = await import("./import-errors.js");

const keyCheck = { id: "id", value: "value" }; // stand-in table; fakeTx ignores it

test("keyMatches: the right key opens, anything else does not (never throws)", () => {
  assert.equal(keyMatches(encryptField("x"), "x"), true);
  assert.equal(keyMatches(encryptField("x"), "y"), false);
  assert.equal(keyMatches(encryptField("x")), true);
  assert.equal(keyMatches(`enc:v1:${"A".repeat(60)}`), false, "sealed under another key");
  assert.equal(keyMatches("Smith"), false, "plaintext is not a key check");
});

test("the import DB key check is written once, then verified", async () => {
  const fresh = fakeTx({ selects: [[]] });
  assert.equal(await assertImportKey(fresh, { keyCheck }), "created");
  const insert = fresh.log.find((e) => e.op === "insert");
  assert.equal(insert.values.id, "phi");
  assert.equal(keyMatches(insert.values.value, KEY_CHECK_PLAINTEXT), true);

  const ok = fakeTx({ selects: [[{ id: "phi", value: encryptField(KEY_CHECK_PLAINTEXT) }]] });
  assert.equal(await assertImportKey(ok, { keyCheck }), "verified");

  const other = fakeTx({ selects: [[{ id: "phi", value: `enc:v1:${"A".repeat(60)}` }]] });
  await assert.rejects(assertImportKey(other, { keyCheck }), ImportRefusal);
});

test("a target must hold a sealed value the current key opens", async () => {
  await assertTargetKey({ execute: async () => [{ v: encryptField("Test") }] });
  await assert.rejects(assertTargetKey({ execute: async () => [] }), /no sealed rx_cases row/);
  await assert.rejects(assertTargetKey({ execute: async () => [{ v: `enc:v1:${"A".repeat(60)}` }] }), /does not open/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/config/pg-client.test.js src/import`
Expected: FAIL (modules missing).

- [ ] **Step 3: One pg client and one migration runner**

Create `apps/api/src/config/pg-client.js`:

```js
import postgres from "postgres";

// Cloud SQL hands out unix-socket URLs: postgresql://user:pass@/dbname?host=/cloudsql/INSTANCE.
// postgres-js can't parse the empty host, so those connect through an options
// object. The ONE parser for it: config/database.js, db/run-migrations.js and
// the import tools (src/import/targets.js) all connect through here. It imports
// nothing from config/env.js, so the migrate job and import CLIs can use it.
const SOCKET_URL = /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@\/([^?]+)\?host=(.+)$/;

/** postgres-js arguments for a URL: [url, opts] for TCP, [options] for a Cloud SQL socket. */
export function pgConnectArgs(url, opts = {}) {
  const m = String(url ?? "").match(SOCKET_URL);
  if (!m) return [url, opts];
  return [{
    host: decodeURIComponent(m[4]),
    database: m[3],
    username: decodeURIComponent(m[1]),
    password: decodeURIComponent(m[2]),
    ...opts,
  }];
}

export function createPgClient(url, opts = {}) {
  return postgres(...pgConnectArgs(url, opts));
}
```

Replace `apps/api/src/config/database.js` with:

```js
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "./env.js";
import { createPgClient } from "./pg-client.js";
import * as schema from "../db/schema/index.js";

const poolOpts = {
  max: env.NODE_ENV === "production" ? 20 : 5,
  idle_timeout: 20,
  connect_timeout: 10,
};

// Cloud SQL socket URLs are handled by createPgClient (config/pg-client.js).
const queryClient = createPgClient(env.DATABASE_URL, poolOpts);

export const db = drizzle(queryClient, { schema });
export { queryClient };
```

Create `apps/api/src/db/run-migrations.js`:

```js
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createPgClient } from "../config/pg-client.js";

/**
 * Apply a folder of drizzle migrations to `url`, then close the connection.
 * Throws on failure. Never imports config/env.js: the migrate Cloud Run Job and
 * the import DB's migrate script need only a URL. Used by db/migrate.js (the app
 * DB) and import/db/migrate.js (diamond_labs_import, its own folder).
 */
export async function runMigrations({ url, migrationsFolder, label = "migrate" }) {
  const client = createPgClient(url, { max: 1 });
  try {
    console.log(`[${label}] applying migrations from ${migrationsFolder}`);
    await migrate(drizzle(client), { migrationsFolder });
    console.log(`[${label}] done — schema is up to date`);
  } finally {
    await client.end({ timeout: 5 }).catch(() => {});
  }
}
```

Replace the body of `apps/api/src/db/migrate.js` below its header comment (keep the "Why not drizzle-kit migrate?" comment, drop the "kept in sync — see the socketMatch regex" sentence) with:

```js
import { runMigrations } from "./run-migrations.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

try {
  await runMigrations({ url, migrationsFolder: new URL("./migrations", import.meta.url).pathname });
  process.exit(0);
} catch (err) {
  console.error("[migrate] FAILED:", err);
  process.exit(1);
}
```

- [ ] **Step 4: Refusals, targets and CLI args**

Create `apps/api/src/import/import-errors.js`:

```js
/**
 * A piece-5 import guard refused to run: wrong or unconfirmed target, Cloud Run,
 * a PHI key mismatch, an unapproved request count, a bad flag. CLIs print the
 * message (never a stack) and exit 2. Messages never carry record contents.
 */
export class ImportRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportRefusal";
  }
}
```

Create `apps/api/src/import/targets.js`:

```js
import { drizzle } from "drizzle-orm/postgres-js";
import { createPgClient } from "../config/pg-client.js";
import { ImportRefusal } from "./import-errors.js";

/**
 * Where the piece-5 tools read and write. Each database is named by its own env
 * var and checked by NAME, so a URL pasted into the wrong variable is refused.
 * DATABASE_URL (whatever .env points at) is never a target. Production also
 * needs `--confirm-production diamond_labs` on the command line.
 */
export const IMPORT_DB_NAME = "diamond_labs_import";
export const TARGETS = {
  rehearsal: { envVar: "REHEARSAL_DATABASE_URL", database: "diamond_labs_rehearsal" },
  production: { envVar: "PRODUCTION_DATABASE_URL", database: "diamond_labs" },
};

export function databaseName(url) {
  const m = /^postgres(?:ql)?:\/\/[^/]*\/([^?]+)/.exec(String(url ?? ""));
  return m ? decodeURIComponent(m[1]) : null;
}

export function assertNotCloudRun(env = process.env) {
  if (env.K_SERVICE || env.CLOUD_RUN_JOB) {
    throw new ImportRefusal("Import commands never run on Cloud Run: a Seazona burst from production would block the live portal. Run them from the operator's machine (docs/import-operations.md).");
  }
}

function checked(envVar, expected, env) {
  const url = env[envVar];
  if (!url) throw new ImportRefusal(`${envVar} is not set.`);
  const database = databaseName(url);
  if (database !== expected) throw new ImportRefusal(`${envVar} must point at the ${expected} database (it points at ${database ?? "an unreadable URL"}).`);
  return { url, database };
}

export function resolveImportDb(env = process.env) {
  return { name: "import", ...checked("IMPORT_DATABASE_URL", IMPORT_DB_NAME, env) };
}

export function resolveTarget(name, env = process.env, { confirmProduction } = {}) {
  const t = TARGETS[name];
  if (!t) throw new ImportRefusal("--target must be rehearsal or production.");
  const resolved = { name, ...checked(t.envVar, t.database, env) };
  if (name === "production" && confirmProduction !== t.database) {
    throw new ImportRefusal(`A production load needs --confirm-production ${t.database}.`);
  }
  return resolved;
}

/** Open a resolved database with a drizzle schema. Call close() when done. */
export function connect(resolved, schema) {
  const client = createPgClient(resolved.url, { max: 4, connect_timeout: 15 });
  return { name: resolved.name, database: resolved.database, client, db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}
```

Create `apps/api/src/import/cli-args.js`:

```js
import { ImportRefusal } from "./import-errors.js";

/**
 * argv → { positional, flags }. Accepts `--name value` and `--name=value`;
 * names in `booleans` take no value. Unknown flags and missing values are
 * refused: a typo must never quietly turn into a different run.
 */
export function parseArgs(argv, { allowed = [], booleans = [] } = {}) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (!allowed.includes(name)) throw new ImportRefusal(`Unknown flag --${name}.`);
    if (booleans.includes(name)) {
      flags[name] = true;
      continue;
    }
    const value = inline ?? argv[i + 1];
    if (value === undefined || value === "" || (inline === undefined && value.startsWith("--"))) {
      throw new ImportRefusal(`--${name} needs a value.`);
    }
    if (inline === undefined) i += 1;
    flags[name] = value;
  }
  return { positional, flags };
}

export function intFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  const n = Number(flags[name]);
  if (!Number.isSafeInteger(n) || n < 0) throw new ImportRefusal(`--${name} must be a whole number.`);
  return n;
}

export function listFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  return String(flags[name]).split(",").map((s) => s.trim()).filter(Boolean);
}
```

- [ ] **Step 5: The PHI key check**

Create `apps/api/src/import/key-check.js`:

```js
import { eq, sql } from "drizzle-orm";
import { encryptField, decryptField, isEncrypted } from "../lib/crypto.js";
import { ImportRefusal } from "./import-errors.js";

/**
 * Every piece-5 CLI must seal with PRODUCTION's PHI_ENCRYPTION_KEY: a raw store
 * or a load sealed with a developer's key (`node --env-file=.env` picks one up
 * when the shell sets none) would be unreadable in production. The import DB
 * keeps one sealed constant; a target is checked against a sealed rx_cases value.
 */
export const KEY_CHECK_PLAINTEXT = "diamond-labs-import-key-check-v1";

/** True when `sealed` is ciphertext the current key opens (and equals `plaintext` when given). Never throws. */
export function keyMatches(sealed, plaintext = null) {
  if (!isEncrypted(sealed)) return false;
  try {
    const opened = decryptField(sealed);
    return plaintext == null ? true : opened === plaintext;
  } catch {
    return false;
  }
}

/** Written on first use, verified on every later run. `keyCheck` is the import DB's key_check table. */
export async function assertImportKey(importDb, { keyCheck }) {
  const [row] = await importDb.select().from(keyCheck).where(eq(keyCheck.id, "phi"));
  if (!row) {
    await importDb.insert(keyCheck).values({ id: "phi", value: encryptField(KEY_CHECK_PLAINTEXT) });
    return "created";
  }
  if (!keyMatches(row.value, KEY_CHECK_PLAINTEXT)) {
    throw new ImportRefusal("PHI_ENCRYPTION_KEY does not open the import DB's key check. Export production's key into the shell for this command (docs/import-operations.md); never use the one in .env.");
  }
  return "verified";
}

/** The target must hold a sealed patient name the current key opens. */
export async function assertTargetKey(targetDb) {
  const result = await targetDb.execute(sql`select patient_first as v from rx_cases where patient_first like 'enc:v1:%' limit 1`);
  const sample = (result?.rows ?? result)?.[0]?.v;
  if (!sample) throw new ImportRefusal("The target has no sealed rx_cases row to check PHI_ENCRYPTION_KEY against. Refusing to write.");
  if (!keyMatches(sample)) throw new ImportRefusal("PHI_ENCRYPTION_KEY does not open the target's sealed data. Refusing to write.");
}
```

In `.env.example`, add at the end:

```
# ── Piece 5 import tools (operator machine only; never set on Cloud Run) ──
# Each must point at the named database (src/import/targets.js checks the name).
# IMPORT_DATABASE_URL=postgresql://importer:...@127.0.0.1:6001/diamond_labs_import
# REHEARSAL_DATABASE_URL=postgresql://...@127.0.0.1:6002/diamond_labs_rehearsal
# PRODUCTION_DATABASE_URL=postgresql://...@127.0.0.1:6003/diamond_labs
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/config src/import src/db`
Expected: PASS. Then run the whole API suite (`cd apps/api && pnpm test`): every test that imports `config/database.js` still passes.

- [ ] **Step 7: Commit**

```bash
git add .env.example apps/api/src/config apps/api/src/db/run-migrations.js apps/api/src/db/migrate.js apps/api/src/import
git commit -m "feat(import): one pg client and migration runner; import targets, refusals, CLI args, PHI key check

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Import DB: own schema, drizzle config, generated migration, migrate script, raw store

**Files:**
- Create: `apps/api/drizzle.import.config.js`
- Create: `apps/api/src/import/db/schema.js`, `apps/api/src/import/db/schema.test.js`, `apps/api/src/import/db/migrate.js`
- Generated: `apps/api/src/import/db/migrations/0000_*.sql`, `meta/0000_snapshot.json`, `meta/_journal.json`
- Create: `apps/api/src/import/raw-store.js`, `apps/api/src/import/raw-store.test.js`
- Modify: `apps/api/package.json` (scripts)

**Interfaces:**
- Consumes: `runMigrations`, `resolveImportDb`, `assertNotCloudRun` (Task 5).
- Produces:
  - `import/db/schema.js`: `RAW_ENTITIES`, tables `seazonaRecords`, `fetchRuns`, `importFiles`, `keyCheck`, `parityReports`.
  - `import/raw-store.js`: `upsertRecords(importDb, { entity, records, runId })`, `readRecords(importDb, entity) → [{ seazonaId, payload, lastModified, fetchedAt }]` (opened), `recordIndex(importDb, entity) → Map<seazonaId, lastModified|null>` (opens nothing), `startRun(importDb, { entity, mode, plannedIds }) → runId`, `saveProgress(importDb, runId, { cursor, requestCount, errorCount, lastStatus })`, `finishRun(importDb, runId, { status, cursor, requestCount, errorCount, lastStatus, note })`, `getRun(importDb, runId)`, `saveFile(importDb, { kind, bytes }) → fileId`, `readFile(importDb, id) → { kind, bytes } | null`, `saveParityReport(importDb, { target, clean, report })`, and `rawStore(importDb)` binding them all as `{ upsert(entity, records, runId), records(entity), index(entity), startRun, saveProgress, finishRun, getRun, saveFile, readFile, saveParityReport }`.
  - `records` passed to `upsert` are `{ seazonaId, payload, lastModified }`.
  - Scripts: `import:db:generate`, `import:db:migrate`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/import/db/schema.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as importSchema from "./schema.js";
import * as appSchema from "../../db/schema/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const apiRoot = join(here, "../../..");

test("the raw store keys every record by (entity, seazona_id) and keeps the payload sealed in text", () => {
  const { seazonaRecords, RAW_ENTITIES } = importSchema;
  assert.deepEqual(RAW_ENTITIES, ["client", "product", "user", "invoice", "invoice_detail", "order", "order_detail"]);
  for (const c of ["id", "entity", "seazonaId", "payload", "lastModified", "fetchedAt", "fetchRunId"]) assert.ok(seazonaRecords[c], c);
  assert.equal(seazonaRecords.payload.columnType, "PgText");
  assert.equal(seazonaRecords.payload.notNull, true);
});

test("fetch runs keep counts and a resume cursor; files and the key check are sealed text", () => {
  const { fetchRuns, importFiles, keyCheck, parityReports } = importSchema;
  for (const c of ["entity", "mode", "status", "requestCount", "errorCount", "plannedIds", "cursor", "lastStatus"]) assert.ok(fetchRuns[c], c);
  assert.equal(importFiles.content.columnType, "PgText");
  assert.ok(keyCheck.value);
  assert.ok(parityReports.report);
});

test("the import schema never reaches the app DB, and the app schema never reaches the import DB", () => {
  for (const name of ["seazonaRecords", "fetchRuns", "importFiles", "keyCheck", "parityReports"]) {
    assert.equal(name in appSchema, false, `${name} leaked into the app schema`);
  }
  const appConfig = readFileSync(join(apiRoot, "drizzle.config.js"), "utf8");
  assert.match(appConfig, /schema: "\.\/src\/db\/schema\/index\.js"/);
  assert.match(appConfig, /out: "\.\/src\/db\/migrations"/);
  const importConfig = readFileSync(join(apiRoot, "drizzle.import.config.js"), "utf8");
  assert.match(importConfig, /schema: "\.\/src\/import\/db\/schema\.js"/);
  assert.match(importConfig, /out: "\.\/src\/import\/db\/migrations"/);
  assert.match(importConfig, /IMPORT_DATABASE_URL/);
  assert.doesNotMatch(importConfig, /process\.env\.DATABASE_URL/);

  const appSql = readdirSync(join(apiRoot, "src/db/migrations")).filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(apiRoot, "src/db/migrations", f), "utf8")).join("\n");
  assert.doesNotMatch(appSql, /seazona_records|fetch_runs|import_files/);
  const importSql = readdirSync(join(here, "migrations")).filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(here, "migrations", f), "utf8")).join("\n");
  assert.match(importSql, /CREATE TABLE "seazona_records"/);
  assert.doesNotMatch(importSql, /CREATE TABLE "(users|invoices|lab_orders)"/);
});
```

Create `apps/api/src/import/raw-store.test.js`:

```js
process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";

const { encryptJson, encryptField } = await import("../lib/crypto.js");
const store = await import("./raw-store.js");

test("upsert seals each payload whole and batches by 500", async () => {
  const tx = fakeTx();
  const records = Array.from({ length: 1200 }, (_, i) => ({ seazonaId: `s${i}`, payload: { id: `s${i}`, patient: "Test Patient" }, lastModified: "2026-10-01T00:00:00" }));
  assert.equal(await store.upsertRecords(tx, { entity: "invoice", records, runId: "r1" }), 1200);
  const inserts = tx.log.filter((e) => e.op === "insert");
  assert.equal(inserts.length, 3);
  const first = inserts[0].values[0];
  assert.equal(first.entity, "invoice");
  assert.equal(first.seazonaId, "s0");
  assert.equal(first.fetchRunId, "r1");
  assert.match(first.payload, /^enc:v1:/);
  assert.ok(!JSON.stringify(inserts).includes("Test Patient"), "no plaintext payload reaches the insert");
});

test("records open on read; the index opens nothing", async () => {
  const tx = fakeTx({ selects: [[{ seazonaId: "s1", payload: encryptJson({ id: "s1", total: 12.5 }), lastModified: "x", fetchedAt: new Date(0) }]] });
  const [r] = await store.readRecords(tx, "invoice");
  assert.deepEqual(r.payload, { id: "s1", total: 12.5 });
  const idx = await store.recordIndex(fakeTx({ selects: [[{ seazonaId: "s1", lastModified: "x" }, { seazonaId: "s2", lastModified: null }]] }), "invoice");
  assert.deepEqual([...idx], [["s1", "x"], ["s2", null]]);
});

test("an export file is stored sealed, once per content", async () => {
  const bytes = Buffer.from("<table><tr><td>1324</td></tr></table>");
  const fresh = fakeTx({ selects: [[]] });
  const id = await store.saveFile(fresh, { kind: "balances_invoice", bytes });
  const insert = fresh.log.find((e) => e.op === "insert");
  assert.equal(insert.values.id, id);
  assert.match(insert.values.content, /^enc:v1:/);
  assert.match(insert.values.sha256, /^[0-9a-f]{64}$/);

  const again = fakeTx({ selects: [[{ id: "f-existing" }]] });
  assert.equal(await store.saveFile(again, { kind: "balances_invoice", bytes }), "f-existing");
  assert.equal(again.log.some((e) => e.op === "insert"), false);

  const read = await store.readFile(fakeTx({ selects: [[{ kind: "balances_invoice", content: encryptField(bytes.toString("base64")) }]] }), "f1");
  assert.equal(read.bytes.toString(), bytes.toString());
});

test("a fetch run records counts and its resume cursor", async () => {
  const tx = fakeTx();
  const id = await store.startRun(tx, { entity: "invoice_detail", mode: "detail", plannedIds: ["a", "b"] });
  await store.saveProgress(tx, id, { cursor: 1, requestCount: 1, errorCount: 0 });
  await store.finishRun(tx, id, { status: "blocked", cursor: 1, requestCount: 2, errorCount: 1, lastStatus: 403 });
  const insert = tx.log.find((e) => e.op === "insert");
  assert.deepEqual(insert.values.plannedIds, ["a", "b"]);
  assert.equal(insert.values.status, "running");
  const sets = tx.log.filter((e) => e.op === "set").map((e) => e.values);
  assert.equal(sets[0].cursor, 1);
  assert.equal(sets[1].status, "blocked");
  assert.equal(sets[1].lastStatus, 403);
  assert.ok(sets[1].finishedAt instanceof Date);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/import/db src/import/raw-store.test.js`
Expected: FAIL (modules and config missing).

- [ ] **Step 3: Write the import schema and its own drizzle config**

Create `apps/api/src/import/db/schema.js`:

```js
import { pgTable, varchar, text, integer, boolean, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

// The piece-5 raw store: diamond_labs_import ONLY (drizzle.import.config.js,
// migrations in ./migrations). Never exported from src/db/schema/index.js and
// never migrated into the app DB. Payloads, files and the key check are sealed
// with PHI_ENCRYPTION_KEY (lib/crypto.js); everything else here is ids, counts,
// statuses and Seazona's own lastModified strings — no PHI.

export const RAW_ENTITIES = ["client", "product", "user", "invoice", "invoice_detail", "order", "order_detail"];

const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const seazonaRecords = pgTable("seazona_records", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // RAW_ENTITIES
  entity: varchar("entity", { length: 20 }).notNull(),
  seazonaId: varchar("seazona_id", { length: 128 }).notNull(),
  // encryptJson(the record exactly as Seazona returned it)
  payload: text("payload").notNull(),
  // Seazona's lastModified for a summary; for a detail, its summary's lastModified at fetch time.
  lastModified: varchar("last_modified", { length: 40 }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  fetchRunId: varchar("fetch_run_id", { length: 128 }).notNull(),
}, (t) => [
  uniqueIndex("seazona_records_entity_id_idx").on(t.entity, t.seazonaId),
  index("seazona_records_run_idx").on(t.fetchRunId),
]);

export const fetchRuns = pgTable("fetch_runs", {
  id: varchar("id", { length: 128 }).primaryKey(),
  entity: varchar("entity", { length: 20 }).notNull(),
  // summary | detail
  mode: varchar("mode", { length: 10 }).notNull(),
  // running | done | blocked | failed
  status: varchar("status", { length: 10 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  requestCount: integer("request_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  // A detail run's Seazona ids, in fetch order (resume replays from `cursor`).
  plannedIds: jsonb("planned_ids"),
  cursor: integer("cursor").notNull().default(0),
  lastStatus: integer("last_status"),
  note: text("note"),
});

export const importFiles = pgTable("import_files", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // balances_invoice | balances_client
  kind: varchar("kind", { length: 30 }).notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  // encryptField(base64 of the uploaded bytes)
  content: text("content").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("import_files_kind_sha_idx").on(t.kind, t.sha256)]);

export const keyCheck = pgTable("key_check", {
  id: varchar("id", { length: 20 }).primaryKey(),
  value: text("value").notNull(),
  createdAt: created(),
});

export const parityReports = pgTable("parity_reports", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // rehearsal | production
  target: varchar("target", { length: 20 }).notNull(),
  clean: boolean("clean").notNull(),
  // ids, counts and cents only (import/parity.js)
  report: jsonb("report").notNull(),
  createdAt: created(),
});
```

Create `apps/api/drizzle.import.config.js`:

```js
import "dotenv/config";

/**
 * drizzle-kit config for the piece-5 import DB (diamond_labs_import) ONLY.
 * Never point it at the app DB, and never add these tables to drizzle.config.js:
 * import/db/schema.test.js enforces both. Migrations are applied with
 * `pnpm import:db:migrate` (src/import/db/migrate.js), never with db:migrate.
 */
/** @type {import("drizzle-kit").Config} */
export default {
  schema: "./src/import/db/schema.js",
  out: "./src/import/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.IMPORT_DATABASE_URL ?? "postgresql://unused@localhost:5432/diamond_labs_import",
  },
};
```

Create `apps/api/src/import/db/migrate.js`:

```js
/**
 * Apply the import DB's own migrations (./migrations) to IMPORT_DATABASE_URL,
 * which must name diamond_labs_import. Operator machine only.
 *
 *   IMPORT_DATABASE_URL=… pnpm --filter @my-app/api import:db:migrate
 */
import { runMigrations } from "../../db/run-migrations.js";
import { assertNotCloudRun, resolveImportDb } from "../targets.js";

try {
  assertNotCloudRun(process.env);
  const { url } = resolveImportDb(process.env);
  await runMigrations({ url, migrationsFolder: new URL("./migrations", import.meta.url).pathname, label: "import-db" });
  process.exit(0);
} catch (err) {
  console.error(`[import-db] ${err?.message || err}`);
  process.exit(1);
}
```

In `apps/api/package.json` `scripts`, add:

```json
    "import:db:generate": "drizzle-kit generate --config=drizzle.import.config.js",
    "import:db:migrate": "node --env-file=.env src/import/db/migrate.js",
```

- [ ] **Step 4: Generate the import DB's first migration**

Run: `cd apps/api && pnpm import:db:generate`
Expected: `src/import/db/migrations/0000_<random>.sql` with the five `CREATE TABLE`s and the three indexes, plus its `meta/` folder. Do not edit it. Then `cd apps/api && pnpm db:generate` must still print "No schema changes" (the app config never saw these tables).

- [ ] **Step 5: Write the raw store**

Create `apps/api/src/import/raw-store.js`:

```js
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { createId } from "../lib/id.js";
import { encryptJson, decryptJson, encryptField, decryptField } from "../lib/crypto.js";
import { seazonaRecords, fetchRuns, importFiles, parityReports } from "./db/schema.js";

/**
 * The raw store's reads and writes. Payloads are sealed whole on the way in
 * and opened only in memory on the way out: never log what readRecords returns.
 */
const BATCH = 500;

export async function upsertRecords(importDb, { entity, records, runId, now = new Date() }) {
  for (let i = 0; i < records.length; i += BATCH) {
    const rows = records.slice(i, i + BATCH).map((r) => ({
      id: createId(),
      entity,
      seazonaId: String(r.seazonaId),
      payload: encryptJson(r.payload),
      lastModified: r.lastModified == null ? null : String(r.lastModified).slice(0, 40),
      fetchedAt: now,
      fetchRunId: runId,
    }));
    await importDb.insert(seazonaRecords).values(rows).onConflictDoUpdate({
      target: [seazonaRecords.entity, seazonaRecords.seazonaId],
      set: {
        payload: sql`excluded.payload`,
        lastModified: sql`excluded.last_modified`,
        fetchedAt: sql`excluded.fetched_at`,
        fetchRunId: sql`excluded.fetch_run_id`,
      },
    });
  }
  return records.length;
}

/** Every record of one entity, opened. PHI in memory only. */
export async function readRecords(importDb, entity) {
  const rows = await importDb.select().from(seazonaRecords).where(eq(seazonaRecords.entity, entity));
  return rows.map((r) => ({ seazonaId: r.seazonaId, payload: decryptJson(r.payload), lastModified: r.lastModified ?? null, fetchedAt: r.fetchedAt }));
}

/** seazonaId → lastModified for one entity, without opening anything. */
export async function recordIndex(importDb, entity) {
  const rows = await importDb
    .select({ seazonaId: seazonaRecords.seazonaId, lastModified: seazonaRecords.lastModified })
    .from(seazonaRecords)
    .where(eq(seazonaRecords.entity, entity));
  return new Map(rows.map((r) => [r.seazonaId, r.lastModified ?? null]));
}

export async function startRun(importDb, { entity, mode, plannedIds = null, now = new Date() }) {
  const id = createId();
  await importDb.insert(fetchRuns).values({ id, entity, mode, status: "running", startedAt: now, plannedIds, cursor: 0, requestCount: 0, errorCount: 0 });
  return id;
}

export async function saveProgress(importDb, runId, { cursor, requestCount, errorCount, lastStatus = null }) {
  await importDb.update(fetchRuns).set({ cursor, requestCount, errorCount, lastStatus }).where(eq(fetchRuns.id, runId));
}

export async function finishRun(importDb, runId, { status, cursor, requestCount, errorCount, lastStatus = null, note = null, now = new Date() }) {
  await importDb.update(fetchRuns).set({ status, cursor, requestCount, errorCount, lastStatus, note, finishedAt: now }).where(eq(fetchRuns.id, runId));
}

export async function getRun(importDb, runId) {
  const [run] = await importDb.select().from(fetchRuns).where(eq(fetchRuns.id, runId));
  return run ?? null;
}

/** Seal an uploaded export into the import DB. The same bytes twice return the first id. */
export async function saveFile(importDb, { kind, bytes, now = new Date() }) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const [existing] = await importDb
    .select({ id: importFiles.id })
    .from(importFiles)
    .where(and(eq(importFiles.kind, kind), eq(importFiles.sha256, sha256)));
  if (existing) return existing.id;
  const id = createId();
  await importDb.insert(importFiles).values({ id, kind, sha256, content: encryptField(Buffer.from(bytes).toString("base64")), uploadedAt: now });
  return id;
}

export async function readFile(importDb, id) {
  const [row] = await importDb.select({ kind: importFiles.kind, content: importFiles.content }).from(importFiles).where(eq(importFiles.id, id));
  return row ? { kind: row.kind, bytes: Buffer.from(decryptField(row.content), "base64") } : null;
}

export async function saveParityReport(importDb, { target, clean, report, now = new Date() }) {
  const id = createId();
  await importDb.insert(parityReports).values({ id, target, clean, report, createdAt: now });
  return id;
}

/** The store bound to one import DB, as the fetcher, loader and parity report take it. */
export function rawStore(importDb) {
  return {
    upsert: (entity, records, runId) => upsertRecords(importDb, { entity, records, runId }),
    records: (entity) => readRecords(importDb, entity),
    index: (entity) => recordIndex(importDb, entity),
    startRun: (o) => startRun(importDb, o),
    saveProgress: (runId, p) => saveProgress(importDb, runId, p),
    finishRun: (runId, p) => finishRun(importDb, runId, p),
    getRun: (runId) => getRun(importDb, runId),
    saveFile: (o) => saveFile(importDb, o),
    readFile: (id) => readFile(importDb, id),
    saveParityReport: (o) => saveParityReport(importDb, o),
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/import`
Expected: PASS.

Run: `cd apps/api && pnpm import:db:generate`
Expected: "No schema changes, nothing to migrate".

- [ ] **Step 7: Commit**

```bash
git add apps/api/drizzle.import.config.js apps/api/package.json apps/api/src/import
git commit -m "feat(import): diamond_labs_import schema with its own drizzle config and migrations; sealed raw store

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Seazona service: status-carrying reads, one capped-list walker; guards allow only the fetcher

**Files:**
- Modify: `apps/api/src/services/seazona.service.js`
- Create: `apps/api/src/services/seazona-result-reads.test.js`
- Modify: `apps/api/src/routes/__tests__/seazona-invoice-retired.test.js`, `apps/api/src/routes/__tests__/seazona-order-retired.test.js`

**Interfaces:**
- Produces (all in `seazona.service.js`, all through `requestRaw` and its 50/min limiter; none throws):
  - `listClientsResult(lastModified = "") → { ok, status, clients }` (`listClients` now wraps it).
  - `listUsersResult() → { ok, status, users }`, `listProductsResult() → { ok, status, products }` (`listUsers` / `listProducts` wrap them).
  - `getInvoicesResult(lastModified) → { reachable, status, invoices }` (gains `status`).
  - `getAllInvoicesResult() → { reachable, status, invoices, requests, truncated }`.
  - `getOrdersResult(ordered) → { reachable, status, orders }`; `getAllOrdersResult() → { reachable, status, orders, requests, truncated }`.
  - `getInvoiceResult(id) → { ok, status, invoice }`, `getOrderResult(id) → { ok, status, order }`.
  - One internal `walkCapped(fetchPage, field)` serves invoices (`lastModified`) and orders (`ordered`).
- Guard contract: outside `seazona.service.js`, only `apps/api/src/import/seazona-fetch.js` (and its test) may name the invoice/order/user reads.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/seazona-result-reads.test.js`:

```js
import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";
process.env.SEAZONA_API_KEY ||= "test-key";
process.env.SEAZONA_SECRET ||= "test-secret";
process.env.SEAZONA_BASE_URL ||= "https://example.invalid/";
delete process.env.SEAZONA_DISABLED;

const seazona = await import("./seazona.service.js");
afterEach(() => { vi.unstubAllGlobals(); seazona.__resetRateLimiter(); });

const ok = (data) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => data, text: async () => "" });
const fail = (status) => ({ ok: false, status, headers: { get: () => null }, json: async () => null, text: async () => "API access is temporarily disabled for this host" });
const stub = (...responses) => {
  const f = vi.fn(async () => responses.shift());
  vi.stubGlobal("fetch", f);
  return f;
};
const query = (f, i, name) => new URL(f.mock.calls[i][0]).searchParams.get(name);
const minuteStamp = (i) => new Date(Date.UTC(2020, 0, 1) + i * 60_000).toISOString().slice(0, 19);

test("a single-record read reports its HTTP status: a 403 block is visible to the caller", async () => {
  stub(fail(403));
  assert.deepEqual(await seazona.getInvoiceResult("inv-1"), { ok: false, status: 403, invoice: null });
  stub(ok({ id: "ord-1", products: [] }));
  assert.deepEqual(await seazona.getOrderResult("ord-1"), { ok: true, status: 200, order: { id: "ord-1", products: [] } });
});

test("list reads report status and never throw", async () => {
  stub(fail(500));
  assert.deepEqual(await seazona.listClientsResult(""), { ok: false, status: 500, clients: [] });
  stub(ok([{ id: "u1" }]));
  assert.deepEqual(await seazona.listUsersResult(), { ok: true, status: 200, users: [{ id: "u1" }] });
});

test("the orders walk pages past the 10k cap by `ordered`", async () => {
  const page1 = Array.from({ length: 10_000 }, (_, i) => ({ id: `o${i}`, ordered: minuteStamp(i) }));
  const page2 = [{ id: "o9999", ordered: minuteStamp(9999) }, { id: "o10000", ordered: minuteStamp(10_000) }, { id: "o10001", ordered: minuteStamp(10_001) }];
  const f = stub(ok(page1), ok(page2));
  const r = await seazona.getAllOrdersResult();
  assert.equal(r.reachable, true);
  assert.equal(r.requests, 2);
  assert.equal(r.orders.length, 10_002, "the overlapping row is de-duped by id");
  assert.equal(query(f, 0, "ordered"), "1900-01-01T00:00:00Z");
  assert.equal(query(f, 1, "ordered"), minuteStamp(9999));
});

test("a bulk-restamped capped page advances by one second", async () => {
  const stamped = Array.from({ length: 10_000 }, (_, i) => ({ id: `i${i}`, lastModified: "2025-11-29T15:05:50" }));
  const f = stub(ok(stamped), ok([{ id: "late", lastModified: "2026-01-02T00:00:00" }]));
  const r = await seazona.getAllInvoicesResult();
  assert.equal(r.invoices.length, 10_001);
  assert.equal(query(f, 1, "lastModified"), "2025-11-29T15:05:51Z");
});

test("a walk that hits a block stops and reports it", async () => {
  const page1 = Array.from({ length: 10_000 }, (_, i) => ({ id: `i${i}`, lastModified: minuteStamp(i) }));
  stub(ok(page1), fail(403));
  const r = await seazona.getAllInvoicesResult();
  assert.equal(r.reachable, false);
  assert.equal(r.status, 403);
  assert.equal(r.requests, 2);
});
```

In `apps/api/src/routes/__tests__/seazona-invoice-retired.test.js`:
- Replace the header comment's last sentence ("when that import lands, add its file to ALLOWED by name") with "Piece 5's fetcher (import/seazona-fetch.js) is the one allowed reader."
- `const ALLOWED = new Set(["apps/api/src/services/seazona.service.js", "apps/api/src/import/seazona-fetch.js"]);`
- Add to `FORBIDDEN`: `/\bgetInvoiceResult\b/, /\blistUsers(Result)?\b/,`
- Add to the negative test's `samples`: `"getInvoiceResult(1)", "listUsers()", "listUsersResult()",`

In `apps/api/src/routes/__tests__/seazona-order-retired.test.js`:
- Replace the comment's last sentence with "Seazona reads (getOrders/getOrder and the *Result forms) stay in seazona.service.js for piece 5; only the fetcher may call them."
- After `const SELF = …`, add:

```js
// The service itself, piece 5's fetcher, and the two tests that exercise them.
const ALLOWED = new Set([
  "apps/api/src/services/seazona.service.js",
  "apps/api/src/services/seazona-result-reads.test.js",
  "apps/api/src/import/seazona-fetch.js",
  "apps/api/src/import/seazona-fetch.test.js",
]);
```

- Add to `FORBIDDEN`: `/\bgetOrdersResult\b/, /\bgetAllOrdersResult\b/, /\bgetOrderResult\b/,`
- In the scan loop, skip allowed files: compute `const rel = relative(repo, file);`, `if (ALLOWED.has(rel)) continue;` before reading, and use `rel` in the hit message.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/seazona-result-reads.test.js src/routes/__tests__/seazona-invoice-retired.test.js src/routes/__tests__/seazona-order-retired.test.js`
Expected: the new reads test FAILS (functions missing); the two guards still PASS (nothing uses the new names yet).

- [ ] **Step 3: Implement the reads and the walker**

In `apps/api/src/services/seazona.service.js`:

Replace `listClients` with:

```js
/**
 * Clients, with the call's HTTP status (piece 5's fetcher needs to see a 403).
 * The Seazona API requires the `lastModified` query param to be present (empty
 * string returns everything).
 */
export async function listClientsResult(lastModified = "") {
  const r = await requestRaw(`v1/clients/?lastModified=${encodeURIComponent(lastModified)}`);
  return { ok: r.ok, status: r.status, clients: Array.isArray(r.data) ? r.data : [] };
}

/** List all clients ([] on any failure). */
export async function listClients(lastModified = "") {
  return (await listClientsResult(lastModified)).clients;
}
```

Replace `getInvoicesResult` with:

```js
/**
 * Like getInvoices but reports reachability and status: `reachable` is false
 * when the call errored (non-2xx / network), letting callers tell "Seazona is
 * down" (or blocked: status 403) apart from "Seazona returned an empty list".
 */
export async function getInvoicesResult(lastModified) {
  const since = lastModified || "1900-01-01T00:00:00Z";
  const r = await requestRaw(`v1/invoices/?lastModified=${encodeURIComponent(since)}`);
  return { reachable: r.data !== null, status: r.status, invoices: Array.isArray(r.data) ? r.data : [] };
}
```

Replace `INVOICE_PAGE_CAP`, the `getAllInvoices` doc comment, and `getAllInvoicesResult` with (keep `bumpOneSecond` as it is):

```js
const LIST_PAGE_CAP = 10000;

/**
 * Walk a capped Seazona list (the invoice and order lists truncate at 10,000
 * rows sorted by id) forward by `field`. The invoice archive was bulk-restamped
 * to a single lastModified, so a capped page that shares one value advances by
 * one second. De-dupes by id. `truncated` means a capped page gave no cursor to
 * advance by (the set is incomplete; never treat it as whole).
 */
async function walkCapped(fetchPage, field) {
  const seen = new Map();
  let cursor = "1900-01-01T00:00:00Z";
  let reachable = true;
  let truncated = false;
  let status = 200;
  let requests = 0;
  for (let i = 0; i < 50; i++) {
    const page = await fetchPage(cursor);
    requests += 1;
    status = page.status;
    if (!page.reachable) { reachable = false; break; }
    if (!page.records.length) break;
    for (const rec of page.records) seen.set(rec.id, rec);
    if (page.records.length < LIST_PAGE_CAP) break;
    const values = page.records.map((rec) => rec[field]).filter((v) => typeof v === "string");
    if (values.length === 0) { truncated = true; break; }
    const max = values.reduce((m, v) => (v > m ? v : m));
    const next = page.records.every((rec) => rec[field] === max) ? bumpOneSecond(max) : max;
    if (next === cursor) { truncated = true; break; }
    cursor = next;
  }
  return { reachable, status, records: [...seen.values()], requests, truncated };
}

/** The FULL invoice archive past the 10k cap (see walkCapped). */
export async function getAllInvoices() {
  return (await getAllInvoicesResult()).invoices;
}

/**
 * getAllInvoices + reachability. `reachable` is false if ANY page failed (the
 * set may be incomplete; `status` is that page's), distinguishing a true empty
 * archive from an outage or a block.
 */
export async function getAllInvoicesResult() {
  const w = await walkCapped(async (cursor) => {
    const r = await getInvoicesResult(cursor);
    return { reachable: r.reachable, status: r.status, records: r.invoices };
  }, "lastModified");
  return { reachable: w.reachable, status: w.status, invoices: w.records, requests: w.requests, truncated: w.truncated };
}
```

Directly after `getInvoice`, add:

```js
/** One invoice (with its lines) and the call's status. Piece 5's fetcher only. */
export async function getInvoiceResult(id) {
  const r = await requestRaw(`v1/invoices/${encodeURIComponent(id)}`);
  return { ok: r.ok, status: r.status, invoice: r.data };
}
```

Replace `getOrders` (keep its two comment lines above it) with:

```js
export async function getOrdersResult(ordered) {
  const since = ordered || "1900-01-01T00:00:00Z";
  const r = await requestRaw(`v1/orders/?ordered=${encodeURIComponent(since)}`);
  return { reachable: r.data !== null, status: r.status, orders: Array.isArray(r.data) ? r.data : [] };
}

export async function getOrders(ordered) {
  return (await getOrdersResult(ordered)).orders;
}

/** Every order, walked past a possible 10k cap by `ordered` (see walkCapped). Piece 5's fetcher only. */
export async function getAllOrdersResult() {
  const w = await walkCapped(async (cursor) => {
    const r = await getOrdersResult(cursor);
    return { reachable: r.reachable, status: r.status, records: r.orders };
  }, "ordered");
  return { reachable: w.reachable, status: w.status, orders: w.records, requests: w.requests, truncated: w.truncated };
}
```

After `getOrder`, add:

```js
/** One order (products, files, settings) and the call's status. Piece 5's fetcher only. */
export async function getOrderResult(id) {
  const r = await requestRaw(`v1/orders/${encodeURIComponent(id)}`);
  return { ok: r.ok, status: r.status, order: r.data };
}
```

Replace `listProducts` and `listUsers` with:

```js
export async function listProductsResult() {
  const r = await requestRaw("v1/products/");
  return { ok: r.ok, status: r.status, products: Array.isArray(r.data) ? r.data : [] };
}

/**
 * List all Seazona products ({ id, code, name, taxable, price }).
 * Used to map our catalog SKUs / Rx devices to Seazona product ids.
 */
export async function listProducts() {
  return (await listProductsResult()).products;
}

export async function listUsersResult() {
  const r = await requestRaw("v1/users/");
  return { ok: r.ok, status: r.status, users: Array.isArray(r.data) ? r.data : [] };
}

/**
 * List Seazona users (lab staff: { id, firstName, lastName, email }).
 * Kept for piece 5's raw archive (the fetcher reads listUsersResult).
 */
export async function listUsers() {
  return (await listUsersResult()).users;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/services/seazona src/routes/__tests__`
Expected: PASS, including the existing `seazona-disabled`, `seazona-enabled`, `seazona-rate-limit` and `seazona-access` tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/seazona.service.js apps/api/src/services/seazona-result-reads.test.js apps/api/src/routes/__tests__/seazona-invoice-retired.test.js apps/api/src/routes/__tests__/seazona-order-retired.test.js
git commit -m "feat(seazona): status-carrying reads and one capped-list walker for the piece-5 fetcher

Guards allow only import/seazona-fetch.js to call them.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Export parser: the portal's HTML-table `.xls` with column mapping

**Files:**
- Create: `apps/api/src/import/export-table.js`, `apps/api/src/import/export-table.test.js`
- Create: `apps/api/test-fixtures/seazona/invoices-export.xls`, `apps/api/test-fixtures/seazona/statements-export.xls`

**Interfaces:**
- Consumes: `parseMoneyInput` (`@my-app/shared`), `ImportRefusal` (Task 5).
- Produces:
  - `EXPORT_KINDS` (`invoice`: columns `invoice`, `balance`; `client`: columns `account`, `balance`, each with default header aliases).
  - `exportText(bytes) → string` (UTF-16 LE/BE with BOM, UTF-8 with or without BOM).
  - `htmlTableRows(html) → string[][]` (every `<tr>`'s `<td>`/`<th>` texts; tolerant of missing closing tags).
  - `exportCents(text) → integer cents | null` (`$1,234.56`, `-12.00`, `(12.00)`; null for blank or junk).
  - `parseColumnsFlag("balance=Amount Due,account=Acct #") → { balance: ["Amount Due"], account: ["Acct #"] }`.
  - `readExport(bytes, { kind, columns }) → { rows: [{ key, cents, line }], problems: [{ line, reason }], headerLine }`. For `invoice`, `key` is the invoice number (integer); for `client`, the account number (string). Problems carry the row number and a reason, never cell text.

- [ ] **Step 1: Write the fixtures**

These are synthetic and modelled on the ASP.NET "Export to Excel" output (an HTML table served as `.xls`). The real columns are confirmed when the lab produces the first export; `--columns` covers a rename without a code change.

`apps/api/test-fixtures/seazona/invoices-export.xls`:

```html
<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>
<body>
<table border="1">
<tr><td colspan="5">Invoices &amp; Payments — Open balances</td></tr>
<tr><th>Invoice #</th><th>Account</th><th>Client</th><th>Total</th><th>Open Balance</th></tr>
<tr><td>11114</td><td>1324</td><td>Example Dental</td><td>$1,250.00</td><td>$1,250.00</td></tr>
<tr><td>11115</td><td>1324</td><td>Example Dental</td><td>$300.00</td><td>$120.50</td></tr>
<tr><td>11120</td><td>2001</td><td>Sample Ortho &amp; Co</td><td>$80.00</td><td>(20.00)</td></tr>
<tr><td>11121</td><td>2001</td><td>Sample Ortho &amp; Co</td><td>$95.00</td><td>&nbsp;</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td>Total</td><td></td><td></td><td>$1,725.00</td><td>$1,350.50</td></tr>
</table>
</body></html>
```

`apps/api/test-fixtures/seazona/statements-export.xls`:

```html
<table>
<tr><th>Account #</th><th>Client</th><th>Previous Balance</th><th>Payments</th><th>Amount Due</th></tr>
<tr><td>1324</td><td>Example Dental</td><td>$900.00</td><td>$0.00</td><td>$1,370.50</td></tr>
<tr><td>2001</td><td>Sample Ortho &amp; Co</td><td>$0.00</td><td>$20.00</td><td>-20.00</td></tr>
<tr><td>3005</td><td>Placeholder Clinic</td><td>$0.00</td><td>$0.00</td><td>$0.00</td></tr>
<tr><td>Total</td><td></td><td></td><td></td><td>$1,350.50</td></tr>
</table>
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/import/export-table.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exportText, htmlTableRows, exportCents, parseColumnsFlag, readExport } from "./export-table.js";
import { ImportRefusal } from "./import-errors.js";

const fixture = (name) => readFileSync(new URL(`../../test-fixtures/seazona/${name}`, import.meta.url));

test("money cells: dollars, thousands, negatives in both spellings; blank and junk are null", () => {
  assert.equal(exportCents("$1,234.56"), 123456);
  assert.equal(exportCents(" 12 "), 1200);
  assert.equal(exportCents("-20.00"), -2000);
  assert.equal(exportCents("(20.00)"), -2000);
  assert.equal(exportCents("$(5.10)"), -510);
  assert.equal(exportCents(""), null);
  assert.equal(exportCents("n/a"), null);
  assert.equal(exportCents("1.234"), null, "more than two decimals is not money");
});

test("UTF-16 (with BOM) and UTF-8 (with BOM) both decode", () => {
  const html = "<table><tr><td>é</td></tr></table>";
  assert.equal(exportText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(html, "utf16le")])), html);
  assert.equal(exportText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(html, "utf8")])), html);
  const be = Buffer.from(html, "utf16le").swap16();
  assert.equal(exportText(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), html);
});

test("rows survive missing closing tags, attributes, entities and nested markup", () => {
  const rows = htmlTableRows('<table><tr class="h"><th>A<th>B</tr><tr><td><b>1</b>&nbsp;<td>Smith &amp; Co<tr><td>&#36;5</td></table>');
  assert.deepEqual(rows, [["A", "B"], ["1", "Smith & Co"], ["$5"]]);
});

test("per-invoice export: header found below a title row, open balances in cents, problems by row", () => {
  const { rows, problems, headerLine } = readExport(fixture("invoices-export.xls"), { kind: "invoice" });
  assert.equal(headerLine, 2);
  assert.deepEqual(rows.map((r) => [r.key, r.cents]), [[11114, 125000], [11115, 12050], [11120, -2000]]);
  assert.deepEqual(problems.map((p) => p.line), [6, 8], "the blank-balance row and the Total row");
  assert.ok(problems.every((p) => !/Example|Sample/.test(p.reason)), "problems never echo cell text");
});

test("per-client export: Amount Due is the balance, not Previous Balance", () => {
  const { rows } = readExport(fixture("statements-export.xls"), { kind: "client" });
  assert.deepEqual(rows.map((r) => [r.key, r.cents]), [["1324", 137050], ["2001", -2000], ["3005", 0]]);
});

test("a duplicate key is a problem, not a second row", () => {
  const html = "<table><tr><th>Invoice #</th><th>Open Balance</th></tr><tr><td>1</td><td>5</td></tr><tr><td>1</td><td>6</td></tr></table>";
  const { rows, problems } = readExport(Buffer.from(html), { kind: "invoice" });
  assert.equal(rows.length, 1);
  assert.match(problems[0].reason, /duplicate of row 2/);
});

test("renamed columns: a missing header is refused; --columns maps it", () => {
  const html = "<table><tr><th>Inv No</th><th>Still Owed</th></tr><tr><td>7</td><td>$1.00</td></tr></table>";
  assert.throws(() => readExport(Buffer.from(html), { kind: "invoice" }), ImportRefusal);
  const { rows } = readExport(Buffer.from(html), { kind: "invoice", columns: parseColumnsFlag("invoice=Inv No,balance=Still Owed") });
  assert.deepEqual(rows, [{ key: 7, cents: 100, line: 2 }]);
  assert.throws(() => parseColumnsFlag("nonsense"), /name="Header"/);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/import/export-table.test.js`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement**

Create `apps/api/src/import/export-table.js`:

```js
import { parseMoneyInput } from "@my-app/shared";
import { ImportRefusal } from "./import-errors.js";

/**
 * The Seazona portal's "Export to Excel" is an HTML <table> saved as .xls.
 * This reads it in memory (the file itself is sealed into the import DB by
 * the caller and never logged): find the header row by column name, then turn
 * every data row into { key, cents } or a { line, reason } problem. Column
 * names are matched exactly (case and punctuation folded); `--columns`
 * overrides them when the lab's export differs.
 */
export const EXPORT_KINDS = {
  invoice: {
    key: "invoice",
    columns: {
      invoice: ["invoice #", "invoice", "invoice no", "invoice number", "inv #", "inv no"],
      balance: ["open balance", "balance due", "balance", "amount due", "outstanding"],
    },
  },
  client: {
    key: "account",
    columns: {
      account: ["account #", "account", "account no", "account number", "acct #", "acct"],
      balance: ["amount due", "balance due", "current balance", "balance", "total due"],
    },
  },
};

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const cellText = (html) =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")).replace(/[\s ]+/g, " ").trim();

/** Bytes → text: UTF-16 LE/BE when a BOM says so, else UTF-8 (BOM dropped). */
export function exportText(bytes) {
  const b = Buffer.from(bytes);
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString("utf16le");
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString("utf16le");
  const t = b.toString("utf8");
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

/** Every <tr>'s cell texts, <th> and <td> alike. Closing tags are optional. */
export function htmlTableRows(html) {
  const text = String(html).replace(/<!--[\s\S]*?-->/g, "");
  const rows = [];
  for (const tr of text.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)].map((m) => cellText(m[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/** A money cell → integer cents; null when blank or not an amount. */
export function exportCents(text) {
  let s = String(text ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1];
  }
  const cents = parseMoneyInput(s, { allowNegative: !negative });
  if (cents == null) return null;
  return negative ? -cents : cents;
}

/** `name=Header,name2=Header 2` → { name: ["Header"], name2: ["Header 2"] }. */
export function parseColumnsFlag(value) {
  const out = {};
  for (const part of String(value ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^([a-z]+)=(.+)$/.exec(part);
    if (!m) throw new ImportRefusal(`--columns takes name="Header" pairs separated by commas (got a part without "=").`);
    out[m[1]] = [m[2].trim()];
  }
  return out;
}

const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

function findHeader(rows, aliases) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(fold);
    const at = {};
    for (const [name, names] of Object.entries(aliases)) {
      const idx = names.map(fold).map((n) => cells.indexOf(n)).find((x) => x >= 0);
      if (idx === undefined) break;
      at[name] = idx;
    }
    if (Object.keys(at).length === Object.keys(aliases).length) return { index: i, at };
  }
  return null;
}

const invoiceKey = (t) => {
  const s = String(t ?? "").replace(/^#/, "").trim();
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
};
const accountKey = (t) => {
  const s = String(t ?? "").trim();
  return s && /\d/.test(s) && s.length <= 100 ? s : null;
};

export function readExport(bytes, { kind, columns = {} }) {
  const spec = EXPORT_KINDS[kind];
  if (!spec) throw new ImportRefusal(`Unknown export kind "${kind}" (invoice or client).`);
  const aliases = { ...spec.columns, ...columns };
  const rows = htmlTableRows(exportText(bytes));
  const header = findHeader(rows, aliases);
  if (!header) {
    throw new ImportRefusal(`No header row with the ${Object.keys(aliases).join(" and ")} columns in the first 15 rows. Open the export, read its column names, and pass --columns ${Object.keys(aliases).map((n) => `${n}="Header"`).join(",")}.`);
  }
  const out = [];
  const problems = [];
  const seen = new Map();
  for (let i = header.index + 1; i < rows.length; i++) {
    const line = i + 1;
    const keyText = rows[i][header.at[spec.key]] ?? "";
    const balanceText = rows[i][header.at.balance] ?? "";
    if (!keyText && !balanceText) continue; // spacer row
    const key = kind === "invoice" ? invoiceKey(keyText) : accountKey(keyText);
    if (key == null) {
      problems.push({ line, reason: `no ${spec.key} number (a total or note row?)` });
      continue;
    }
    const cents = exportCents(balanceText);
    if (cents == null) {
      problems.push({ line, reason: "the balance is blank or not an amount" });
      continue;
    }
    if (seen.has(key)) {
      problems.push({ line, reason: `duplicate of row ${seen.get(key)}` });
      continue;
    }
    seen.set(key, line);
    out.push({ key, cents, line });
  }
  return { rows: out, problems, headerLine: header.index + 1 };
}
```

`line` is the 1-based row index across every `<tr>` in the file (the title row counts), which is what someone counting rows in the opened spreadsheet sees.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/import/export-table.test.js`
Expected: PASS. (The per-invoice fixture's rows: 1 title, 2 header, 3–5 data, 6 blank balance → problem, 7 spacer → skipped silently, 8 Total → problem.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/import/export-table.js apps/api/src/import/export-table.test.js apps/api/test-fixtures/seazona
git commit -m "feat(import): parse the Seazona portal's HTML-table .xls exports into cents

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Fetcher: plan, record vocabulary, runner (stop on block, resume), `import:fetch` CLI

**Files:**
- Create: `apps/api/src/import/seazona-records.js`, `apps/api/src/import/seazona-records.test.js`
- Create: `apps/api/src/import/fetch-plan.js`, `apps/api/src/import/fetch-plan.test.js`
- Create: `apps/api/src/import/seazona-fetch.js`, `apps/api/src/import/seazona-fetch.test.js`
- Create: `apps/api/src/import/report.js`, `apps/api/src/import/fetch-cli.js`
- Modify: `apps/api/package.json` (script `import:fetch`)

**Interfaces:**
- Consumes: Task 5 (`parseArgs`, `intFlag`, `listFlag`, `ImportRefusal`, `assertNotCloudRun`, `resolveImportDb`, `connect`, `assertImportKey`), Task 6 (`rawStore`, import schema), Task 7 (the `*Result` reads), Task 8 (`readExport`, `parseColumnsFlag`).
- Produces:
  - `seazona-records.js` (what Seazona's fields mean; used by the fetcher, the mappers and parity): `invoiceStatusFor(status) → "issued"|"void"`, `orderStatusFor(status) → { status, heldFrom } | null`, `isOpenOrderStatus(status) → boolean`, `recordDate(entity, payload) → "YYYY-MM-DD"|null`, `firstString(obj, keys) → string|null`, `recordNumber(payload, keys) → positive safe integer|null`, `INVOICE_NUMBER_FIELDS`, `ORDER_NUMBER_FIELDS`.
  - `fetch-plan.js`: `REQUESTS_PER_MINUTE = 50`, `APPROVAL_THRESHOLD = 100`, `SUMMARY_ENTITIES`, `DETAIL_ENTITIES`, `minutesFor(n)`, `summaryRequests(entity, storedCount)`, `detailFilterProblem(filters) → string|null`, `selectDetailIds(entity, summaries, fetchedIndex, filters) → string[]` (sorted), `approvalProblem({ count, live, approved }) → string|null`.
  - `seazona-fetch.js`: `fetchSummaries({ entity, seazona, store })`, `fetchDetails({ entity, ids, start, runId, seazona, store, lastModifiedById, prior })`, `runSummaryCommand({ entity, live, approved, seazona, store })`, `runDetailCommand({ entity, ids, start, run, live, approved, seazona, store, lastModifiedById })`. Results: `{ plan: { requests, minutes }, dryRun?, refused?, runId?, result? }`; `result.status` is `done | blocked | failed`.
  - `report.js`: `printLines(lines)`, `printReport(obj)`, `runCli(main)` (ImportRefusal → exit 2; other errors → code + message only, exit 1).
  - Script: `import:fetch`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/import/seazona-records.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { invoiceStatusFor, orderStatusFor, isOpenOrderStatus, recordDate, recordNumber, firstString, INVOICE_NUMBER_FIELDS } from "./seazona-records.js";

test("a Seazona invoice is void only for a void or cancel state; every workflow state is issued", () => {
  for (const s of ["Void", " voided ", "Cancelled", "CANCELED", "Deleted"]) assert.equal(invoiceStatusFor(s), "void", s);
  for (const s of ["Shipped", "Hold", "In Production", "", null]) assert.equal(invoiceStatusFor(s), "issued", String(s));
});

test("order workflow states map to board statuses; an unknown state is null, never guessed", () => {
  assert.deepEqual(orderStatusFor("In Production"), { status: "in_production", heldFrom: null });
  assert.deepEqual(orderStatusFor("Hold"), { status: "on_hold", heldFrom: "in_production" });
  assert.deepEqual(orderStatusFor("shipped"), { status: "shipped", heldFrom: null });
  assert.deepEqual(orderStatusFor("Ready_To_Ship"), { status: "ready_to_ship", heldFrom: null });
  assert.equal(orderStatusFor("Invoiced"), null);
  assert.equal(orderStatusFor(undefined), null);
  assert.equal(isOpenOrderStatus("Hold"), true);
  assert.equal(isOpenOrderStatus("Shipped"), false);
  assert.equal(isOpenOrderStatus("Mystery"), false, "an unknown state is not fetched as open");
});

test("dates, numbers and strings are read defensively", () => {
  assert.equal(recordDate("invoice", { due: "2026-03-01T00:00:00", date: "2026-02-01T09:00:00" }), "2026-02-01");
  assert.equal(recordDate("invoice", { due: "2026-03-01" }), "2026-03-01");
  assert.equal(recordDate("order", { ordered: "nope" }), null);
  assert.equal(recordNumber({ invoiceNumber: "11114" }, INVOICE_NUMBER_FIELDS), 11114);
  assert.equal(recordNumber({ invoiceNumber: 11114 }, INVOICE_NUMBER_FIELDS), 11114);
  assert.equal(recordNumber({ invoiceNumber: "INV-7" }, INVOICE_NUMBER_FIELDS), null);
  assert.equal(recordNumber({ invoiceNumber: "0" }, INVOICE_NUMBER_FIELDS), null);
  assert.equal(firstString({ a: "  ", b: " x " }, ["a", "b"]), "x");
});
```

Create `apps/api/src/import/fetch-plan.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { minutesFor, summaryRequests, selectDetailIds, approvalProblem, detailFilterProblem } from "./fetch-plan.js";

const inv = (id, extra = {}) => ({ seazonaId: id, lastModified: "2026-10-01T00:00:00", payload: { id, invoiceNumber: Number(id.slice(1)), ...extra } });

test("request counts and minutes at the service's 50/min", () => {
  assert.equal(minutesFor(0), 0);
  assert.equal(minutesFor(51), 2);
  assert.equal(summaryRequests("client", 0), 1);
  assert.equal(summaryRequests("invoice", 16_000), 2);
  assert.equal(summaryRequests("invoice", 0), 1);
});

test("a live run over 100 requests needs --approved of at least the count", () => {
  assert.equal(approvalProblem({ count: 400, live: false }), null, "a dry run is never refused");
  assert.match(approvalProblem({ count: 400, live: true }), /--approved 400/);
  assert.match(approvalProblem({ count: 400, live: true, approved: 399 }), /--approved 400/);
  assert.equal(approvalProblem({ count: 400, live: true, approved: 400 }), null);
  assert.equal(approvalProblem({ count: 100, live: true }), null);
});

test("a detail fetch needs an explicit filter", () => {
  assert.match(detailFilterProblem({}), /needs a filter/);
  assert.match(detailFilterProblem({ since: "10/01/2026" }), /YYYY-MM-DD/);
  assert.equal(detailFilterProblem({ since: "2025-10-21" }), null);
});

test("filters select by date, open order state, open-balance invoice number and explicit id", () => {
  const invoices = [inv("i1", { date: "2025-01-01" }), inv("i2", { date: "2026-02-01" }), inv("i3", { due: "2026-05-01" })];
  assert.deepEqual(selectDetailIds("invoice", invoices, new Map(), { since: "2026-01-01" }), ["i2", "i3"]);
  assert.deepEqual(selectDetailIds("invoice", invoices, new Map(), { openInvoiceNumbers: new Set([1]) }), ["i1"]);
  assert.deepEqual(selectDetailIds("invoice", invoices, new Map(), { ids: ["zz", "i1"] }), ["i1", "zz"]);
  const orders = [{ seazonaId: "o1", payload: { status: "Hold" } }, { seazonaId: "o2", payload: { status: "Shipped" } }];
  assert.deepEqual(selectDetailIds("order", orders, new Map(), { open: true }), ["o1"]);
});

test("a fresh detail is skipped unless --refetch; a newer summary re-fetches", () => {
  const invoices = [inv("i1", { date: "2026-02-01" }), { ...inv("i2", { date: "2026-02-01" }), lastModified: "2026-10-20T00:00:00" }];
  const fetched = new Map([["i1", "2026-10-01T00:00:00"], ["i2", "2026-10-01T00:00:00"]]);
  assert.deepEqual(selectDetailIds("invoice", invoices, fetched, { since: "2026-01-01" }), ["i2"]);
  assert.deepEqual(selectDetailIds("invoice", invoices, fetched, { since: "2026-01-01", refetch: true }), ["i1", "i2"]);
});
```

Create `apps/api/src/import/seazona-fetch.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fetchSummaries, runSummaryCommand, runDetailCommand } from "./seazona-fetch.js";

// A fake seazona.service: records every call; `detail(id, n)` scripts each answer.
function fakeSeazona({ detail = () => ({ ok: true, status: 200, record: { id: "x" } }), invoices = [] } = {}) {
  const calls = [];
  const answer = (id) => {
    calls.push(id);
    return detail(id, calls.length);
  };
  return {
    calls,
    getInvoiceResult: async (id) => { const a = answer(id); return { ok: a.ok, status: a.status, invoice: a.record ?? null }; },
    getOrderResult: async (id) => { const a = answer(id); return { ok: a.ok, status: a.status, order: a.record ?? null }; },
    getAllInvoicesResult: async () => { calls.push("list"); return { reachable: true, status: 200, invoices, requests: 2, truncated: false }; },
    listClientsResult: async () => { calls.push("clients"); return { ok: false, status: 500, clients: [] }; },
  };
}

function fakeStore() {
  const recs = new Map();
  const runs = new Map();
  return {
    recs,
    runs,
    upsert: async (entity, records) => { for (const r of records) recs.set(`${entity}:${r.seazonaId}`, r); return records.length; },
    index: async (entity) => new Map([...recs].filter(([k]) => k.startsWith(`${entity}:`)).map(([, r]) => [r.seazonaId, r.lastModified ?? null])),
    startRun: async (o) => { const id = `run${runs.size + 1}`; runs.set(id, { id, ...o, cursor: 0, status: "running" }); return id; },
    saveProgress: async (id, p) => Object.assign(runs.get(id), p),
    finishRun: async (id, p) => Object.assign(runs.get(id), p),
    getRun: async (id) => runs.get(id) ?? null,
  };
}

const ids = Array.from({ length: 5 }, (_, i) => `inv${i}`);

test("a dry run makes no Seazona call and reports the plan", async () => {
  const seazona = fakeSeazona();
  const out = await runDetailCommand({ entity: "invoice_detail", ids, live: false, seazona, store: fakeStore() });
  assert.deepEqual(out.plan, { requests: 5, minutes: 1 });
  assert.equal(out.dryRun, true);
  assert.equal(seazona.calls.length, 0);
  const summary = await runSummaryCommand({ entity: "invoice", live: false, seazona, store: fakeStore() });
  assert.equal(summary.dryRun, true);
  assert.equal(seazona.calls.length, 0);
});

test("over 100 requests without approval: refused before any call", async () => {
  const seazona = fakeSeazona();
  const many = Array.from({ length: 101 }, (_, i) => `i${i}`);
  const out = await runDetailCommand({ entity: "invoice_detail", ids: many, live: true, seazona, store: fakeStore() });
  assert.match(out.refused, /--approved 101/);
  assert.equal(seazona.calls.length, 0);
});

test("a 403 stops the run at once: no further call, cursor kept, fetched records kept", async () => {
  const seazona = fakeSeazona({ detail: (id, n) => (n === 3 ? { ok: false, status: 403 } : { ok: true, status: 200, record: { id } }) });
  const store = fakeStore();
  const out = await runDetailCommand({ entity: "invoice_detail", ids, live: true, seazona, store });
  assert.equal(out.result.status, "blocked");
  assert.equal(out.result.cursor, 2);
  assert.deepEqual(seazona.calls, ["inv0", "inv1", "inv2"]);
  assert.equal([...store.recs.keys()].length, 2);
  const run = store.runs.get(out.runId);
  assert.equal(run.status, "blocked");
  assert.equal(run.lastStatus, 403);
  assert.deepEqual(run.plannedIds, ids);
});

test("resume starts exactly at the cursor and carries the counts on", async () => {
  const store = fakeStore();
  const first = await runDetailCommand({ entity: "invoice_detail", ids, live: true, store,
    seazona: fakeSeazona({ detail: (id, n) => (n === 3 ? { ok: false, status: 403 } : { ok: true, status: 200, record: { id } }) }) });
  const run = await store.getRun(first.runId);
  const seazona = fakeSeazona();
  const out = await runDetailCommand({ entity: "invoice_detail", ids: run.plannedIds, start: run.cursor, run, live: true, seazona, store });
  assert.deepEqual(seazona.calls, ["inv2", "inv3", "inv4"]);
  assert.equal(out.result.status, "done");
  assert.equal(store.runs.get(first.runId).requestCount, 6, "3 before the block + 3 after");
});

test("a 404 for one record is skipped and counted; anything else stops", async () => {
  const seazona = fakeSeazona({ detail: (id) => (id === "inv1" ? { ok: false, status: 404 } : { ok: true, status: 200, record: { id } }) });
  const out = await runDetailCommand({ entity: "invoice_detail", ids, live: true, seazona, store: fakeStore() });
  assert.equal(out.result.status, "done");
  assert.deepEqual(out.result.missing, ["inv1"]);
  assert.equal(seazona.calls.length, 5);

  const off = fakeSeazona({ detail: () => ({ ok: false, status: 0 }) });
  const stopped = await runDetailCommand({ entity: "invoice_detail", ids, live: true, seazona: off, store: fakeStore() });
  assert.equal(stopped.result.status, "failed");
  assert.equal(off.calls.length, 1, "SEAZONA_DISABLED / network: stop at the first failure");
});

test("summaries: stored with their lastModified; a failed list stores nothing", async () => {
  const store = fakeStore();
  const seazona = fakeSeazona({ invoices: [{ id: "a", lastModified: "2026-10-01T00:00:00" }, { id: "b" }, { noId: true }] });
  const r = await fetchSummaries({ entity: "invoice", seazona, store });
  assert.equal(r.status, "done");
  assert.equal(r.count, 2);
  assert.equal(r.requests, 2);
  assert.equal(store.recs.get("invoice:a").lastModified, "2026-10-01T00:00:00");
  const failed = await fetchSummaries({ entity: "client", seazona, store: fakeStore() });
  assert.equal(failed.status, "failed");
  assert.equal(failed.count, 0);
});

test("in src/import, only fetch-cli.js imports seazona.service.js, and nothing imports config/database.js", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    if (f !== "fetch-cli.js") assert.doesNotMatch(src, /services\/seazona\.service\.js/, f);
    assert.doesNotMatch(src, /config\/database\.js/, f);
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/import/seazona-records.test.js src/import/fetch-plan.test.js src/import/seazona-fetch.test.js`
Expected: FAIL (modules missing).

- [ ] **Step 3: Seazona record vocabulary**

Create `apps/api/src/import/seazona-records.js`:

```js
/**
 * What Seazona's fields mean, in one place: status tables, and defensive
 * readers for fields whose exact names the live payloads confirm at rehearsal
 * (the fixtures in test-fixtures/seazona are built from the documented shapes).
 * A rehearsal that finds a new status or field name changes THIS file, and
 * the fixture, in the same commit.
 */
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");

const VOID_INVOICE_STATES = new Set(["void", "voided", "cancelled", "canceled", "deleted"]);

/** An invoice's `status` is a production workflow state; only a void/cancel state voids it. */
export const invoiceStatusFor = (status) => (VOID_INVOICE_STATES.has(norm(status)) ? "void" : "issued");

const ORDER_STATES = {
  "new": "received", "received": "received", "entered": "received", "pending": "received", "open": "received",
  "in production": "in_production", "production": "in_production", "in progress": "in_production",
  "quality check": "quality_check", "qc": "quality_check",
  "ready": "ready_to_ship", "ready to ship": "ready_to_ship",
  "hold": "on_hold", "on hold": "on_hold",
  "shipped": "shipped", "delivered": "shipped", "complete": "shipped", "completed": "shipped",
  "cancelled": "cancelled", "canceled": "cancelled", "void": "cancelled", "voided": "cancelled", "deleted": "cancelled",
};

/** Seazona order state → { status, heldFrom }; null when unknown (reported, and a live load refuses). */
export function orderStatusFor(state) {
  const status = ORDER_STATES[norm(state)];
  if (!status) return null;
  return { status, heldFrom: status === "on_hold" ? "in_production" : null };
}

export function isOpenOrderStatus(state) {
  const m = orderStatusFor(state);
  return m !== null && m.status !== "shipped" && m.status !== "cancelled";
}

const DATE_FIELDS = {
  invoice: ["date", "invoiceDate", "created", "createdAt", "due"],
  order: ["ordered", "orderDate", "created", "createdAt"],
};

/** The record's own date as "YYYY-MM-DD" (an invoice falls back to its due date); null when none. */
export function recordDate(entity, payload) {
  for (const k of DATE_FIELDS[entity] ?? []) {
    const v = payload?.[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

export function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export const INVOICE_NUMBER_FIELDS = ["invoiceNumber", "number"];
export const ORDER_NUMBER_FIELDS = ["orderNumber", "number"];

/** A record's business number as a positive safe integer; null when absent or not numeric. */
export function recordNumber(payload, keys) {
  for (const k of keys) {
    const v = payload?.[k];
    if (v == null || v === "") continue;
    const s = String(v).trim();
    if (!/^\d{1,9}$/.test(s)) return null;
    const n = Number(s);
    return n > 0 ? n : null;
  }
  return null;
}
```

- [ ] **Step 4: Fetch planning**

Create `apps/api/src/import/fetch-plan.js`:

```js
import { isOpenOrderStatus, recordDate, recordNumber, INVOICE_NUMBER_FIELDS } from "./seazona-records.js";

/**
 * Pure planning for the fetcher: how many requests, how long, which records.
 * REQUESTS_PER_MINUTE mirrors seazona.service.js MAX_REQUESTS_PER_WINDOW (the
 * limiter that actually paces the calls); the estimate is only for the user's OK.
 */
export const REQUESTS_PER_MINUTE = 50;
export const APPROVAL_THRESHOLD = 100;
const LIST_PAGE_CAP = 10_000;

/** CLI name → raw store entity. */
export const SUMMARY_ENTITIES = { clients: "client", users: "user", products: "product", invoices: "invoice", orders: "order" };
export const DETAIL_ENTITIES = { invoices: "invoice_detail", orders: "order_detail" };

export const minutesFor = (requests) => Math.ceil(requests / REQUESTS_PER_MINUTE);

/** One list call, or one per 10k page plus the short last page for the capped lists. */
export function summaryRequests(entity, storedCount = 0) {
  if (entity !== "invoice" && entity !== "order") return 1;
  return Math.floor(storedCount / LIST_PAGE_CAP) + 1;
}

export function approvalProblem({ count, live, approved }) {
  if (!live || count <= APPROVAL_THRESHOLD) return null;
  if (Number.isSafeInteger(approved) && approved >= count) return null;
  return `${count} requests (about ${minutesFor(count)} min) is over ${APPROVAL_THRESHOLD}: it needs the user's OK. With it, re-run with --live --approved ${count}.`;
}

export function detailFilterProblem(filters) {
  if (!filters.ids?.length && !filters.since && !filters.open && !filters.openInvoiceNumbers) {
    return "A detail fetch needs a filter: --ids, --since YYYY-MM-DD, --open (orders) or --open-balance --file-id (invoices).";
  }
  if (filters.since && !/^\d{4}-\d{2}-\d{2}$/.test(filters.since)) return "--since must be YYYY-MM-DD.";
  return null;
}

const isFresh = (has, detailLm, summaryLm) => has && (summaryLm == null || (detailLm != null && detailLm >= summaryLm));

/**
 * The Seazona ids whose detail to fetch, sorted (so a resume replays the same
 * order). summaries: [{ seazonaId, payload, lastModified }]; fetched: Map of
 * already-fetched detail id → the summary lastModified it was fetched under.
 * A detail at least as new as its summary is skipped unless filters.refetch.
 */
export function selectDetailIds(entity, summaries, fetched, filters) {
  const summaryLm = new Map(summaries.map((s) => [s.seazonaId, s.lastModified ?? null]));
  const wanted = new Set(filters.ids ?? []);
  for (const s of summaries) {
    const p = s.payload ?? {};
    if (filters.since && (recordDate(entity, p) ?? "") >= filters.since) wanted.add(s.seazonaId);
    if (filters.open && entity === "order" && isOpenOrderStatus(p.status)) wanted.add(s.seazonaId);
    if (filters.openInvoiceNumbers && entity === "invoice" && filters.openInvoiceNumbers.has(recordNumber(p, INVOICE_NUMBER_FIELDS))) wanted.add(s.seazonaId);
  }
  return [...wanted]
    .filter((id) => filters.refetch || !isFresh(fetched.has(id), fetched.get(id), summaryLm.get(id) ?? null))
    .sort();
}
```

- [ ] **Step 5: The runner**

Create `apps/api/src/import/seazona-fetch.js`:

```js
import { approvalProblem, minutesFor, summaryRequests } from "./fetch-plan.js";

/**
 * Piece 5's ONLY caller of Seazona's invoice/order/user reads (the retired-path
 * guards allow this file by name). `seazona` is the seazona.service.js module,
 * injected by fetch-cli.js (tests pass a fake), so every call goes through the
 * service's 50/min limiter, one at a time. Any refusal stops the run at once
 * — a 403 is Seazona blocking the integration, and retrying into a block is
 * what makes it last — and records the cursor. Only a 404 for one record is
 * skipped and counted.
 */
const SUMMARY_CALLS = {
  client: async (s) => { const r = await s.listClientsResult(""); return { ok: r.ok, status: r.status, records: r.clients, requests: 1 }; },
  user: async (s) => { const r = await s.listUsersResult(); return { ok: r.ok, status: r.status, records: r.users, requests: 1 }; },
  product: async (s) => { const r = await s.listProductsResult(); return { ok: r.ok, status: r.status, records: r.products, requests: 1 }; },
  invoice: async (s) => { const r = await s.getAllInvoicesResult(); return { ok: r.reachable && !r.truncated, status: r.status, records: r.invoices, requests: r.requests }; },
  order: async (s) => { const r = await s.getAllOrdersResult(); return { ok: r.reachable && !r.truncated, status: r.status, records: r.orders, requests: r.requests }; },
};

const DETAIL_CALLS = {
  invoice_detail: async (s, id) => { const r = await s.getInvoiceResult(id); return { ok: r.ok, status: r.status, record: r.invoice }; },
  order_detail: async (s, id) => { const r = await s.getOrderResult(id); return { ok: r.ok, status: r.status, record: r.order }; },
};

const stopStatus = (httpStatus) => (httpStatus === 403 ? "blocked" : "failed");

export async function fetchSummaries({ entity, seazona, store }) {
  const runId = await store.startRun({ entity, mode: "summary" });
  const r = await SUMMARY_CALLS[entity](seazona);
  if (!r.ok) {
    const status = stopStatus(r.status);
    await store.finishRun(runId, { status, cursor: 0, requestCount: r.requests, errorCount: 1, lastStatus: r.status });
    return { runId, status, requests: r.requests, count: 0, lastStatus: r.status };
  }
  const records = r.records
    .filter((rec) => rec?.id != null)
    .map((rec) => ({ seazonaId: String(rec.id), payload: rec, lastModified: typeof rec.lastModified === "string" ? rec.lastModified : null }));
  await store.upsert(entity, records, runId);
  await store.finishRun(runId, { status: "done", cursor: records.length, requestCount: r.requests, errorCount: r.records.length - records.length, lastStatus: r.status });
  return { runId, status: "done", requests: r.requests, count: records.length, lastStatus: r.status };
}

export async function fetchDetails({ entity, ids, start = 0, runId, seazona, store, lastModifiedById = new Map(), prior = { requests: 0, errors: 0 }, progressEvery = 25 }) {
  const call = DETAIL_CALLS[entity];
  let requests = prior.requests;
  let errors = prior.errors;
  let fetched = 0;
  const missing = [];
  for (let i = start; i < ids.length; i++) {
    const id = ids[i];
    const r = await call(seazona, id);
    requests += 1;
    if (r.ok && r.record) {
      await store.upsert(entity, [{ seazonaId: id, payload: r.record, lastModified: lastModifiedById.get(id) ?? null }], runId);
      fetched += 1;
    } else if (r.status === 404 || (r.ok && !r.record)) {
      missing.push(id);
      errors += 1;
    } else {
      const status = stopStatus(r.status);
      await store.finishRun(runId, { status, cursor: i, requestCount: requests, errorCount: errors + 1, lastStatus: r.status });
      return { status, cursor: i, requests, fetched, missing, lastStatus: r.status };
    }
    if ((i + 1 - start) % progressEvery === 0) await store.saveProgress(runId, { cursor: i + 1, requestCount: requests, errorCount: errors });
  }
  await store.finishRun(runId, { status: "done", cursor: ids.length, requestCount: requests, errorCount: errors });
  return { status: "done", cursor: ids.length, requests, fetched, missing };
}

/** Plan, then (only with --live) fetch every summary of one entity. */
export async function runSummaryCommand({ entity, live, approved, seazona, store }) {
  const requests = summaryRequests(entity, (await store.index(entity)).size);
  const plan = { requests, minutes: minutesFor(requests) };
  const refused = approvalProblem({ count: requests, live, approved });
  if (refused) return { plan, refused };
  if (!live) return { plan, dryRun: true };
  const result = await fetchSummaries({ entity, seazona, store });
  return { plan, runId: result.runId, result };
}

/** Plan, then (only with --live and, over 100 requests, --approved) fetch details from `start`. */
export async function runDetailCommand({ entity, ids, start = 0, run = null, live, approved, seazona, store, lastModifiedById }) {
  const remaining = Math.max(0, ids.length - start);
  const plan = { requests: remaining, minutes: minutesFor(remaining) };
  const refused = approvalProblem({ count: remaining, live, approved });
  if (refused) return { plan, refused };
  if (!live) return { plan, dryRun: true };
  const runId = run?.id ?? (await store.startRun({ entity, mode: "detail", plannedIds: ids }));
  const prior = run ? { requests: run.requestCount ?? 0, errors: run.errorCount ?? 0 } : undefined;
  const result = await fetchDetails({ entity, ids, start, runId, seazona, store, lastModifiedById, prior });
  return { plan, runId, result };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/import src/routes/__tests__/seazona-order-retired.test.js src/routes/__tests__/seazona-invoice-retired.test.js`
Expected: PASS (the guards allow `seazona-fetch.js` and its test by name).

- [ ] **Step 7: The CLI and its output helpers**

Create `apps/api/src/import/report.js`:

```js
import { ImportRefusal } from "./import-errors.js";

/**
 * Output for the piece-5 CLIs. Callers pass ids, numbers, counts and cents
 * only — never a record's contents. A failure prints its code and message
 * (Postgres messages carry no row values; `detail` does and is never printed).
 */
export function printLines(lines) {
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function printReport(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

export async function runCli(main) {
  let code = 0;
  try {
    code = (await main(process.argv.slice(2), process.env)) ?? 0;
  } catch (err) {
    if (err instanceof ImportRefusal) {
      console.error(`Refused: ${err.message}`);
      code = 2;
    } else {
      console.error(`Failed: ${err?.code ? `${err.code} ` : ""}${String(err?.message ?? err).slice(0, 300)}`);
      code = 1;
    }
  }
  process.exitCode = code;
}
```

Create `apps/api/src/import/fetch-cli.js`:

```js
/**
 * Piece 5 fetcher. Operator machine only (refuses on Cloud Run). DRY RUN BY DEFAULT.
 *
 *   pnpm --filter @my-app/api import:fetch <clients|users|products|invoices|orders> [--live]
 *   pnpm --filter @my-app/api import:fetch <invoices|orders> --detail <filter> [--refetch] [--live [--approved <n>]]
 *     filters: --ids <id,id> | --since YYYY-MM-DD | --open (orders) | --open-balance --file-id <id> [--columns …] (invoices)
 *   pnpm --filter @my-app/api import:fetch <invoices|orders> --detail --resume <runId> [--live [--approved <n>]]
 *   pnpm --filter @my-app/api import:fetch export --balances per-invoice|per-client --file <export.xls>
 *     (seals a portal balance export into the import DB and prints its id; no Seazona call)
 *
 * Needs IMPORT_DATABASE_URL (diamond_labs_import) and production's
 * PHI_ENCRYPTION_KEY exported in the shell (docs/import-operations.md). Prints
 * the request count and minutes first. A live run over 100 requests needs
 * --approved <count>, which stands for the user's OK. Stops on the first block.
 */
import { readFile } from "node:fs/promises";
import * as seazona from "../services/seazona.service.js";
import * as importSchema from "./db/schema.js";
import { parseArgs, intFlag, listFlag } from "./cli-args.js";
import { ImportRefusal } from "./import-errors.js";
import { assertNotCloudRun, resolveImportDb, connect } from "./targets.js";
import { assertImportKey } from "./key-check.js";
import { rawStore } from "./raw-store.js";
import { readExport, parseColumnsFlag } from "./export-table.js";
import { SUMMARY_ENTITIES, DETAIL_ENTITIES, APPROVAL_THRESHOLD, REQUESTS_PER_MINUTE, detailFilterProblem, selectDetailIds } from "./fetch-plan.js";
import { runSummaryCommand, runDetailCommand } from "./seazona-fetch.js";
import { printLines, runCli } from "./report.js";

const FLAGS = {
  allowed: ["live", "detail", "ids", "since", "open", "open-balance", "file-id", "columns", "refetch", "resume", "approved", "file", "balances"],
  booleans: ["live", "detail", "open", "open-balance", "refetch"],
};

const EXPORT_FILE_KINDS = { "per-invoice": "balances_invoice", "per-client": "balances_client" };

/** `import:fetch export`: seal a portal balance export into the import DB. No Seazona call, no target. */
async function storeExport(flags, store) {
  const kind = EXPORT_FILE_KINDS[flags.balances];
  if (!kind || !flags.file) throw new ImportRefusal("Usage: import:fetch export --balances per-invoice|per-client --file <export.xls>");
  const id = await store.saveFile({ kind, bytes: await readFile(flags.file) });
  printLines([`Stored the ${flags.balances} export as file ${id}. Delete the local copy now (and empty the Trash).`]);
  return 0;
}

async function openInvoiceNumbers(flags, store) {
  if (!flags["file-id"]) throw new ImportRefusal("--open-balance needs --file-id (store the export first: import:fetch export --balances per-invoice --file <path>).");
  const file = await store.readFile(flags["file-id"]);
  if (!file || file.kind !== "balances_invoice") throw new ImportRefusal(`No per-invoice export with id ${flags["file-id"]}.`);
  const { rows } = readExport(file.bytes, { kind: "invoice", columns: flags.columns ? parseColumnsFlag(flags.columns) : {} });
  return new Set(rows.filter((r) => r.cents > 0).map((r) => r.key));
}

async function detailIds({ name, entity, flags, store }) {
  const detailEntity = DETAIL_ENTITIES[name];
  if (flags.resume) {
    const run = await store.getRun(flags.resume);
    if (!run || run.entity !== detailEntity || run.mode !== "detail") throw new ImportRefusal(`No ${detailEntity} run ${flags.resume}.`);
    if (run.status === "done") throw new ImportRefusal(`Run ${run.id} already finished.`);
    return { ids: run.plannedIds ?? [], start: run.cursor, run };
  }
  if (flags.open && entity !== "order") throw new ImportRefusal("--open applies to orders only.");
  if (flags["open-balance"] && entity !== "invoice") throw new ImportRefusal("--open-balance applies to invoices only.");
  const filters = {
    ids: listFlag(flags, "ids"),
    since: flags.since,
    open: flags.open === true,
    refetch: flags.refetch === true,
    openInvoiceNumbers: flags["open-balance"] ? await openInvoiceNumbers(flags, store) : undefined,
  };
  const problem = detailFilterProblem(filters);
  if (problem) throw new ImportRefusal(problem);
  const ids = selectDetailIds(entity, await store.records(entity), await store.index(detailEntity), filters);
  return { ids, start: 0, run: null };
}

function outcomeLines(mode, out) {
  const lines = [`Plan: ${out.plan.requests} Seazona request(s), about ${out.plan.minutes} min at ${REQUESTS_PER_MINUTE}/min.`];
  if (out.dryRun) {
    lines.push(out.plan.requests > APPROVAL_THRESHOLD
      ? `Dry run. Over ${APPROVAL_THRESHOLD} requests: give the user this count and duration; with their OK re-run with --live --approved ${out.plan.requests}.`
      : "Dry run: nothing was fetched. Re-run with --live.");
    return { lines, code: 0 };
  }
  const r = out.result;
  lines.push(`Run ${out.runId}: ${r.status}; ${r.requests} request(s); ${r.count ?? r.fetched ?? 0} stored; ${r.missing?.length ?? 0} not found.`);
  if (r.missing?.length) lines.push(`Not found (first 20): ${r.missing.slice(0, 20).join(", ")}`);
  if (r.status === "blocked") {
    lines.push("Seazona refused with 403: the integration is BLOCKED (production too). Do not retry. Tell the user; check /health/seazona later.");
  } else if (r.status === "failed") {
    lines.push(`Stopped on HTTP status ${r.lastStatus ?? "unknown"}.`);
  }
  if (r.status !== "done") lines.push(mode === "detail" ? `Resume later with --detail --resume ${out.runId}.` : "Re-run the summary fetch later.");
  return { lines, code: r.status === "done" ? 0 : 3 };
}

async function main(argv, env) {
  assertNotCloudRun(env);
  const { positional, flags } = parseArgs(argv, FLAGS);
  const name = positional[0];
  const entity = SUMMARY_ENTITIES[name];
  if ((!entity && name !== "export") || positional.length !== 1) {
    throw new ImportRefusal(`Usage: import:fetch <${Object.keys(SUMMARY_ENTITIES).join("|")}|export> [--detail <filter>] [--live]`);
  }
  if (flags.detail && !DETAIL_ENTITIES[name]) throw new ImportRefusal(`${name} has no detail fetch (invoices and orders do).`);
  const importDb = connect(resolveImportDb(env), importSchema);
  try {
    await assertImportKey(importDb.db, { keyCheck: importSchema.keyCheck });
    const store = rawStore(importDb.db);
    if (name === "export") return await storeExport(flags, store);
    const live = flags.live === true;
    const approved = intFlag(flags, "approved");
    let out;
    if (flags.detail) {
      const { ids, start, run } = await detailIds({ name, entity, flags, store });
      out = await runDetailCommand({ entity: DETAIL_ENTITIES[name], ids, start, run, live, approved, seazona, store, lastModifiedById: await store.index(entity) });
    } else {
      out = await runSummaryCommand({ entity, live, approved, seazona, store });
    }
    if (out.refused) throw new ImportRefusal(out.refused);
    const { lines, code } = outcomeLines(flags.detail ? "detail" : "summary", out);
    printLines(lines);
    return code;
  } finally {
    await importDb.close();
  }
}

runCli(main);
```

In `apps/api/package.json` `scripts`, add `"import:fetch": "node --env-file=.env src/import/fetch-cli.js",`.

**Do not run `import:fetch` with `--live`** (and do not run it at all against a real `IMPORT_DATABASE_URL`). The CLI's logic is covered by the runner tests; the operator runs it per `docs/import-operations.md`.

- [ ] **Step 8: Verify the CLI loads and refuses cleanly with no configuration**

Run: `cd apps/api && env -u IMPORT_DATABASE_URL node --env-file=.env src/import/fetch-cli.js invoices; echo "exit=$?"`
Expected: `Refused: IMPORT_DATABASE_URL is not set.` and `exit=2`. No network call is possible: the refusal happens before any connection or Seazona call. (If `apps/api/.env` does not exist locally, run `node src/import/fetch-cli.js invoices` with `DATABASE_URL` and `JWT_SECRET` set to the vitest placeholders instead.)

Run: `cd apps/api && pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/package.json apps/api/src/import
git commit -m "feat(import): Seazona fetcher — dry run first, approval over 100 requests, stop on block, resume from cursor

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Clients: mapper over the raw store and the `clients` load step; old importer deleted; no mail to `.invalid`

**Files:**
- Create: `apps/api/src/import/map-clients.js`, `apps/api/src/import/map-clients.test.js`
- Create: `apps/api/src/import/load-clients.js`, `apps/api/src/import/load-clients.test.js`
- Create: `apps/api/test-fixtures/seazona/clients.json`
- Delete: `apps/api/src/db/import-seazona-clients.js`
- Modify: `apps/api/package.json` (remove `db:import-seazona`)
- Modify: `apps/api/src/services/email.service.js`; Create: `apps/api/src/services/email-invalid.test.js`

**Interfaces:**
- Consumes: `slugify` (`@my-app/shared`), `createId`, `firstString` (Task 9).
- Produces:
  - `map-clients.js`: `PLACEHOLDER_EMAIL_DOMAIN = "seazona-clients.invalid"`, `clientEmail(raw) → string|null` (the old `extractEmail`), `placeholderEmail(seazonaClientId)`, `isPlaceholderEmail(email)`, `profileFromClient(client, userId, now) → doctor_profiles row | null`, `existingFromRows(userRows, slugRows, profileRows)`, `ownerIndex(userRows) → Map<seazonaClientId, userId>`, `accountOwnerIndex(userRows) → Map<accountNumber, userId>`, `planClients(clients, existing, { noEmail, now }) → { create, link, profiles, skipped: { alreadyLinked, noEmail: string[], emailTaken: string[] } }`.
  - `userRows` everywhere are `{ id, email, seazonaClientId, seazonaAccountNumber, createdAt }` (doctors only).
  - `load-clients.js`: `loadClients({ raw, db, live, noEmail = "placeholder", now }) → report` where `raw.records(entity)` is the raw store reader and `report = { step: "clients", live, counts, problems }`.
- Behavior moved, not copied: everything `db/import-seazona-clients.js` did (create user + account + owner membership, link an existing email, skip a linked client, unique slug) now lives in `planClients`; the file is deleted.

- [ ] **Step 1: Write the fixture**

`apps/api/test-fixtures/seazona/clients.json` (synthetic; field names per the Seazona client shape, address names confirmed at rehearsal):

```json
[
  { "id": "c-1324", "accountNumber": "1324", "fullName": "Dr. Example One", "company": "Example Dental", "email": "one@example.test", "phone": "210-555-0100", "address1": "1 Example St", "city": "San Antonio", "state": "TX", "zip": "78201" },
  { "id": "c-2001", "accountNumber": "2001", "fullName": "Dr. Sample Two", "company": "Sample Ortho & Co", "email": "two@example.test; billing@example.test" },
  { "id": "c-3005", "accountNumber": "3005", "fullName": "Placeholder Clinic", "company": "", "email": "", "address1": "9 Test Ave", "city": "Austin", "state": "TX", "zip": "73301" },
  { "id": "c-4000", "accountNumber": "4000", "fullName": "Shared Inbox", "company": "Shared", "email": "TWO@example.test" },
  { "id": "c-9999", "accountNumber": "9999", "fullName": "Already Linked", "company": "Linked", "email": "linked@example.test" }
]
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/import/map-clients.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { slugify } from "@my-app/shared";
import {
  clientEmail, placeholderEmail, isPlaceholderEmail, profileFromClient, existingFromRows, ownerIndex, accountOwnerIndex, planClients, PLACEHOLDER_EMAIL_DOMAIN,
} from "./map-clients.js";

const clients = JSON.parse(readFileSync(new URL("../../test-fixtures/seazona/clients.json", import.meta.url), "utf8"));
const now = new Date("2026-11-01T00:00:00Z");
const userRows = [
  { id: "u-old", email: "one@example.test", seazonaClientId: null, seazonaAccountNumber: null, createdAt: new Date("2026-01-01") },
  { id: "u-linked", email: "linked@example.test", seazonaClientId: "c-9999", seazonaAccountNumber: "9999", createdAt: new Date("2026-01-02") },
];

test("the first plausible email; placeholders use the reserved .invalid domain", () => {
  assert.equal(clientEmail("Two@Example.test; b@x.test"), "two@example.test");
  assert.equal(clientEmail("not an email"), null);
  assert.equal(clientEmail(null), null);
  assert.equal(placeholderEmail("C-3005"), `client-c-3005@${PLACEHOLDER_EMAIL_DOMAIN}`);
  assert.equal(isPlaceholderEmail(placeholderEmail("x")), true);
  assert.equal(isPlaceholderEmail("doc@practice.test"), false);
});

test("a profile only from a complete address, with a blank NPI for the lab to fill", () => {
  const p = profileFromClient(clients[0], "u1", now);
  assert.equal(p.userId, "u1");
  assert.equal(p.npiNumber, "");
  assert.equal(p.companyName, "Example Dental");
  assert.equal(p.zip, "78201");
  assert.equal(profileFromClient(clients[1], "u2", now), null, "no address");
});

test("owners: the oldest doctor sharing a Seazona client id or account number", () => {
  const rows = [
    { id: "b", seazonaClientId: "c1", seazonaAccountNumber: "1", createdAt: new Date("2026-02-01") },
    { id: "a", seazonaClientId: "c1", seazonaAccountNumber: "1", createdAt: new Date("2026-01-01") },
  ];
  assert.equal(ownerIndex(rows).get("c1"), "a");
  assert.equal(accountOwnerIndex(rows).get("1"), "a");
});

test("plan: link by email, create with a real or placeholder email, skip linked, report a taken email", () => {
  const existing = existingFromRows(userRows, [{ slug: slugify("Sample Ortho & Co") }], []);
  const plan = planClients(clients, existing, { now });
  assert.deepEqual(plan.link, [{ userId: "u-old", seazonaClientId: "c-1324", seazonaAccountNumber: "1324" }]);
  assert.deepEqual(plan.create.map((c) => [c.user.seazonaClientId, c.user.email, c.user.status]), [
    ["c-2001", "two@example.test", "active"],
    ["c-3005", placeholderEmail("c-3005"), "suspended"],
  ]);
  for (const c of plan.create) {
    assert.equal(c.user.role, "doctor");
    assert.equal(c.user.approvalStatus, "approved");
    assert.equal(c.user.passwordHash, null);
    assert.equal(c.account.ownerId, c.user.id);
    assert.equal(c.membership.role, "owner");
    assert.ok(c.account.slug.length <= 50);
  }
  assert.equal(plan.create[0].account.slug, `${slugify("Sample Ortho & Co")}-1`, "slug stays unique");
  assert.deepEqual(plan.skipped.emailTaken, ["c-4000"], "a second client on an email already used this run");
  assert.equal(plan.skipped.alreadyLinked, 1);
  assert.deepEqual(plan.profiles.map((p) => p.userId).sort(), ["u-old", plan.create[1].user.id].sort());
  assert.equal(plan.profiles.find((p) => p.userId === "u-old").companyName, "Example Dental");
});

test("--no-email skip leaves email-less clients out and says so", () => {
  const plan = planClients(clients, existingFromRows(userRows, [], []), { noEmail: "skip", now });
  assert.deepEqual(plan.skipped.noEmail, ["c-3005"]);
  assert.equal(plan.create.some((c) => c.user.seazonaClientId === "c-3005"), false);
});

test("an existing profile is never replaced", () => {
  const plan = planClients(clients, existingFromRows(userRows, [], [{ userId: "u-old" }]), { now });
  assert.equal(plan.profiles.some((p) => p.userId === "u-old"), false);
});
```

Create `apps/api/src/import/load-clients.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeTx } from "../test/fake-tx.js";
import { loadClients } from "./load-clients.js";

const clients = JSON.parse(readFileSync(new URL("../../test-fixtures/seazona/clients.json", import.meta.url), "utf8"));
const raw = { records: async (entity) => (entity === "client" ? clients.map((c) => ({ seazonaId: c.id, payload: c })) : []) };
const userRows = [{ id: "u-old", email: "one@example.test", seazonaClientId: null, seazonaAccountNumber: null, createdAt: new Date("2026-01-01") }];
const db = () => fakeTx({ selects: [userRows, [], []] });

test("a dry run reports counts and writes nothing", async () => {
  const tx = db();
  const report = await loadClients({ raw, db: tx, live: false });
  assert.equal(report.step, "clients");
  assert.equal(report.counts.seazonaClients, 5);
  assert.equal(report.counts.create, 3);
  assert.equal(report.counts.placeholders, 1);
  assert.equal(report.counts.link, 1);
  assert.equal(tx.log.some((e) => e.op === "insert" || e.op === "update"), false);
  assert.ok(!JSON.stringify(report).includes("example.test"), "the report carries no email or name");
});

test("a live run writes users, accounts, memberships, links and profiles in one transaction", async () => {
  const tx = db();
  await loadClients({ raw, db: tx, live: true });
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  assert.equal(inserts.filter((v) => v.role === "doctor").length, 3);
  assert.equal(inserts.filter((v) => v.role === "owner").length, 3);
  assert.equal(inserts.filter((v) => "npiNumber" in v).length, 2);
  const set = tx.log.find((e) => e.op === "set").values;
  assert.equal(set.seazonaClientId, "c-1324");
});
```

Create `apps/api/src/services/email-invalid.test.js`:

```js
import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";

vi.mock("../config/email.js", () => ({ mailgun: { apiKey: "k", domain: "mg.example", apiBase: "https://api.mailgun.test" } }));
vi.mock("../config/env.js", () => ({ env: { APP_ENV: "development", NODE_ENV: "test", EMAIL_FROM: "noreply@example.com" } }));

const email = await import("./email.service.js");
afterEach(() => vi.unstubAllGlobals());

const stub = () => {
  const f = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", f);
  return f;
};
const receipt = (to) => email.sendPaymentReceipt({ to, amountCents: 100, invoices: [], transactionId: "t", date: new Date() });

test("a placeholder login (.invalid) is never sent mail", async () => {
  const f = stub();
  await receipt("client-c-3005@seazona-clients.invalid");
  assert.equal(f.mock.calls.length, 0);
});

test(".invalid recipients are dropped from a list; the rest still get it", async () => {
  const f = stub();
  await receipt(["doc@practice.test", "client-x@seazona-clients.invalid"]);
  assert.equal(f.mock.calls.length, 1);
  assert.equal(new URLSearchParams(f.mock.calls[0][1].body).get("to"), "doc@practice.test");
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/import/map-clients.test.js src/import/load-clients.test.js src/services/email-invalid.test.js`
Expected: FAIL (modules missing; the `.invalid` receipt is sent).

- [ ] **Step 4: The mapper**

Create `apps/api/src/import/map-clients.js`:

```js
import { slugify } from "@my-app/shared";
import { createId } from "../lib/id.js";
import { firstString } from "./seazona-records.js";

/**
 * Seazona clients → doctor users, practices and owner memberships (moved here
 * from the deleted db/import-seazona-clients.js; it now reads the raw store,
 * never Seazona). Pure: the caller loads `existing` and writes the plan.
 * Imported doctors have no password: they log in after a reset. A client with
 * no email gets a SUSPENDED doctor with a reserved `.invalid` address (Spec
 * correction 3) so its invoices have an owner; email.service never mails it.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "seazona-clients.invalid";
const SLUG_MAX = 50; // accounts.slug is varchar(50)

/** The first plausible address in Seazona's email field; null when none. */
export function clientEmail(raw) {
  if (!raw) return null;
  const first = String(raw).split(/[,;]/)[0].trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(first) ? first : null;
}

export function placeholderEmail(seazonaClientId) {
  return `client-${String(seazonaClientId).toLowerCase().replace(/[^a-z0-9-]/g, "")}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export const isPlaceholderEmail = (email) => String(email ?? "").toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);

const cut = (s, n) => (s == null ? null : String(s).slice(0, n));

/** A doctor_profiles row from a complete Seazona address, else null. NPI is blank for the lab to fill in. */
export function profileFromClient(client, userId, now) {
  const address1 = firstString(client, ["address1", "address", "street", "addressLine1"]);
  const city = firstString(client, ["city"]);
  const state = firstString(client, ["state", "province"]);
  const zip = firstString(client, ["zip", "zipCode", "postalCode"]);
  if (!address1 || !city || !state || !zip) return null;
  return {
    id: createId(), userId, npiNumber: "", licenseNumber: null,
    companyName: cut(firstString(client, ["company", "fullName"]) ?? "Practice", 255),
    address1: cut(address1, 255), address2: cut(firstString(client, ["address2", "addressLine2"]), 255),
    city: cut(city, 100), state: cut(state, 50), zip: cut(zip, 20), phone: cut(firstString(client, ["phone"]), 30),
    createdAt: now, updatedAt: now,
  };
}

const oldestFirst = (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id));

function indexBy(userRows, key) {
  const out = new Map();
  for (const u of [...userRows].sort(oldestFirst)) {
    const k = u[key] == null ? null : String(u[key]);
    if (k && !out.has(k)) out.set(k, u.id);
  }
  return out;
}

/** The doctor who owns a Seazona client's invoices and orders: the oldest sharing its id. */
export const ownerIndex = (userRows) => indexBy(userRows, "seazonaClientId");
/** The same by Seazona account number (the per-client balance export's key). */
export const accountOwnerIndex = (userRows) => indexBy(userRows, "seazonaAccountNumber");

export function existingFromRows(userRows, slugRows, profileRows) {
  return {
    owners: ownerIndex(userRows),
    byEmail: new Map(userRows.map((u) => [String(u.email).toLowerCase(), { id: u.id, seazonaClientId: u.seazonaClientId ?? null }])),
    slugs: new Set(slugRows.map((r) => r.slug)),
    profileUserIds: new Set(profileRows.map((r) => r.userId)),
  };
}

function uniqueSlug(name, taken) {
  const root = (slugify(name) || `account-${createId().slice(0, 8)}`).slice(0, SLUG_MAX);
  let slug = root;
  for (let n = 1; taken.has(slug); n++) {
    const suffix = `-${n}`;
    slug = `${root.slice(0, SLUG_MAX - suffix.length)}${suffix}`;
  }
  taken.add(slug);
  return slug;
}

function newDoctor(client, id, email, placeholder, slugs, now) {
  const userId = createId();
  const name = firstString(client, ["fullName", "company"]) ?? email;
  const practice = firstString(client, ["company", "fullName"]) ?? email;
  const accountId = createId();
  return {
    user: {
      id: userId, email, name: name.slice(0, 100), passwordHash: null, emailVerifiedAt: null,
      status: placeholder ? "suspended" : "active", role: "doctor", approvalStatus: "approved",
      seazonaClientId: id, seazonaAccountNumber: client.accountNumber == null ? null : String(client.accountNumber),
      createdAt: now, updatedAt: now,
    },
    account: { id: accountId, name: practice.slice(0, 100), slug: uniqueSlug(practice, slugs), ownerId: userId, plan: "pro", status: "active", createdAt: now, updatedAt: now },
    membership: { id: createId(), userId, accountId, role: "owner", status: "active", createdAt: now, updatedAt: now },
  };
}

/** Seazona clients → { create, link, profiles, skipped }. Never mutates `existing`. */
export function planClients(clients, existing, { noEmail = "placeholder", now = new Date() } = {}) {
  const slugs = new Set(existing.slugs);
  const usedEmails = new Map(existing.byEmail);
  const withProfile = new Set(existing.profileUserIds);
  const plan = { create: [], link: [], profiles: [], skipped: { alreadyLinked: 0, noEmail: [], emailTaken: [] } };
  const addProfile = (client, userId) => {
    if (withProfile.has(userId)) return;
    const p = profileFromClient(client, userId, now);
    if (p) { plan.profiles.push(p); withProfile.add(userId); }
  };
  for (const client of clients) {
    const id = String(client.id);
    if (existing.owners.has(id)) {
      plan.skipped.alreadyLinked += 1;
      addProfile(client, existing.owners.get(id));
      continue;
    }
    const email = clientEmail(client.email);
    if (!email && noEmail === "skip") { plan.skipped.noEmail.push(id); continue; }
    const address = email ?? placeholderEmail(id);
    const taken = usedEmails.get(address);
    if (taken && !taken.seazonaClientId) {
      plan.link.push({ userId: taken.id, seazonaClientId: id, seazonaAccountNumber: client.accountNumber == null ? null : String(client.accountNumber) });
      usedEmails.set(address, { ...taken, seazonaClientId: id });
      addProfile(client, taken.id);
      continue;
    }
    if (taken) { plan.skipped.emailTaken.push(id); continue; }
    const doctor = newDoctor(client, id, address, !email, slugs, now);
    plan.create.push(doctor);
    usedEmails.set(address, { id: doctor.user.id, seazonaClientId: id });
    addProfile(client, doctor.user.id);
  }
  return plan;
}
```

- [ ] **Step 5: The load step**

Create `apps/api/src/import/load-clients.js`:

```js
import { and, eq, isNull } from "drizzle-orm";
import { users, accounts, memberships, doctorProfiles } from "../db/schema/index.js";
import { planClients, existingFromRows } from "./map-clients.js";

/**
 * `import:load clients`: raw-store clients → doctors. Dry run (live=false)
 * reports counts and Seazona ids only. A live run writes the plan in one
 * transaction (a few hundred rows). Re-runnable: linked clients are skipped,
 * a link only fills an empty seazonaClientId, profiles never overwrite.
 */
export async function loadClients({ raw, db, live, noEmail = "placeholder", now = new Date() }) {
  const clients = (await raw.records("client")).map((r) => r.payload);
  const userRows = await db
    .select({ id: users.id, email: users.email, seazonaClientId: users.seazonaClientId, seazonaAccountNumber: users.seazonaAccountNumber, createdAt: users.createdAt })
    .from(users);
  const slugRows = await db.select({ slug: accounts.slug }).from(accounts);
  const profileRows = await db.select({ userId: doctorProfiles.userId }).from(doctorProfiles);
  const plan = planClients(clients, existingFromRows(userRows, slugRows, profileRows), { noEmail, now });

  const report = {
    step: "clients",
    live,
    counts: {
      seazonaClients: clients.length,
      create: plan.create.length,
      placeholders: plan.create.filter((c) => c.user.status === "suspended").length,
      link: plan.link.length,
      profiles: plan.profiles.length,
      alreadyLinked: plan.skipped.alreadyLinked,
    },
    problems: [
      { kind: "no_email_skipped", seazonaIds: plan.skipped.noEmail },
      { kind: "email_already_linked_to_another_client", seazonaIds: plan.skipped.emailTaken },
    ].filter((p) => p.seazonaIds.length),
  };
  if (!live) return report;

  await db.transaction(async (tx) => {
    for (const c of plan.create) {
      await tx.insert(users).values(c.user);
      await tx.insert(accounts).values(c.account);
      await tx.insert(memberships).values(c.membership);
    }
    for (const l of plan.link) {
      await tx.update(users)
        .set({ seazonaClientId: l.seazonaClientId, seazonaAccountNumber: l.seazonaAccountNumber, updatedAt: now })
        .where(and(eq(users.id, l.userId), isNull(users.seazonaClientId)));
    }
    for (const p of plan.profiles) await tx.insert(doctorProfiles).values(p).onConflictDoNothing();
  });
  return report;
}
```

Note: `users` selects every user, not just doctors, so an email used by a shopper (`role: user`) is linked rather than duplicated; the old importer did the same.

- [ ] **Step 6: Never mail a placeholder**

In `apps/api/src/services/email.service.js`, inside `deliver()`:

1. Replace the `addresses` helper line with:

```js
  // `.invalid` is a reserved TLD (RFC 2606): piece 5's placeholder logins for
  // Seazona clients with no email use it, and they must never be mailed.
  const UNDELIVERABLE = /\.invalid>?$/i;
  let droppedUndeliverable = false;
  const addresses = (v) =>
    [].concat(v ?? []).map((a) => headerSafe(a, 320)).filter((a) => {
      if (a && UNDELIVERABLE.test(a)) { droppedUndeliverable = true; return false; }
      return Boolean(a);
    }).join(", ");
```

2. Directly after the existing `bcc = addresses(bcc);` line (the comment block between the helper and `to = addresses(to);` stays as it is), add:

```js
  // Only when a .invalid address was the whole recipient list: other callers
  // (e.g. an unset ADMIN_NOTIFICATION_EMAIL in tests) keep today's behaviour.
  if (droppedUndeliverable && !to) {
    console.log("[EMAIL] skipped: no deliverable recipient");
    return false;
  }
```

- [ ] **Step 7: Delete the old importer**

```bash
git rm apps/api/src/db/import-seazona-clients.js
```

In `apps/api/package.json`, remove the `"db:import-seazona"` script. Then confirm nothing else names it:

Run: `grep -rn "import-seazona-clients\|db:import-seazona" apps packages scripts --include='*.js' --include='*.json' --include='*.jsx'`
Expected: no output. (`CLAUDE.md` and docs are updated in Task 16.)

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/import src/services/email`
Expected: PASS (including the existing `email-staging.test.js`).

- [ ] **Step 9: Commit**

```bash
git add -A apps/api/src/import apps/api/test-fixtures/seazona/clients.json apps/api/package.json apps/api/src/services/email.service.js apps/api/src/services/email-invalid.test.js apps/api/src/db/import-seazona-clients.js
git commit -m "feat(import): clients load from the raw store (placeholders for no-email clients); old live importer removed

email.service never mails a reserved .invalid address.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Legacy invoices: mapper, `insertMissing` writer, seed check, the `invoices` load step

**Files:**
- Create: `apps/api/test-fixtures/seazona/invoices.json`, `apps/api/test-fixtures/seazona/invoice-details.json`
- Create: `apps/api/src/import/map-invoices.js`, `apps/api/src/import/map-invoices.test.js`
- Create: `apps/api/src/import/load-writer.js`, `apps/api/src/import/load-writer.test.js`
- Create: `apps/api/src/import/seed-check.js`, `apps/api/src/import/seed-check.test.js`
- Create: `apps/api/src/import/load-invoices.js`, `apps/api/src/import/load-invoices.test.js`

**Interfaces:**
- Consumes: `toCents`, `LEGACY_LINE_DESCRIPTION` (`@my-app/shared`), `sealInvoice`, `sealLine` (Task 2), `invoiceStatusFor`, `recordDate`, `recordNumber`, `firstString`, `INVOICE_NUMBER_FIELDS`, `ORDER_NUMBER_FIELDS` (Task 9), `ownerIndex` (Task 10), `ImportRefusal` (Task 5).
- Produces:
  - `map-invoices.js`: `SUMMARY_LINE_DESCRIPTION`, `centsOf(value) → cents|null`, `labNoon("YYYY-MM-DD") → Date`, `legacyIssueDay(summary, detail) → { day, approximated }`, `mapLegacyInvoice({ summary, detail, ownerUserId }) → { invoice, lines, approximatedDate, detailed } | { problem }`, `planInvoices({ summaries, details, owners, existingSeazonaIds, existingNumbers }) → { rows: [{ invoice, lines }], counts, problems }`. Rows are UNSEALED (the writer seals).
  - `load-writer.js`: `insertMissing(tx, table, rows, { keyOf, existingKeys, idOf, batch }) → { insertedIds: Set, skipped, conflicts }`.
  - `seed-check.js`: `seazonaMaxNumbers({ invoiceSummaries, orderSummaries }) → { invoice, order }`, `checkSeeds({ target, max, starts, liveAtOrBelow }) → { errors, warnings }`, `liveNumbersAtOrBelow(db, max) → { invoice, order }`, `enforceSeeds({ raw, db, target, live, starts, invoiceSummaries?, orderSummaries? }) → { max, errors, warnings, summary }` (throws `ImportRefusal` on a live run with errors).
  - `load-invoices.js`: `loadInvoices({ raw, db, live, target, starts }) → report`.
  - `problems` everywhere: `[{ kind, count, seazonaIds (first 50) }]`.

- [ ] **Step 1: Write the fixtures**

`apps/api/test-fixtures/seazona/invoices.json` (summary shape per the live API; synthetic values):

```json
[
  { "id": "inv-a", "invoiceNumber": "11114", "patient": "Test Patient A", "clientId": "c-1324", "fullName": "Dr. Example One", "company": "Example Dental", "sales": 1250.0, "tax": 0, "discounts": 0, "total": 1250.0, "status": "Shipped", "due": "2026-02-15T00:00:00", "lastModified": "2025-11-29T15:05:50" },
  { "id": "inv-b", "invoiceNumber": "11115", "patient": "Test Patient B", "clientId": "c-1324", "fullName": "Dr. Example One", "company": "Example Dental", "sales": 290.0, "tax": 10.0, "discounts": 0, "total": 300.0, "status": "In Production", "due": "2026-03-01T00:00:00", "lastModified": "2026-10-01T10:00:00" },
  { "id": "inv-c", "invoiceNumber": "11120", "patient": "Test Patient C", "clientId": "c-2001", "sales": 80, "tax": 0, "discounts": 0, "total": 80, "status": "Void", "due": "2026-04-01", "lastModified": "2026-10-02T00:00:00" },
  { "id": "inv-d", "invoiceNumber": "11121", "patient": "Test Patient D", "clientId": "c-2001", "sales": 95, "tax": 0, "discounts": 0, "total": 95, "status": "Shipped", "due": "2026-04-05", "lastModified": "2026-10-03T00:00:00" },
  { "id": "inv-x", "invoiceNumber": "INV-9", "patient": "Test Patient X", "clientId": "c-2001", "total": 10, "tax": 0, "status": "Shipped", "due": "2026-04-05" },
  { "id": "inv-y", "invoiceNumber": "11130", "patient": "Test Patient Y", "clientId": "c-unknown", "total": 10, "tax": 0, "status": "Shipped", "due": "2026-04-05" }
]
```

`apps/api/test-fixtures/seazona/invoice-details.json` (detail shape ASSUMED from the documented `productServiceItems[].type`; the rehearsal confirms and this file and `map-invoices.js` change together if it differs):

```json
[
  {
    "id": "inv-b", "invoiceNumber": "11115", "date": "2026-01-30T09:12:00",
    "productServiceItems": [
      { "type": "product", "code": "2608", "name": "DDSO Nylon — Test Patient B", "quantity": 1, "price": 250.0, "total": 250.0 },
      { "type": "service", "code": "SHIP", "name": "Shipping", "quantity": 1, "price": 15.0, "total": 15.0 }
    ]
  }
]
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/import/map-invoices.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEGACY_LINE_DESCRIPTION, isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { centsOf, labNoon, mapLegacyInvoice, planInvoices, SUMMARY_LINE_DESCRIPTION } from "./map-invoices.js";

const load = (n) => JSON.parse(readFileSync(new URL(`../../test-fixtures/seazona/${n}`, import.meta.url), "utf8"));
const summaries = load("invoices.json");
const details = new Map(load("invoice-details.json").map((d) => [d.id, d]));
const byId = (id) => summaries.find((s) => s.id === id);
const owners = new Map([["c-1324", "u-1324"], ["c-2001", "u-2001"]]);

test("dollars → cents; junk is null", () => {
  assert.equal(centsOf(1250), 125000);
  assert.equal(centsOf("12.5"), 1250);
  assert.equal(centsOf("$1,234.56"), 123456);
  assert.equal(centsOf(0.1 + 0.2), 30);
  assert.equal(centsOf(null), null);
  assert.equal(centsOf("abc"), null);
});

test("lab noon keeps the lab-local day in both CST and CDT", () => {
  for (const d of ["2026-01-15", "2026-07-15"]) assert.equal(isoDateIn(LAB_TIMEZONE, labNoon(d)), d);
});

test("a summary-only invoice: one line at total − tax, the due date stands in for the issue date", () => {
  const { invoice, lines, approximatedDate, detailed } = mapLegacyInvoice({ summary: byId("inv-a"), ownerUserId: "u-1324" });
  assert.equal(invoice.kind, "legacy");
  assert.equal(invoice.status, "issued");
  assert.equal(invoice.invoiceNumber, 11114);
  assert.equal(invoice.legacySeazonaInvoiceId, "inv-a");
  assert.equal(invoice.clientUserId, "u-1324");
  assert.equal(invoice.legacyPatient, "Test Patient A");
  assert.equal(invoice.totalCents, 125000);
  assert.equal(invoice.dueDate, "2026-02-15");
  assert.equal(isoDateIn(LAB_TIMEZONE, invoice.issuedAt), "2026-02-15");
  assert.equal(approximatedDate, true);
  assert.equal(detailed, false);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description, SUMMARY_LINE_DESCRIPTION);
  assert.equal(lines[0].lineCents, 125000);
  assert.equal(lines[0].priceSource, "legacy");
  assert.equal(lines[0].invoiceId, invoice.id);
});

test("a detailed invoice: real lines sealed later, an adjustment so lines + tax = Seazona's total", () => {
  const { invoice, lines, approximatedDate } = mapLegacyInvoice({ summary: byId("inv-b"), detail: details.get("inv-b"), ownerUserId: "u-1324" });
  assert.equal(invoice.taxCents, 1000);
  assert.equal(invoice.subtotalCents, 29000);
  assert.equal(invoice.totalCents, 30000);
  assert.equal(isoDateIn(LAB_TIMEZONE, invoice.issuedAt), "2026-01-30");
  assert.equal(approximatedDate, false);
  assert.deepEqual(lines.map((l) => [l.kind, l.code, l.lineCents]), [["item", "2608", 25000], ["item", "SHIP", 1500], ["adjustment", null, 2500]]);
  assert.equal(lines[0].description, LEGACY_LINE_DESCRIPTION);
  assert.equal(lines[0].legacyDescription, "DDSO Nylon — Test Patient B");
  assert.equal(lines.reduce((s, l) => s + l.lineCents, 0) + invoice.taxCents, invoice.totalCents);
});

test("a void Seazona invoice is void, voided when issued", () => {
  const { invoice } = mapLegacyInvoice({ summary: byId("inv-c"), ownerUserId: "u-2001" });
  assert.equal(invoice.status, "void");
  assert.equal(invoice.voidedAt.getTime(), invoice.issuedAt.getTime());
});

test("problems instead of guesses: a non-numeric number, an unloaded client, a negative total", () => {
  assert.deepEqual(mapLegacyInvoice({ summary: byId("inv-x"), ownerUserId: "u-2001" }), { problem: "invoice_number_not_numeric" });
  assert.deepEqual(mapLegacyInvoice({ summary: byId("inv-y"), ownerUserId: undefined }), { problem: "client_not_loaded" });
  assert.deepEqual(mapLegacyInvoice({ summary: { ...byId("inv-d"), total: -5 }, ownerUserId: "u-2001" }), { problem: "negative_total" });
});

test("plan: skips loaded invoices, refuses a taken number, counts what it approximated", () => {
  const records = summaries.map((p) => ({ seazonaId: p.id, payload: p }));
  const plan = planInvoices({ summaries: records, details, owners, existingSeazonaIds: new Set(["inv-d"]), existingNumbers: new Set([11120]) });
  assert.deepEqual(plan.rows.map((r) => r.invoice.legacySeazonaInvoiceId), ["inv-a", "inv-b"]);
  assert.equal(plan.counts.alreadyLoaded, 1);
  assert.equal(plan.counts.detailed, 1);
  assert.equal(plan.counts.approximatedDates, 1);
  assert.equal(plan.counts.totalCents, 155000);
  const kinds = Object.fromEntries(plan.problems.map((p) => [p.kind, p.seazonaIds]));
  assert.deepEqual(kinds.invoice_number_taken, ["inv-c"]);
  assert.deepEqual(kinds.invoice_number_not_numeric, ["inv-x"]);
  assert.deepEqual(kinds.client_not_loaded, ["inv-y"]);
  assert.ok(!JSON.stringify(plan.problems).includes("Patient"));
});
```

Create `apps/api/src/import/load-writer.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";
import { insertMissing } from "./load-writer.js";

const rows = [{ id: "1", key: "a" }, { id: "2", key: "b" }, { id: "3", key: "c" }];
const keyOf = (r) => r.key;

test("only rows whose key is not already there are inserted", async () => {
  const tx = fakeTx();
  const r = await insertMissing(tx, {}, rows, { keyOf, existingKeys: new Set(["b"]) });
  const inserts = tx.log.filter((e) => e.op === "insert");
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].values.map((v) => v.key), ["a", "c"]);
  assert.deepEqual([...r.insertedIds], ["1", "3"]);
  assert.equal(r.skipped, 1);
});

test("a re-run inserts nothing new", async () => {
  const tx = fakeTx();
  const r = await insertMissing(tx, {}, rows, { keyOf, existingKeys: new Set(["a", "b", "c"]) });
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.equal(r.insertedIds.size, 0);
  assert.equal(r.skipped, 3);
});

test("batches, and counts rows the database refused as conflicts", async () => {
  const many = Array.from({ length: 1100 }, (_, i) => ({ id: String(i), key: `k${i}` }));
  const tx = fakeTx();
  await insertMissing(tx, {}, many, { keyOf, existingKeys: new Set(), batch: 500 });
  assert.equal(tx.log.filter((e) => e.op === "insert").length, 3);

  const returning = { insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: "1" }] }) }) }) };
  const r = await insertMissing(returning, { id: "id" }, rows, { keyOf, existingKeys: new Set() });
  assert.deepEqual([...r.insertedIds], ["1"]);
  assert.equal(r.conflicts, 2);
});
```

Create `apps/api/src/import/seed-check.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { seazonaMaxNumbers, checkSeeds, enforceSeeds } from "./seed-check.js";
import { ImportRefusal } from "./import-errors.js";
import { fakeTx } from "../test/fake-tx.js";

const max = { invoice: 16_210, order: 98_000 };
const none = { invoice: 0, order: 0 };

test("Seazona's highest numbers come from the summaries; non-numeric ones are ignored", () => {
  const m = seazonaMaxNumbers({
    invoiceSummaries: [{ payload: { invoiceNumber: "11114" } }, { payload: { invoiceNumber: "16210" } }, { payload: { invoiceNumber: "X-1" } }],
    orderSummaries: [{ payload: { orderNumber: 98000 } }],
  });
  assert.deepEqual(m, max);
  assert.deepEqual(seazonaMaxNumbers({ invoiceSummaries: [], orderSummaries: [] }), { invoice: null, order: null });
});

test("production refuses starts at or below Seazona's highest, and missing starts", () => {
  const ok = checkSeeds({ target: "production", max, starts: { invoice: 16_211, order: 98_001 }, liveAtOrBelow: none });
  assert.deepEqual(ok.errors, []);
  const low = checkSeeds({ target: "production", max, starts: { invoice: 16_210, order: 98_001 }, liveAtOrBelow: none });
  assert.match(low.errors[0], /INVOICE_NUMBER_START \(16210\).*16211/);
  const missing = checkSeeds({ target: "production", max, starts: {}, liveAtOrBelow: none });
  assert.equal(missing.errors.length, 2);
});

test("rehearsal only warns about starts; a live number in Seazona's range is refused everywhere", () => {
  const r = checkSeeds({ target: "rehearsal", max, starts: { invoice: 500 }, liveAtOrBelow: none });
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  const clash = checkSeeds({ target: "rehearsal", max, starts: {}, liveAtOrBelow: { invoice: 2, order: 0 } });
  assert.match(clash.errors[0], /2 invoice\(s\).*16210/);
});

test("enforceSeeds throws on a live run with errors and only reports on a dry run", async () => {
  const raw = { records: async (e) => (e === "invoice" ? [{ payload: { invoiceNumber: "16210" } }] : []) };
  const db = () => fakeTx({ selects: [[{ n: 1 }], [{ n: 0 }]] });
  const dry = await enforceSeeds({ raw, db: db(), target: "rehearsal", live: false, starts: {} });
  assert.equal(dry.errors.length, 1);
  await assert.rejects(enforceSeeds({ raw, db: db(), target: "rehearsal", live: true, starts: {} }), ImportRefusal);
});
```

Create `apps/api/src/import/load-invoices.test.js`:

```js
process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeTx } from "../test/fake-tx.js";

const { loadInvoices } = await import("./load-invoices.js");
const load = (n) => JSON.parse(readFileSync(new URL(`../../test-fixtures/seazona/${n}`, import.meta.url), "utf8"));
const asRecords = (list) => list.map((p) => ({ seazonaId: p.id, payload: p, lastModified: p.lastModified ?? null }));
const raw = {
  records: async (e) => ({ invoice: asRecords(load("invoices.json")), invoice_detail: asRecords(load("invoice-details.json")) })[e] ?? [],
};
const users = [
  { id: "u-1324", seazonaClientId: "c-1324", seazonaAccountNumber: "1324", createdAt: new Date(0) },
  { id: "u-2001", seazonaClientId: "c-2001", seazonaAccountNumber: "2001", createdAt: new Date(0) },
];
// Select order: seed counts (invoices, lab orders), owners, existing invoices.
const db = (existing = []) => fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing] });

test("dry run: counts and seeds, no writes, no PHI in the report", async () => {
  const tx = db();
  const report = await loadInvoices({ raw, db: tx, live: false, target: "rehearsal", starts: {} });
  assert.equal(report.counts.toInsert, 4);
  assert.equal(report.seeds.seazonaMax.invoice, 11130);
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.ok(!JSON.stringify(report).includes("Test Patient"));
});

test("live: invoices sealed, lines sealed, each invoice's lines follow it", async () => {
  const tx = db();
  const report = await loadInvoices({ raw, db: tx, live: true, target: "rehearsal", starts: {} });
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  const invoiceRows = inserts.find((v) => v[0]?.kind === "legacy");
  assert.equal(invoiceRows.length, 4);
  assert.match(invoiceRows[0].legacyPatient, /^enc:v1:/);
  const lineRows = inserts.filter((v) => v[0]?.priceSource === "legacy").flat();
  assert.equal(lineRows.length, 6, "inv-a, inv-c, inv-d one line each; inv-b three");
  assert.ok(lineRows.some((l) => /^enc:v1:/.test(l.legacyDescription ?? "")));
  assert.equal(report.written.invoices, 4);
  assert.ok(!JSON.stringify(inserts).includes("Test Patient"));
});

test("a re-run inserts nothing new", async () => {
  const existing = ["inv-a", "inv-b", "inv-c", "inv-d"].map((id, i) => ({ seazonaId: id, number: 11114 + i }));
  const tx = db(existing);
  const report = await loadInvoices({ raw, db: tx, live: true, target: "rehearsal", starts: {} });
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.equal(report.counts.alreadyLoaded, 4);
});
```

Note on the re-run fixture: `existing` numbers don't matter for skipping (the Seazona id does); they are given distinct values so no `invoice_number_taken` problem fires for a loaded row's own number.

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/import/map-invoices.test.js src/import/load-writer.test.js src/import/seed-check.test.js src/import/load-invoices.test.js`
Expected: FAIL (modules missing).

- [ ] **Step 4: The invoice mapper**

Create `apps/api/src/import/map-invoices.js`:

```js
import { toCents, LEGACY_LINE_DESCRIPTION } from "@my-app/shared";
import { createId } from "../lib/id.js";
import { invoiceStatusFor, recordDate, recordNumber, firstString, INVOICE_NUMBER_FIELDS } from "./seazona-records.js";

/**
 * Seazona invoice (summary + optional detail) → one `kind: legacy` invoice and
 * its lines, unsealed (load-invoices.js seals with sealInvoice/sealLine).
 * Seazona's total is kept to the cent; lines add up to total − tax (Spec
 * correction 6). A record we can't map becomes { problem } — never a guess.
 */
export const SUMMARY_LINE_DESCRIPTION = "Seazona invoice — see archive";
const ADJUSTMENT_DESCRIPTION = "Seazona adjustment (discounts, services, rounding)";
const ITEM_LISTS = ["productServiceItems", "items", "lines", "products"];

export function centsOf(value) {
  if (value == null || value === "") return null;
  try {
    const c = toCents(String(value).replace(/[$,\s]/g, ""));
    return Number.isSafeInteger(c) ? c : null;
  } catch {
    return null;
  }
}

/** A lab-local calendar day as an instant at 17:00 UTC (11:00–12:00 in San Antonio): the day never shifts. */
export const labNoon = (isoDay) => new Date(`${isoDay}T17:00:00Z`);

const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * The day a legacy invoice was issued: its own date (detail first, then the
 * summary), else its due date (`approximated`). The parity report uses the
 * same rule, so both sides count an invoice in the same year.
 */
export function legacyIssueDay(summary, detail = null) {
  const own = recordDate("invoice", { ...(detail ?? {}), due: undefined }) ?? recordDate("invoice", { ...summary, due: undefined });
  return { day: own ?? dayOf(summary?.due), approximated: !own };
}

const detailItems = (detail) => ITEM_LISTS.map((k) => detail?.[k]).find(Array.isArray) ?? null;

function mapItem(item) {
  const quantity = Number(item?.quantity ?? item?.qty ?? 1);
  let qty = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
  let unitCents = centsOf(item?.price ?? item?.unitPrice ?? item?.rate);
  let lineCents = centsOf(item?.total ?? item?.amount ?? item?.lineTotal);
  if (lineCents == null && unitCents != null) lineCents = unitCents * qty;
  if (lineCents == null) return null;
  if (unitCents == null || unitCents * qty !== lineCents) {
    qty = 1;
    unitCents = lineCents;
  }
  const code = firstString(item, ["code", "productCode"]);
  return {
    kind: lineCents < 0 ? "adjustment" : "item",
    code: code ? code.slice(0, 60) : null,
    description: LEGACY_LINE_DESCRIPTION,
    legacyDescription: firstString(item, ["name", "description", "productName"]),
    qty, unitCents, lineCents,
  };
}

const line = (invoiceId, position, l) => ({
  id: createId(), invoiceId, position, variantId: null, taxable: false, priceSource: "legacy",
  priceNote: null, labOrderLineId: null, shipmentId: null, legacyDescription: null, ...l,
});

function buildLines(invoiceId, detail, subtotalCents) {
  const items = (detailItems(detail) ?? []).map(mapItem).filter(Boolean);
  if (items.length === 0) {
    return [line(invoiceId, 0, {
      kind: subtotalCents < 0 ? "adjustment" : "item", code: null, description: SUMMARY_LINE_DESCRIPTION,
      qty: 1, unitCents: subtotalCents, lineCents: subtotalCents,
    })];
  }
  const out = items.map((it, i) => line(invoiceId, i, it));
  const diff = subtotalCents - out.reduce((s, l) => s + l.lineCents, 0);
  if (diff !== 0) out.push(line(invoiceId, out.length, { kind: "adjustment", code: null, description: ADJUSTMENT_DESCRIPTION, qty: 1, unitCents: diff, lineCents: diff }));
  return out;
}

export function mapLegacyInvoice({ summary, detail = null, ownerUserId }) {
  const invoiceNumber = recordNumber(summary, INVOICE_NUMBER_FIELDS) ?? recordNumber(detail, INVOICE_NUMBER_FIELDS);
  if (!invoiceNumber) return { problem: "invoice_number_not_numeric" };
  if (!ownerUserId) return { problem: "client_not_loaded" };
  const totalCents = centsOf(summary.total);
  if (totalCents == null) return { problem: "total_not_money" };
  if (totalCents < 0) return { problem: "negative_total" };
  const taxCents = centsOf(summary.tax) ?? 0;
  const dueDate = dayOf(summary.due);
  const { day: issuedDay, approximated } = legacyIssueDay(summary, detail);
  if (!issuedDay) return { problem: "no_date" };

  const id = createId();
  const status = invoiceStatusFor(summary.status);
  const issuedAt = labNoon(issuedDay);
  const subtotalCents = totalCents - taxCents;
  const invoice = {
    id, invoiceNumber, kind: "legacy", clientUserId: ownerUserId, labOrderId: null,
    legacySeazonaInvoiceId: String(summary.id), legacyPatient: firstString(summary, ["patient", "patientName"]),
    status, version: 1, issuedAt, dueDate, voidedAt: status === "void" ? issuedAt : null, voidReason: null,
    subtotalCents, taxCents, shippingCents: 0, totalCents, notes: null,
  };
  return { invoice, lines: buildLines(id, detail, subtotalCents), approximatedDate: approximated, detailed: Boolean(detailItems(detail)) };
}

function problemList(byKind) {
  return [...byKind].map(([kind, ids]) => ({ kind, count: ids.length, seazonaIds: ids.slice(0, 50) }));
}

/** Every summary → rows to insert (unsealed), with counts and problems (Seazona ids only). */
export function planInvoices({ summaries, details, owners, existingSeazonaIds, existingNumbers }) {
  const rows = [];
  const problems = new Map();
  const flag = (kind, id) => problems.set(kind, [...(problems.get(kind) ?? []), id]);
  const counts = { seazona: summaries.length, toInsert: 0, alreadyLoaded: 0, detailed: 0, summaryOnly: 0, approximatedDates: 0, void: 0, totalCents: 0 };
  const numbers = new Set(existingNumbers);
  for (const { seazonaId, payload } of summaries) {
    if (existingSeazonaIds.has(seazonaId)) { counts.alreadyLoaded += 1; continue; }
    const mapped = mapLegacyInvoice({ summary: payload, detail: details.get(seazonaId) ?? null, ownerUserId: owners.get(String(payload.clientId)) });
    if (mapped.problem) { flag(mapped.problem, seazonaId); continue; }
    if (numbers.has(mapped.invoice.invoiceNumber)) { flag("invoice_number_taken", seazonaId); continue; }
    numbers.add(mapped.invoice.invoiceNumber);
    rows.push({ invoice: mapped.invoice, lines: mapped.lines });
    counts.toInsert += 1;
    counts[mapped.detailed ? "detailed" : "summaryOnly"] += 1;
    if (mapped.approximatedDate) counts.approximatedDates += 1;
    if (mapped.invoice.status === "void") counts.void += 1;
    else counts.totalCents += mapped.invoice.totalCents;
  }
  return { rows, counts, problems: problemList(problems) };
}
```

Check against the plan test: `inv-c` is void and its number 11120 is in `existingNumbers` in that test, so it lands in `invoice_number_taken`; `totalCents` = 125000 + 30000 = 155000 (inv-a + inv-b; inv-d is already loaded).

- [ ] **Step 5: The writer and the seed check**

Create `apps/api/src/import/load-writer.js`:

```js
/**
 * Insert the rows whose legacy key isn't already in the target, in batches.
 * `existingKeys` comes from a select the caller made this run, so a re-run
 * inserts nothing. ON CONFLICT DO NOTHING is the backstop for a race or a
 * clash on another unique index (e.g. an invoice number); `.returning` tells
 * us what actually landed, and the rest is reported as `conflicts`. (fakeTx
 * resolves inserts to undefined: then every row counts as inserted.)
 */
export async function insertMissing(tx, table, rows, { keyOf, existingKeys, idOf = (r) => r.id, batch = 500 }) {
  const fresh = rows.filter((r) => !existingKeys.has(keyOf(r)));
  const insertedIds = new Set();
  let conflicts = 0;
  for (let i = 0; i < fresh.length; i += batch) {
    const chunk = fresh.slice(i, i + batch);
    const res = await tx.insert(table).values(chunk).onConflictDoNothing().returning({ id: table.id });
    const landed = Array.isArray(res) ? res.map((r) => r.id) : chunk.map(idOf);
    for (const id of landed) insertedIds.add(id);
    conflicts += chunk.length - landed.length;
  }
  return { insertedIds, skipped: rows.length - fresh.length, conflicts };
}
```

Create `apps/api/src/import/seed-check.js`:

```js
import { and, lte, ne, sql } from "drizzle-orm";
import { invoices, labOrders } from "../db/schema/index.js";
import { recordNumber, INVOICE_NUMBER_FIELDS, ORDER_NUMBER_FIELDS } from "./seazona-records.js";
import { ImportRefusal } from "./import-errors.js";

/**
 * Number seeds (spec "Number seeds"): imported history keeps Seazona's
 * numbers; new invoices and lab orders continue from INVOICE_NUMBER_START /
 * LAB_ORDER_NUMBER_START (allocation is max(existing + 1, start)). A production
 * load is refused unless both starts are above Seazona's highest numbers, and
 * any load is refused when a number this system already issued sits in
 * Seazona's range. `starts` are the values set on Cloud Run, passed as flags.
 */
const highest = (summaries, fields) =>
  summaries.reduce((m, s) => {
    const n = recordNumber(s.payload, fields);
    return n != null && (m == null || n > m) ? n : m;
  }, null);

export function seazonaMaxNumbers({ invoiceSummaries, orderSummaries }) {
  return { invoice: highest(invoiceSummaries, INVOICE_NUMBER_FIELDS), order: highest(orderSummaries, ORDER_NUMBER_FIELDS) };
}

const ENV_NAME = { invoice: "INVOICE_NUMBER_START", order: "LAB_ORDER_NUMBER_START" };

export function checkSeeds({ target, max, starts = {}, liveAtOrBelow }) {
  const errors = [];
  const warnings = [];
  for (const kind of ["invoice", "order"]) {
    const top = max[kind];
    if (top == null) continue;
    const start = starts[kind];
    if (target === "production" && !Number.isSafeInteger(start)) {
      errors.push(`--${kind}-start is required for a production load (the ${ENV_NAME[kind]} set on Cloud Run; at least ${top + 1}).`);
    } else if (Number.isSafeInteger(start) && start <= top) {
      (target === "production" ? errors : warnings).push(`${ENV_NAME[kind]} (${start}) must be above Seazona's highest ${kind} number (${top}): set it to ${top + 1}.`);
    }
    if (liveAtOrBelow[kind] > 0) {
      errors.push(`${liveAtOrBelow[kind]} ${kind}(s) created in this system already hold a number at or below Seazona's highest (${top}). Stop: they collide with imported history.`);
    }
  }
  return { errors, warnings };
}

export async function liveNumbersAtOrBelow(db, max) {
  const [inv] = await db.select({ n: sql`count(*)` }).from(invoices)
    .where(and(ne(invoices.kind, "legacy"), lte(invoices.invoiceNumber, max.invoice ?? 0)));
  const [ord] = await db.select({ n: sql`count(*)` }).from(labOrders)
    .where(and(ne(labOrders.source, "legacy"), lte(labOrders.orderNumber, max.order ?? 0)));
  return { invoice: Number(inv?.n ?? 0), order: Number(ord?.n ?? 0) };
}

export async function enforceSeeds({ raw, db, target, live, starts = {}, invoiceSummaries, orderSummaries }) {
  const max = seazonaMaxNumbers({
    invoiceSummaries: invoiceSummaries ?? (await raw.records("invoice")),
    orderSummaries: orderSummaries ?? (await raw.records("order")),
  });
  const liveAtOrBelow = await liveNumbersAtOrBelow(db, max);
  const { errors, warnings } = checkSeeds({ target, max, starts, liveAtOrBelow });
  if (live && errors.length) throw new ImportRefusal(`Number seeds: ${errors.join(" ")}`);
  return { max, errors, warnings, summary: { seazonaMax: max, starts, liveAtOrBelow, errors, warnings } };
}
```

- [ ] **Step 6: The load step**

Create `apps/api/src/import/load-invoices.js`:

```js
import { isNotNull } from "drizzle-orm";
import { invoices, invoiceLines, users } from "../db/schema/index.js";
import { sealInvoice, sealLine } from "../services/billing/invoice-crypto.js";
import { ownerIndex } from "./map-clients.js";
import { planInvoices } from "./map-invoices.js";
import { insertMissing } from "./load-writer.js";
import { enforceSeeds } from "./seed-check.js";

const BATCH = 500;

/**
 * `import:load invoices`: one `kind: legacy` invoice per Seazona invoice, with
 * its lines. Owners come from the clients step (run it first). Each batch of
 * 500 invoices and their lines is one transaction; a re-run skips every
 * invoice already loaded (by legacy_seazona_invoice_id).
 */
export async function loadInvoices({ raw, db, live, target, starts = {} }) {
  const summaries = await raw.records("invoice");
  const details = new Map((await raw.records("invoice_detail")).map((r) => [r.seazonaId, r.payload]));
  const seeds = await enforceSeeds({ raw, db, target, live, starts, invoiceSummaries: summaries });
  const userRows = await db
    .select({ id: users.id, seazonaClientId: users.seazonaClientId, seazonaAccountNumber: users.seazonaAccountNumber, createdAt: users.createdAt })
    .from(users)
    .where(isNotNull(users.seazonaClientId));
  const existing = await db.select({ seazonaId: invoices.legacySeazonaInvoiceId, number: invoices.invoiceNumber }).from(invoices);
  const existingSeazonaIds = new Set(existing.map((r) => r.seazonaId).filter(Boolean));
  const plan = planInvoices({
    summaries, details, owners: ownerIndex(userRows), existingSeazonaIds,
    existingNumbers: new Set(existing.filter((r) => !existingSeazonaIds.has(r.seazonaId)).map((r) => r.number)),
  });
  const report = { step: "invoices", live, counts: plan.counts, seeds: seeds.summary, problems: plan.problems };
  if (!live) return report;

  let written = 0;
  let conflicts = 0;
  for (let i = 0; i < plan.rows.length; i += BATCH) {
    const chunk = plan.rows.slice(i, i + BATCH);
    await db.transaction(async (tx) => {
      const r = await insertMissing(tx, invoices, chunk.map((x) => sealInvoice(x.invoice)), {
        keyOf: (inv) => inv.legacySeazonaInvoiceId, existingKeys: existingSeazonaIds,
      });
      const lines = chunk.filter((x) => r.insertedIds.has(x.invoice.id)).flatMap((x) => x.lines.map(sealLine));
      for (let j = 0; j < lines.length; j += BATCH) await tx.insert(invoiceLines).values(lines.slice(j, j + BATCH));
      written += r.insertedIds.size;
      conflicts += r.conflicts;
    });
  }
  report.written = { invoices: written, conflicts };
  return report;
}
```

`existingNumbers` excludes the loaded legacy rows' own numbers, so a re-run never reports its own invoices as "taken"; a number held by a live invoice is still caught (and the seed check refuses it first).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/import`
Expected: PASS. In `load-invoices.test.js`'s dry run, `inv-x` (non-numeric) and `inv-y` (unknown client) are problems, so `toInsert` is 4 (a, b, c, d) and the highest numeric Seazona number is 11130 (inv-y still counts toward the seed).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/import apps/api/test-fixtures/seazona/invoices.json apps/api/test-fixtures/seazona/invoice-details.json
git commit -m "feat(import): legacy invoices from the raw store, sealed and idempotent; number-seed checks

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Opening balances: per-invoice and per-client plans, the `balances` load step

**Files:**
- Create: `apps/api/src/import/balance-plan.js`, `apps/api/src/import/balance-plan.test.js`
- Create: `apps/api/src/import/load-balances.js`, `apps/api/src/import/load-balances.test.js`
- Modify: `apps/api/src/db/schema/invoice-payments.js` (header and `source` comments only; no schema change)

**Interfaces:**
- Consumes: `readExport` rows (Task 8: `{ key, cents, line }`), `insertMissing`, `enforceSeeds` (Task 11), `accountOwnerIndex` (Task 10), `sealInvoice` / `sealLine` (Task 2), `allocateSequenceNumber` (`services/sequence.service.js`), `INVOICE_NUMBER_LOCK` (`services/billing/invoices.service.js`), shared `LEGACY_SETTLEMENT_SOURCE`, `OPENING_BALANCE_PREFIX`, `isOpeningBalanceInvoice`, `isoDateIn`, `LAB_TIMEZONE` (Task 1).
- Produces:
  - `balance-plan.js`: `SETTLEMENT_PREFIX = { "per-invoice": "legacy:", "per-client": "legacy-full:" }`, `OPENING_LINE_DESCRIPTION`, `settlementRow(invoice, cents, mode)`, `planInvoiceSettlements({ legacyInvoices, exportRows, existingTransactionIds }) → { rows, credits, unmatched, overTotal, openOnVoid, alreadySettled, openByClient }`, `planClientOpenings({ legacyInvoices, exportRows, ownerByAccount, existingTransactionIds, existingOpeningKeys }) → { settlements, openings, credits, unmatched, alreadySettled, alreadyOpened }`, `mapOpeningInvoice({ opening, invoiceNumber, cutoverAt }) → { invoice, lines }`.
  - `legacyInvoices` rows: `{ id, invoiceNumber, kind, legacySeazonaInvoiceId, clientUserId, status, totalCents, issuedAt }`.
  - `load-balances.js`: `loadBalances({ raw, db, live, target, mode, parsed, fileId, starts, cutoverAt }) → report`, `writeOpening(tx, { opening, start, cutoverAt }) → invoice`.
- The transaction-id prefix records which path a target was loaded with; switching paths on the same target is refused.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/import/balance-plan.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { isoDateIn, LAB_TIMEZONE, LEGACY_SETTLEMENT_SOURCE } from "@my-app/shared";
import { planInvoiceSettlements, planClientOpenings, mapOpeningInvoice, OPENING_LINE_DESCRIPTION } from "./balance-plan.js";

const inv = (n, total, extra = {}) => ({
  id: `id-${n}`, invoiceNumber: n, kind: "legacy", legacySeazonaInvoiceId: `inv-${n}`, clientUserId: "u-1324",
  status: "issued", totalCents: total, issuedAt: new Date("2026-01-30T17:00:00Z"), ...extra,
});
const legacy = [
  inv(11114, 125000),
  inv(11115, 30000),
  inv(11120, 8000, { status: "void", clientUserId: "u-2001" }),
  inv(11121, 9500, { clientUserId: "u-2001" }),
  inv(16300, 50000, { legacySeazonaInvoiceId: "opening:1324" }),
];
// Rows as readExport returns them for test-fixtures/seazona/invoices-export.xls, plus one unknown invoice.
const invoiceRows = [{ key: 11114, cents: 125000 }, { key: 11115, cents: 12050 }, { key: 11120, cents: -2000 }, { key: 11999, cents: 500 }];

test("per-invoice: each invoice settles total − open; untouched invoices settle in full", () => {
  const plan = planInvoiceSettlements({ legacyInvoices: legacy, exportRows: invoiceRows, existingTransactionIds: new Set() });
  assert.deepEqual(plan.rows.map((r) => [r.invoiceNumber, r.appliedCents, r.transactionId]), [["11115", 17950, "legacy:inv-11115"], ["11121", 9500, "legacy:inv-11121"]]);
  const r = plan.rows[0];
  assert.equal(r.source, LEGACY_SETTLEMENT_SOURCE);
  assert.equal(r.invoiceId, "id-11115");
  assert.equal(r.userId, null, "a settlement is not a payment anyone made");
  assert.equal(r.paidOn, isoDateIn(LAB_TIMEZONE, new Date("2026-01-30T17:00:00Z")), "dated the day the invoice was issued");
  assert.equal(plan.openByClient.get("u-1324"), 137050);
  assert.deepEqual(plan.unmatched, [11999]);
  assert.deepEqual(plan.openOnVoid, [11120]);
  assert.equal(plan.rows.some((x) => x.invoiceNumber === "16300"), false, "an opening-balance invoice is never settled here");
});

test("per-invoice: an open balance above the total is reported, a credit is reported and nothing goes below zero", () => {
  const plan = planInvoiceSettlements({
    legacyInvoices: [inv(1, 1000), inv(2, 1000)], exportRows: [{ key: 1, cents: 1500 }, { key: 2, cents: -300 }], existingTransactionIds: new Set(),
  });
  assert.deepEqual(plan.overTotal, [1]);
  assert.deepEqual(plan.credits, [{ invoiceNumber: 2, clientUserId: "u-1324", cents: -300 }]);
  assert.deepEqual(plan.rows.map((r) => [r.invoiceNumber, r.appliedCents]), [["2", 1000]]);
});

test("per-invoice: a re-run with the same export writes nothing new", () => {
  const first = planInvoiceSettlements({ legacyInvoices: legacy, exportRows: invoiceRows, existingTransactionIds: new Set() });
  const again = planInvoiceSettlements({ legacyInvoices: legacy, exportRows: invoiceRows, existingTransactionIds: new Set(first.rows.map((r) => r.transactionId)) });
  assert.equal(again.rows.length, 0);
  assert.equal(again.alreadySettled, 2);
});

test("per-client: every history invoice settles in full; one opening invoice per owing client", () => {
  const plan = planClientOpenings({
    legacyInvoices: legacy,
    exportRows: [{ key: "1324", cents: 137050 }, { key: "2001", cents: -2000 }, { key: "3005", cents: 0 }, { key: "7777", cents: 900 }],
    ownerByAccount: new Map([["1324", "u-1324"], ["2001", "u-2001"]]),
    existingTransactionIds: new Set(),
    existingOpeningKeys: new Set(),
  });
  assert.deepEqual(plan.settlements.map((r) => [r.invoiceNumber, r.appliedCents, r.transactionId]), [
    ["11114", 125000, "legacy-full:inv-11114"], ["11115", 30000, "legacy-full:inv-11115"], ["11121", 9500, "legacy-full:inv-11121"],
  ]);
  assert.deepEqual(plan.openings, [{ accountNumber: "1324", clientUserId: "u-1324", cents: 137050 }]);
  assert.deepEqual(plan.credits, [{ accountNumber: "2001", clientUserId: "u-2001", cents: -2000 }]);
  assert.deepEqual(plan.unmatched, ["7777"]);
});

test("per-client: an existing opening invoice is not created again", () => {
  const plan = planClientOpenings({
    legacyInvoices: [], exportRows: [{ key: "1324", cents: 100 }], ownerByAccount: new Map([["1324", "u"]]),
    existingTransactionIds: new Set(), existingOpeningKeys: new Set(["opening:1324"]),
  });
  assert.equal(plan.openings.length, 0);
  assert.equal(plan.alreadyOpened, 1);
});

test("the opening invoice is legacy, issued at cutover, due that day, one clear line", () => {
  const cutoverAt = new Date("2026-11-07T02:00:00Z"); // Friday evening in San Antonio
  const { invoice, lines } = mapOpeningInvoice({ opening: { accountNumber: "1324", clientUserId: "u-1324", cents: 137050 }, invoiceNumber: 16211, cutoverAt });
  assert.equal(invoice.kind, "legacy");
  assert.equal(invoice.legacySeazonaInvoiceId, "opening:1324");
  assert.equal(invoice.status, "issued");
  assert.equal(invoice.totalCents, 137050);
  assert.equal(invoice.dueDate, "2026-11-06", "the lab-local cutover day");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description, OPENING_LINE_DESCRIPTION);
  assert.equal(lines[0].lineCents, 137050);
});
```

Create `apps/api/src/import/load-balances.test.js`:

```js
process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";

const { loadBalances, writeOpening } = await import("./load-balances.js");
const { ImportRefusal } = await import("./import-errors.js");

const legacyRows = [
  { id: "id-1", invoiceNumber: 1, kind: "legacy", legacySeazonaInvoiceId: "inv-1", clientUserId: "u", status: "issued", totalCents: 1000, issuedAt: new Date("2026-01-01T17:00:00Z") },
  { id: "id-2", invoiceNumber: 2, kind: "legacy", legacySeazonaInvoiceId: "inv-2", clientUserId: "u", status: "issued", totalCents: 500, issuedAt: new Date("2026-01-02T17:00:00Z") },
];
const parsed = { rows: [{ key: 1, cents: 400 }], problems: [] };
const raw = { records: async () => [] };

test("per-invoice live: settlement rows are written once", async () => {
  const tx = fakeTx({ selects: [legacyRows, []] });
  const report = await loadBalances({ raw, db: tx, live: true, target: "rehearsal", mode: "per-invoice", parsed, fileId: "f1" });
  const rows = tx.log.filter((e) => e.op === "insert").flatMap((e) => e.values);
  assert.deepEqual(rows.map((r) => [r.transactionId, r.appliedCents]), [["legacy:inv-1", 600], ["legacy:inv-2", 500]]);
  assert.equal(report.counts.openCents, 400);

  const again = fakeTx({ selects: [legacyRows, [{ transactionId: "legacy:inv-1" }, { transactionId: "legacy:inv-2" }]] });
  await loadBalances({ raw, db: again, live: true, target: "rehearsal", mode: "per-invoice", parsed, fileId: "f1" });
  assert.equal(again.log.some((e) => e.op === "insert"), false);
});

test("switching paths on a loaded target is refused", async () => {
  const tx = fakeTx({ selects: [legacyRows, [{ transactionId: "legacy-full:inv-1" }]] });
  await assert.rejects(loadBalances({ raw, db: tx, live: false, target: "rehearsal", mode: "per-invoice", parsed }), ImportRefusal);
  await assert.rejects(loadBalances({ raw, db: fakeTx(), live: false, target: "rehearsal", mode: "both", parsed }), /per-invoice or per-client/);
});

test("an opening invoice takes the next live invoice number and is sealed", async () => {
  const tx = fakeTx({ selects: [[{ max: 16210 }]] });
  const invoice = await writeOpening(tx, { opening: { accountNumber: "1324", clientUserId: "u", cents: 900 }, start: 16211, cutoverAt: new Date("2026-11-07T02:00:00Z") });
  assert.equal(invoice.invoiceNumber, 16211);
  assert.ok(tx.log.some((e) => e.op === "execute"), "under the invoice-number advisory lock");
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  assert.equal(inserts[0].legacySeazonaInvoiceId, "opening:1324");
  assert.equal(inserts[1][0].description, "Opening balance (carried from Seazona)");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/import/balance-plan.test.js src/import/load-balances.test.js`
Expected: FAIL (modules missing).

- [ ] **Step 3: The balance plans**

Create `apps/api/src/import/balance-plan.js`:

```js
import { isoDateIn, LAB_TIMEZONE, LEGACY_SETTLEMENT_SOURCE, OPENING_BALANCE_PREFIX, isOpeningBalanceInvoice } from "@my-app/shared";
import { createId } from "../lib/id.js";

/**
 * Opening balances (spec B.3). Paid and balance are derived from the ledger,
 * so a legacy invoice's settled part becomes one ledger row:
 *  - per-invoice (preferred): settle total − Seazona's open balance; aging stays exact.
 *  - per-client (fallback): settle every history invoice in full, and give each
 *    owing client one "Opening balance" invoice dated at cutover (aging restarts).
 * Credits (negative balances) are never written: they are reported for staff.
 * The transaction-id prefix records the path, so a target loaded one way
 * refuses the other.
 */
export const SETTLEMENT_PREFIX = { "per-invoice": "legacy:", "per-client": "legacy-full:" };
export const OPENING_LINE_DESCRIPTION = "Opening balance (carried from Seazona)";

const history = (invoices) => invoices.filter((i) => i.kind === "legacy" && !isOpeningBalanceInvoice(i));

export function settlementRow(inv, cents, mode) {
  return {
    id: createId(), userId: null, invoiceId: inv.id, seazonaClientId: null, seazonaInvoiceId: inv.legacySeazonaInvoiceId,
    invoiceNumber: String(inv.invoiceNumber), appliedCents: cents,
    transactionId: `${SETTLEMENT_PREFIX[mode]}${inv.legacySeazonaInvoiceId}`,
    seazonaPaymentId: null, refundsTransactionId: null, source: LEGACY_SETTLEMENT_SOURCE,
    paidOn: isoDateIn(LAB_TIMEZONE, new Date(inv.issuedAt)), reference: null, note: null,
  };
}

export function planInvoiceSettlements({ legacyInvoices, exportRows, existingTransactionIds }) {
  const open = new Map(exportRows.map((r) => [r.key, r.cents]));
  const byNumber = new Map(history(legacyInvoices).map((i) => [i.invoiceNumber, i]));
  const out = { rows: [], credits: [], unmatched: [], overTotal: [], openOnVoid: [], alreadySettled: 0, openByClient: new Map() };
  for (const [number, cents] of open) {
    const inv = byNumber.get(number);
    if (!inv) out.unmatched.push(number);
    else if (inv.status === "void" && cents !== 0) out.openOnVoid.push(number);
  }
  for (const inv of history(legacyInvoices).filter((i) => i.status === "issued")) {
    const owed = open.get(inv.invoiceNumber) ?? 0;
    if (owed > inv.totalCents) { out.overTotal.push(inv.invoiceNumber); continue; }
    if (owed < 0) out.credits.push({ invoiceNumber: inv.invoiceNumber, clientUserId: inv.clientUserId, cents: owed });
    const remaining = Math.max(owed, 0);
    out.openByClient.set(inv.clientUserId, (out.openByClient.get(inv.clientUserId) ?? 0) + remaining);
    const settle = inv.totalCents - remaining;
    if (settle <= 0) continue;
    const row = settlementRow(inv, settle, "per-invoice");
    if (existingTransactionIds.has(row.transactionId)) { out.alreadySettled += 1; continue; }
    out.rows.push(row);
  }
  return out;
}

export function planClientOpenings({ legacyInvoices, exportRows, ownerByAccount, existingTransactionIds, existingOpeningKeys }) {
  const out = { settlements: [], openings: [], credits: [], unmatched: [], alreadySettled: 0, alreadyOpened: 0 };
  for (const inv of history(legacyInvoices).filter((i) => i.status === "issued" && i.totalCents > 0)) {
    const row = settlementRow(inv, inv.totalCents, "per-client");
    if (existingTransactionIds.has(row.transactionId)) { out.alreadySettled += 1; continue; }
    out.settlements.push(row);
  }
  for (const { key, cents } of exportRows) {
    if (cents === 0) continue;
    const clientUserId = ownerByAccount.get(key);
    if (!clientUserId) { out.unmatched.push(key); continue; }
    if (cents < 0) { out.credits.push({ accountNumber: key, clientUserId, cents }); continue; }
    if (existingOpeningKeys.has(`${OPENING_BALANCE_PREFIX}${key}`)) { out.alreadyOpened += 1; continue; }
    out.openings.push({ accountNumber: key, clientUserId, cents });
  }
  return out;
}

export function mapOpeningInvoice({ opening, invoiceNumber, cutoverAt }) {
  const id = createId();
  const invoice = {
    id, invoiceNumber, kind: "legacy", clientUserId: opening.clientUserId, labOrderId: null,
    legacySeazonaInvoiceId: `${OPENING_BALANCE_PREFIX}${opening.accountNumber}`, legacyPatient: null,
    status: "issued", version: 1, issuedAt: cutoverAt, dueDate: isoDateIn(LAB_TIMEZONE, cutoverAt), voidedAt: null, voidReason: null,
    subtotalCents: opening.cents, taxCents: 0, shippingCents: 0, totalCents: opening.cents, notes: null,
  };
  const lines = [{
    id: createId(), invoiceId: id, position: 0, kind: "item", variantId: null, code: null,
    description: OPENING_LINE_DESCRIPTION, legacyDescription: null, qty: 1, unitCents: opening.cents, lineCents: opening.cents,
    taxable: false, priceSource: "legacy", priceNote: null, labOrderLineId: null, shipmentId: null,
  }];
  return { invoice, lines };
}
```

- [ ] **Step 4: The load step**

Create `apps/api/src/import/load-balances.js`:

```js
import { eq, isNotNull } from "drizzle-orm";
import { LEGACY_SETTLEMENT_SOURCE, OPENING_BALANCE_PREFIX } from "@my-app/shared";
import { invoices, invoiceLines, invoicePayments, users } from "../db/schema/index.js";
import { sealInvoice, sealLine } from "../services/billing/invoice-crypto.js";
import { INVOICE_NUMBER_LOCK } from "../services/billing/invoices.service.js";
import { allocateSequenceNumber } from "../services/sequence.service.js";
import { accountOwnerIndex } from "./map-clients.js";
import { SETTLEMENT_PREFIX, planInvoiceSettlements, planClientOpenings, mapOpeningInvoice } from "./balance-plan.js";
import { insertMissing } from "./load-writer.js";
import { enforceSeeds } from "./seed-check.js";
import { ImportRefusal } from "./import-errors.js";

const BATCH = 500;
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const problem = (kind, keys) => ({ kind, count: keys.length, keys: keys.slice(0, 50) });

/** One opening-balance invoice in the caller's transaction, numbered from the live sequence. */
export async function writeOpening(tx, { opening, start, cutoverAt }) {
  const invoiceNumber = await allocateSequenceNumber(tx, { lockId: INVOICE_NUMBER_LOCK, table: invoices, column: invoices.invoiceNumber, start });
  const { invoice, lines } = mapOpeningInvoice({ opening, invoiceNumber, cutoverAt });
  await tx.insert(invoices).values(sealInvoice(invoice));
  await tx.insert(invoiceLines).values(lines.map(sealLine));
  return invoice;
}

async function writeSettlements(db, rows, existingKeys) {
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.transaction(async (tx) => {
      const r = await insertMissing(tx, invoicePayments, rows.slice(i, i + BATCH), { keyOf: (row) => row.transactionId, existingKeys });
      written += r.insertedIds.size;
    });
  }
  return written;
}

async function perInvoice({ db, live, legacy, parsed, existingTransactionIds, report }) {
  const plan = planInvoiceSettlements({ legacyInvoices: legacy, exportRows: parsed.rows, existingTransactionIds });
  report.counts = {
    exportRows: parsed.rows.length, settlements: plan.rows.length, settledCents: sum(plan.rows, (r) => r.appliedCents),
    alreadySettled: plan.alreadySettled, openCents: sum([...plan.openByClient.values()], (c) => c),
    credits: plan.credits.length, creditCents: sum(plan.credits, (c) => c.cents),
  };
  report.problems = [
    problem("export_row_without_invoice", plan.unmatched),
    problem("open_balance_above_total", plan.overTotal),
    problem("open_balance_on_void_invoice", plan.openOnVoid),
    problem("credit_balance_for_staff", plan.credits.map((c) => c.invoiceNumber)),
  ].filter((p) => p.count);
  if (live) report.written = { settlements: await writeSettlements(db, plan.rows, existingTransactionIds) };
  return report;
}

async function perClient({ raw, db, live, target, legacy, parsed, existingTransactionIds, starts, cutoverAt, report }) {
  const userRows = await db
    .select({ id: users.id, seazonaClientId: users.seazonaClientId, seazonaAccountNumber: users.seazonaAccountNumber, createdAt: users.createdAt })
    .from(users)
    .where(isNotNull(users.seazonaAccountNumber));
  const plan = planClientOpenings({
    legacyInvoices: legacy, exportRows: parsed.rows, ownerByAccount: accountOwnerIndex(userRows), existingTransactionIds,
    existingOpeningKeys: new Set(legacy.map((i) => i.legacySeazonaInvoiceId).filter((k) => k?.startsWith(OPENING_BALANCE_PREFIX))),
  });
  const seeds = await enforceSeeds({ raw, db, target, live, starts });
  report.seeds = seeds.summary;
  report.counts = {
    exportRows: parsed.rows.length, settlements: plan.settlements.length, alreadySettled: plan.alreadySettled,
    openings: plan.openings.length, openingCents: sum(plan.openings, (o) => o.cents), alreadyOpened: plan.alreadyOpened,
    credits: plan.credits.length, creditCents: sum(plan.credits, (c) => c.cents),
  };
  report.problems = [
    problem("export_account_without_client", plan.unmatched),
    problem("credit_balance_for_staff", plan.credits.map((c) => c.accountNumber)),
  ].filter((p) => p.count);
  if (!live) return report;
  const start = starts.invoice ?? (seeds.max.invoice ?? 0) + 1;
  const settlements = await writeSettlements(db, plan.settlements, existingTransactionIds);
  let openings = 0;
  for (const opening of plan.openings) {
    await db.transaction((tx) => writeOpening(tx, { opening, start, cutoverAt }));
    openings += 1;
  }
  report.written = { settlements, openings };
  return report;
}

/**
 * `import:load balances --balances per-invoice|per-client --file|--file-id`.
 * `parsed` is readExport's result for the stored export (load-cli.js reads and
 * seals the file). Run after `invoices`. Re-runnable with the same export.
 */
export async function loadBalances({ raw, db, live, target, mode, parsed, fileId = null, starts = {}, cutoverAt = new Date() }) {
  if (!SETTLEMENT_PREFIX[mode]) throw new ImportRefusal("--balances must be per-invoice or per-client.");
  const legacy = await db
    .select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, kind: invoices.kind, legacySeazonaInvoiceId: invoices.legacySeazonaInvoiceId,
      clientUserId: invoices.clientUserId, status: invoices.status, totalCents: invoices.totalCents, issuedAt: invoices.issuedAt,
    })
    .from(invoices)
    .where(eq(invoices.kind, "legacy"));
  const settled = await db.select({ transactionId: invoicePayments.transactionId }).from(invoicePayments).where(eq(invoicePayments.source, LEGACY_SETTLEMENT_SOURCE));
  const existingTransactionIds = new Set(settled.map((r) => r.transactionId));
  const other = mode === "per-invoice" ? "per-client" : "per-invoice";
  if ([...existingTransactionIds].some((t) => t.startsWith(SETTLEMENT_PREFIX[other]))) {
    throw new ImportRefusal(`Balances were already loaded ${other} on this target. Re-clone the rehearsal (or restore production from the cutover backup) before switching paths.`);
  }
  const report = { step: "balances", live, mode, fileId, exportProblems: parsed.problems };
  const args = { raw, db, live, target, legacy, parsed, existingTransactionIds, starts, cutoverAt, report };
  return mode === "per-invoice" ? perInvoice(args) : perClient(args);
}
```

- [ ] **Step 5: Correct the ledger schema comment (Spec correction 7)**

In `apps/api/src/db/schema/invoice-payments.js`, replace the last paragraph of the header comment ("Seazona-era rows … piece 5's import fills `invoiceId`.") with:

```js
 * Seazona-era rows (before own-the-lab piece 3) carry `seazonaClientId` /
 * `seazonaInvoiceId` and no `invoiceId`, and keep it that way: their money is
 * already inside Seazona's open balances, which piece 5 carries over as
 * `legacy_settlement` rows (transactionId `legacy:<seazonaInvoiceId>`, or
 * `legacy-full:` on the per-client path). Linking them would count it twice.
```

and extend the `source` comment's list with `| legacy_settlement`.

Run: `cd apps/api && pnpm db:generate`
Expected: "No schema changes" (comments only).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/import src/db`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/import apps/api/src/db/schema/invoice-payments.js
git commit -m "feat(import): opening balances — per-invoice settlements or per-client opening invoices; credits reported

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Legacy orders: mapper, the `orders` load step; legacy orders never billed again

**Files:**
- Create: `apps/api/test-fixtures/seazona/orders.json`, `apps/api/test-fixtures/seazona/order-details.json`
- Create: `apps/api/src/import/map-orders.js`, `apps/api/src/import/map-orders.test.js`
- Create: `apps/api/src/import/load-orders.js`, `apps/api/src/import/load-orders.test.js`
- Modify: `apps/api/src/services/billing/invoices.service.js`, `apps/api/src/services/billing/invoices.service.test.js`
- Modify: `apps/api/src/services/lab/lab-orders.service.js` (export `variantIdsForCodes`)

**Interfaces:**
- Consumes: `orderStatusFor`, `recordDate`, `recordNumber`, `firstString`, `ORDER_NUMBER_FIELDS` (Task 9), `labNoon` (Task 11), `ownerIndex` (Task 10), `insertMissing`, `enforceSeeds` (Task 11), `variantIdsForCodes(tx, codes) → Map<code, variantId>` (now exported from `lab-orders.service.js`).
- Produces:
  - `map-orders.js`: `mapLegacyOrder({ summary, detail, ownerUserId }) → { order, lines } | { problem }`, `planOrders({ summaries, details, owners, existingSourceIds, existingNumbers }) → { rows, counts, problems }`. Rows unsealed; `order.legacyPatient` is plaintext until the writer seals it.
  - `load-orders.js`: `loadOrders({ raw, db, live, target, starts }) → report`. A live run refuses while any summary's state is unmapped (`unknown_status` problem).
  - `invoices.service.js` `issueForShippedLabOrder` returns `{ issued: false, reason: "legacy" }` for a `source: "legacy"` lab order without drafting anything.

- [ ] **Step 1: Write the fixtures**

`apps/api/test-fixtures/seazona/orders.json` (summary field names ASSUMED: `orderNumber`, `clientId`, `patientName`, `ordered`, `due`, `status`; the rehearsal confirms them):

```json
[
  { "id": "ord-1", "orderNumber": "98000", "clientId": "c-1324", "patientName": "Test Patient B", "ordered": "2026-10-20T10:00:00", "due": "2026-11-03", "status": "In Production" },
  { "id": "ord-2", "orderNumber": "97950", "clientId": "c-2001", "patientName": "Test Patient D", "ordered": "2019-03-01T09:00:00", "due": "2019-03-15", "status": "Shipped", "shipped": "2019-03-14T15:00:00" },
  { "id": "ord-3", "orderNumber": "97990", "clientId": "c-2001", "patientName": "Test Patient E", "ordered": "2026-10-18T09:00:00", "due": "2026-10-30", "status": "Hold" },
  { "id": "ord-4", "orderNumber": "97991", "clientId": "c-1324", "patientName": "Test Patient F", "ordered": "2026-10-19T09:00:00", "status": "Awaiting Scan" },
  { "id": "ord-5", "orderNumber": "97980", "clientId": "c-1324", "patientName": "Test Patient G", "ordered": "2018-01-01T09:00:00", "status": "Cancelled" }
]
```

`apps/api/test-fixtures/seazona/order-details.json` (detail shape ASSUMED: `products[{ code, name, quantity, arch }]`, `files[]`, `settings[]` per the API docs):

```json
[
  {
    "id": "ord-1", "orderNumber": "98000",
    "products": [
      { "id": "p-1", "code": "2608", "name": "DDSO Nylon", "quantity": 1, "arch": 1 },
      { "id": "p-2", "code": "2701", "name": "Night guard", "quantity": 2, "arch": 2 }
    ],
    "files": [{ "name": "scan-upper.stl" }],
    "settings": [{ "name": "Contacts", "value": "normal" }]
  }
]
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/import/map-orders.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { mapLegacyOrder, planOrders } from "./map-orders.js";

const load = (n) => JSON.parse(readFileSync(new URL(`../../test-fixtures/seazona/${n}`, import.meta.url), "utf8"));
const summaries = load("orders.json");
const details = new Map(load("order-details.json").map((d) => [d.id, d]));
const byId = (id) => summaries.find((s) => s.id === id);

test("an open order: board status, its own number, patient kept for sealing, lines from detail", () => {
  const { order, lines } = mapLegacyOrder({ summary: byId("ord-1"), detail: details.get("ord-1"), ownerUserId: "u-1324" });
  assert.equal(order.source, "legacy");
  assert.equal(order.sourceId, "ord-1");
  assert.equal(order.orderNumber, 98000);
  assert.equal(order.status, "in_production");
  assert.equal(order.clientUserId, "u-1324");
  assert.equal(order.legacyPatient, "Test Patient B");
  assert.equal(order.dueDate, "2026-11-03");
  assert.equal(isoDateIn(LAB_TIMEZONE, order.receivedAt), "2026-10-20");
  assert.equal(order.shippedAt, null);
  assert.deepEqual(lines.map((l) => [l.code, l.name, l.qty, l.arch]), [["2608", "DDSO Nylon", 1, "upper"], ["2701", "Night guard", 2, "lower"]]);
  assert.equal(lines[0].labOrderId, order.id);
});

test("shipped history keeps its own dates, so it never lands in the board's 14-day shipped window", () => {
  const { order, lines } = mapLegacyOrder({ summary: byId("ord-2"), ownerUserId: "u-2001" });
  assert.equal(order.status, "shipped");
  assert.equal(isoDateIn(LAB_TIMEZONE, order.shippedAt), "2019-03-14");
  assert.ok(order.shippedAt < new Date("2020-01-01"));
  assert.deepEqual(lines, [], "no detail: no lines (the order page says so)");
  const { order: cancelled } = mapLegacyOrder({ summary: byId("ord-5"), ownerUserId: "u-1324" });
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelledAt < new Date("2020-01-01"));
});

test("a held order resumes in production", () => {
  const { order } = mapLegacyOrder({ summary: byId("ord-3"), ownerUserId: "u-2001" });
  assert.equal(order.status, "on_hold");
  assert.equal(order.heldFrom, "in_production");
});

test("an unknown Seazona state is a problem, never a guessed status", () => {
  assert.deepEqual(mapLegacyOrder({ summary: byId("ord-4"), ownerUserId: "u-1324" }), { problem: "unknown_status" });
});

test("plan: skips loaded orders and taken numbers; counts open ones", () => {
  const owners = new Map([["c-1324", "u-1324"], ["c-2001", "u-2001"]]);
  const records = summaries.map((p) => ({ seazonaId: p.id, payload: p }));
  const plan = planOrders({ summaries: records, details, owners, existingSourceIds: new Set(["ord-5"]), existingNumbers: new Set([97990]) });
  assert.deepEqual(plan.rows.map((r) => r.order.sourceId), ["ord-1", "ord-2"]);
  assert.equal(plan.counts.open, 1);
  assert.equal(plan.counts.alreadyLoaded, 1);
  const kinds = Object.fromEntries(plan.problems.map((p) => [p.kind, p.seazonaIds]));
  assert.deepEqual(kinds.unknown_status, ["ord-4"]);
  assert.deepEqual(kinds.order_number_taken, ["ord-3"]);
  assert.ok(!JSON.stringify(plan.problems).includes("Patient"));
});
```

Create `apps/api/src/import/load-orders.test.js`:

```js
process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeTx } from "../test/fake-tx.js";

const { loadOrders } = await import("./load-orders.js");
const { ImportRefusal } = await import("./import-errors.js");
const load = (n) => JSON.parse(readFileSync(new URL(`../../test-fixtures/seazona/${n}`, import.meta.url), "utf8"));
const asRecords = (list) => list.map((p) => ({ seazonaId: p.id, payload: p }));
const known = load("orders.json").filter((o) => o.id !== "ord-4");
const rawWith = (orders) => ({ records: async (e) => ({ order: asRecords(orders), order_detail: asRecords(load("order-details.json")) })[e] ?? [] });
const users = [
  { id: "u-1324", seazonaClientId: "c-1324", seazonaAccountNumber: "1324", createdAt: new Date(0) },
  { id: "u-2001", seazonaClientId: "c-2001", seazonaAccountNumber: "2001", createdAt: new Date(0) },
];
// Select order: seed counts (invoices, lab orders), owners, existing legacy orders, variants by code.
const db = (existing = []) => fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing, [{ id: "v-2608", code: "2608" }]] });

test("live: orders sealed, lines linked to catalog variants by code", async () => {
  const tx = db();
  await loadOrders({ raw: rawWith(known), db: tx, live: true, target: "rehearsal", starts: {} });
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  const orders = inserts.find((v) => v[0]?.source === "legacy");
  assert.equal(orders.length, 4);
  assert.ok(orders.every((o) => /^enc:v1:/.test(o.legacyPatient)));
  const lines = inserts.find((v) => v[0]?.name === "DDSO Nylon");
  assert.equal(lines[0].variantId, "v-2608");
  assert.equal(lines[1].variantId, null);
  assert.ok(!JSON.stringify(inserts).includes("Test Patient"));
});

test("a live run refuses while a Seazona state is unmapped; a dry run reports it", async () => {
  const dry = await loadOrders({ raw: rawWith(load("orders.json")), db: db(), live: false, target: "rehearsal", starts: {} });
  assert.ok(dry.problems.some((p) => p.kind === "unknown_status"));
  await assert.rejects(loadOrders({ raw: rawWith(load("orders.json")), db: db(), live: true, target: "rehearsal", starts: {} }), ImportRefusal);
});

test("a re-run skips orders already loaded", async () => {
  const existing = known.map((o) => ({ sourceId: o.id, number: Number(o.orderNumber) }));
  const tx = db(existing);
  const report = await loadOrders({ raw: rawWith(known), db: tx, live: true, target: "rehearsal", starts: {} });
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.equal(report.counts.alreadyLoaded, 4);
});
```

Append to `apps/api/src/services/billing/invoices.service.test.js` (it already loads `fakeTx` and the service as `mod`):

```js
test("a legacy (Seazona) lab order is never billed again when it ships: its bill is the imported invoice", async () => {
  const tx = fakeTx({ selects: [[], [{ id: "lo-1", source: "legacy", sourceId: "ord-1", clientUserId: "u-1" }]] });
  const r = await mod.issueForShippedLabOrder(tx, { labOrderId: "lo-1", shippedAt: new Date() });
  assert.deepEqual(r, { issued: false, reason: "legacy" });
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
});
```


- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/import/map-orders.test.js src/import/load-orders.test.js src/services/billing/invoices.service.test.js`
Expected: FAIL (modules missing; the legacy order gets a draft invoice).

- [ ] **Step 4: Legacy orders are never billed by this system**

In `apps/api/src/services/billing/invoices.service.js` `issueForShippedLabOrder`, replace:

```js
    if (!labOrder || labOrder.source === "shop_order") return { issued: false, reason: "no_invoice" };
```

with:

```js
    if (!labOrder || labOrder.source === "shop_order") return { issued: false, reason: "no_invoice" };
    // A Seazona order imported at cutover (piece 5) was billed in Seazona; that
    // bill is its imported legacy invoice. Never draft a second one.
    if (labOrder.source === "legacy") return { issued: false, reason: "legacy" };
```

(`voidForCancelledLabOrder` needs no change: a legacy order has no invoice of its own, so it already does nothing.)

In `apps/api/src/services/lab/lab-orders.service.js`, change `async function variantIdsForCodes(` to `export async function variantIdsForCodes(` (one implementation of "product code → catalog variant"; the orders step reuses it).

- [ ] **Step 5: The order mapper**

Create `apps/api/src/import/map-orders.js`:

```js
import { createId } from "../lib/id.js";
import { orderStatusFor, recordDate, recordNumber, firstString, ORDER_NUMBER_FIELDS } from "./seazona-records.js";
import { labNoon } from "./map-invoices.js";

/**
 * Seazona order (+ optional detail) → one `source: legacy` lab order and its
 * lines (unsealed; load-orders.js seals legacyPatient). History keeps its own
 * dates — a 2019 shipment is shippedAt 2019, never "now", so it stays off the
 * board's recent-shipped window. Open orders land on the board's statuses so
 * the bench keeps working on them; they are never billed again (Spec
 * correction 9). An unknown state is a problem, not a guess.
 */
const ARCH = { 1: "upper", 2: "lower", 3: "both", upper: "upper", lower: "lower", both: "both" };
const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const instant = (v) => (dayOf(v) ? labNoon(dayOf(v)) : null);

function mapLines(labOrderId, detail) {
  const items = Array.isArray(detail?.products) ? detail.products : [];
  return items.map((p, i) => {
    const qty = Number(p?.quantity ?? p?.qty ?? 1);
    const code = firstString(p, ["code", "productCode"]);
    return {
      id: createId(), labOrderId, position: i, variantId: null,
      code: code ? code.slice(0, 60) : null,
      name: firstString(p, ["name", "productName"]) ?? (code ? `Seazona item ${code}` : "Seazona item"),
      arch: ARCH[String(p?.arch ?? "").toLowerCase()] ?? null,
      qty: Number.isSafeInteger(qty) && qty > 0 ? qty : 1,
      noteOnly: false, sourceLabel: null,
    };
  });
}

export function mapLegacyOrder({ summary, detail = null, ownerUserId }) {
  const orderNumber = recordNumber(summary, ORDER_NUMBER_FIELDS) ?? recordNumber(detail, ORDER_NUMBER_FIELDS);
  if (!orderNumber) return { problem: "order_number_not_numeric" };
  if (!ownerUserId) return { problem: "client_not_loaded" };
  const mapped = orderStatusFor(summary.status);
  if (!mapped) return { problem: "unknown_status" };
  const receivedAt = instant(recordDate("order", summary));
  if (!receivedAt) return { problem: "no_date" };
  const terminalAt = instant(firstString(summary, ["shipped", "shippedDate", "completed", "lastModified"])) ?? receivedAt;
  const id = createId();
  const order = {
    id, orderNumber, source: "legacy", sourceId: String(summary.id),
    legacyPatient: firstString(summary, ["patientName", "patient"]),
    clientUserId: ownerUserId, status: mapped.status, heldFrom: mapped.heldFrom,
    departmentId: null, assigneeUserId: null, dueDate: dayOf(summary.due), rush: false, rushTier: null,
    isRemake: false, remakeOfOrderId: null, holdReason: null, labNotes: null, shipmentId: null, version: 1,
    receivedAt,
    startedAt: mapped.status === "received" ? null : receivedAt,
    shippedAt: mapped.status === "shipped" ? terminalAt : null,
    cancelledAt: mapped.status === "cancelled" ? terminalAt : null,
    createdAt: receivedAt, updatedAt: receivedAt,
  };
  return { order, lines: mapLines(id, detail) };
}

export function planOrders({ summaries, details, owners, existingSourceIds, existingNumbers }) {
  const rows = [];
  const problems = new Map();
  const flag = (kind, id) => problems.set(kind, [...(problems.get(kind) ?? []), id]);
  const counts = { seazona: summaries.length, toInsert: 0, alreadyLoaded: 0, open: 0, withLines: 0 };
  const numbers = new Set(existingNumbers);
  for (const { seazonaId, payload } of summaries) {
    if (existingSourceIds.has(seazonaId)) { counts.alreadyLoaded += 1; continue; }
    const mapped = mapLegacyOrder({ summary: payload, detail: details.get(seazonaId) ?? null, ownerUserId: owners.get(String(payload.clientId)) });
    if (mapped.problem) { flag(mapped.problem, seazonaId); continue; }
    if (numbers.has(mapped.order.orderNumber)) { flag("order_number_taken", seazonaId); continue; }
    numbers.add(mapped.order.orderNumber);
    rows.push(mapped);
    counts.toInsert += 1;
    if (!["shipped", "cancelled"].includes(mapped.order.status)) counts.open += 1;
    if (mapped.lines.length) counts.withLines += 1;
  }
  return { rows, counts, problems: [...problems].map(([kind, ids]) => ({ kind, count: ids.length, seazonaIds: ids.slice(0, 50) })) };
}
```

Check against the fixture: ord-5's `cancelledAt` uses `lastModified` (absent) → falls back to its `ordered` date (2018), so it is before 2020; ord-2's `shipped` is 2019-03-14.

- [ ] **Step 6: The load step**

Create `apps/api/src/import/load-orders.js`:

```js
import { eq, isNotNull } from "drizzle-orm";
import { encryptField } from "../lib/crypto.js";
import { labOrders, labOrderLines, users } from "../db/schema/index.js";
import { variantIdsForCodes } from "../services/lab/lab-orders.service.js";
import { ownerIndex } from "./map-clients.js";
import { planOrders } from "./map-orders.js";
import { insertMissing } from "./load-writer.js";
import { enforceSeeds } from "./seed-check.js";
import { ImportRefusal } from "./import-errors.js";

const BATCH = 500;

/**
 * `import:load orders`: one `source: legacy` lab order per Seazona order,
 * lines from order detail (fetched for open orders). A live run refuses while
 * any Seazona state is unmapped (add it to import/seazona-records.js). Each
 * batch of orders and their lines is one transaction; a re-run skips loaded
 * orders by (source, source_id). No events are written: the order page labels
 * the whole order "Seazona history".
 */
export async function loadOrders({ raw, db, live, target, starts = {} }) {
  const summaries = await raw.records("order");
  const details = new Map((await raw.records("order_detail")).map((r) => [r.seazonaId, r.payload]));
  const seeds = await enforceSeeds({ raw, db, target, live, starts, orderSummaries: summaries });
  const userRows = await db
    .select({ id: users.id, seazonaClientId: users.seazonaClientId, seazonaAccountNumber: users.seazonaAccountNumber, createdAt: users.createdAt })
    .from(users)
    .where(isNotNull(users.seazonaClientId));
  const existing = await db.select({ sourceId: labOrders.sourceId, number: labOrders.orderNumber }).from(labOrders).where(eq(labOrders.source, "legacy"));
  const existingSourceIds = new Set(existing.map((r) => r.sourceId));
  const plan = planOrders({ summaries, details, owners: ownerIndex(userRows), existingSourceIds, existingNumbers: new Set() });
  const report = { step: "orders", live, counts: plan.counts, seeds: seeds.summary, problems: plan.problems };
  if (!live) return report;
  if (plan.problems.some((p) => p.kind === "unknown_status")) {
    throw new ImportRefusal("Some Seazona order states are unmapped (see the dry run's unknown_status ids). Add them to import/seazona-records.js, then re-run.");
  }

  const variants = await variantIdsForCodes(db, plan.rows.flatMap((r) => r.lines.map((l) => l.code)));
  let written = 0;
  for (let i = 0; i < plan.rows.length; i += BATCH) {
    const chunk = plan.rows.slice(i, i + BATCH);
    await db.transaction(async (tx) => {
      const r = await insertMissing(tx, labOrders, chunk.map(({ order }) => ({ ...order, legacyPatient: order.legacyPatient == null ? null : encryptField(order.legacyPatient) })), {
        keyOf: (o) => o.sourceId, existingKeys: existingSourceIds,
      });
      const lines = chunk.filter((x) => r.insertedIds.has(x.order.id)).flatMap((x) => x.lines.map((l) => ({ ...l, variantId: variants.get(l.code) ?? null })));
      for (let j = 0; j < lines.length; j += BATCH) await tx.insert(labOrderLines).values(lines.slice(j, j + BATCH));
      written += r.insertedIds.size;
    });
  }
  report.written = { orders: written };
  return report;
}
```

`existingNumbers` is empty here on purpose: a live lab order holding a number in Seazona's range is exactly what `enforceSeeds` refuses before this point, and `lab_orders_order_number_idx` is the database's backstop (a clash counts as a `conflict` in `insertMissing`).

Note: `legacyPatient` is sealed with `encryptField` directly — the same primitive `lab-orders.service.js`'s `sealOrder` (a `fieldSealer`) uses; that sealer is module-private there, and exporting it for one field is not worth widening the service.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/import src/services/billing src/services/lab`
Expected: PASS. (`load-orders.test.js`'s live test: ord-1…ord-3 and ord-5 load (4); the variant lookup is the fifth queued select.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/import apps/api/test-fixtures/seazona/orders.json apps/api/test-fixtures/seazona/order-details.json apps/api/src/services/billing/invoices.service.js apps/api/src/services/billing/invoices.service.test.js apps/api/src/services/lab/lab-orders.service.js
git commit -m "feat(import): legacy lab orders from the raw store; legacy orders are never billed again

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: `import:load` CLI and the parity report (`import:parity`)

**Files:**
- Create: `apps/api/src/import/load-cli.js`
- Create: `apps/api/src/import/parity.js`, `apps/api/src/import/parity.test.js`
- Create: `apps/api/src/import/parity-queries.js`, `apps/api/src/import/parity-cli.js`
- Modify: `apps/api/package.json` (scripts `import:load`, `import:parity`)

**Interfaces:**
- Consumes: every earlier task's step and guard: `loadClients`, `loadInvoices`, `loadBalances`, `loadOrders`, `resolveTarget`, `resolveImportDb`, `connect`, `assertNotCloudRun`, `assertImportKey`, `assertTargetKey`, `rawStore`, `readExport`, `parseColumnsFlag`, `enforceSeeds`, `legacyIssueDay`, `centsOf`, `isPlaceholderEmail`, `paidCentsByInvoice` (`services/billing/ledger.service.js`), `deriveBalance` (`services/billing/invoice-rules.js`), `printReport`, `runCli`.
- Produces:
  - `parity.js` (pure): `seazonaInvoiceFacts(summaries, details) → [{ seazonaId, number, status, totalCents, year }]`, `exportBalances(rows, mode, accountByInvoiceNumber) → Map<account, cents>`, `buildParity({ seazona, app, seeds }) → { clients, invoices, balances, orders, seeds, differences: string[], clean: boolean }`.
  - `parity-queries.js`: `readSeazonaSide(raw) → { clientIds, invoices, orders }`, `readAppSide(db) → { linkedClientIds, linkedCount, placeholders, invoices, accountByInvoiceNumber, balanceByAccount, openOrders, openingInvoices }`.
  - Scripts: `import:load`, `import:parity`. Exit codes: 0 ok / clean, 2 refused, 1 failed, 4 parity not clean.

- [ ] **Step 1: Write the failing parity tests**

Create `apps/api/src/import/parity.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { seazonaInvoiceFacts, exportBalances, buildParity } from "./parity.js";

const facts = seazonaInvoiceFacts(
  [
    { seazonaId: "a", payload: { invoiceNumber: "1", total: 100, status: "Shipped", due: "2025-12-31" } },
    { seazonaId: "b", payload: { invoiceNumber: "2", total: 50.5, status: "Void", due: "2026-01-05" } },
  ],
  new Map([["a", { date: "2025-12-30T10:00:00" }]]),
);

const seazona = {
  clientIds: ["c1", "c2"],
  invoices: facts,
  orders: [{ status: "in_production", open: true }, { status: "shipped", open: false }],
  balanceByAccount: new Map([["1324", 4000]]),
};
const app = {
  linkedClientIds: ["c1", "c2"], linkedCount: 2, placeholders: 0,
  invoices: [
    { seazonaId: "a", number: 1, status: "issued", totalCents: 10000, year: "2025" },
    { seazonaId: "b", number: 2, status: "void", totalCents: 5050, year: "2026" },
  ],
  balanceByAccount: new Map([["1324", 4000]]),
  openOrders: [{ status: "in_production" }],
  openingInvoices: 0,
};
const seeds = { errors: [], warnings: [], seazonaMax: { invoice: 2, order: null } };

test("Seazona facts use the mapper's issue-day rule, cents and void state", () => {
  assert.deepEqual(facts, [
    { seazonaId: "a", number: 1, status: "issued", totalCents: 10000, year: "2025" },
    { seazonaId: "b", number: 2, status: "void", totalCents: 5050, year: "2026" },
  ]);
});

test("everything matching is clean", () => {
  const r = buildParity({ seazona, app, seeds });
  assert.equal(r.clean, true, JSON.stringify(r.differences));
  assert.deepEqual(r.invoices.byYear, [{ year: "2025", seazona: 1, app: 1 }, { year: "2026", seazona: 1, app: 1 }]);
  assert.equal(r.invoices.seazonaTotalCents, 10000, "void invoices stay out of the totals");
  assert.equal(r.balances.exportTotalCents, 4000);
});

test("one cent of AR, one unlinked client, one missing invoice, one open order or a seed error each make it unclean", () => {
  const cases = [
    { app: { ...app, balanceByAccount: new Map([["1324", 3999]]) }, want: "balances" },
    { app: { ...app, linkedClientIds: ["c1"] }, want: "clients" },
    { app: { ...app, invoices: app.invoices.slice(0, 1) }, want: "invoices not loaded" },
    { app: { ...app, openOrders: [] }, want: "open orders" },
    { seeds: { ...seeds, errors: ["INVOICE_NUMBER_START too low"] }, want: "seeds" },
  ];
  for (const c of cases) {
    const r = buildParity({ seazona, app: c.app ?? app, seeds: c.seeds ?? seeds });
    assert.equal(r.clean, false, c.want);
    assert.ok(r.differences.includes(c.want), `${c.want}: ${r.differences}`);
  }
  const off = buildParity({ seazona, app: { ...app, balanceByAccount: new Map([["1324", 3999]]) }, seeds });
  assert.deepEqual(off.balances.differences, [{ client: "1324", exportCents: 4000, appCents: 3999 }]);
});

test("without an export, balances are not compared (and say so)", () => {
  const r = buildParity({ seazona: { ...seazona, balanceByAccount: null }, app, seeds });
  assert.equal(r.balances, null);
  assert.ok(r.differences.includes("no balance export compared"));
});

test("export balances: per-invoice rows roll up to the owner's account; credits count as zero", () => {
  const m = exportBalances([{ key: 1, cents: 300 }, { key: 2, cents: -50 }, { key: 9, cents: 10 }], "per-invoice", new Map([[1, "1324"], [2, "1324"]]));
  assert.deepEqual([...m], [["1324", 300], ["invoice 9", 10]]);
  assert.deepEqual([...exportBalances([{ key: "2001", cents: -2000 }], "per-client", new Map())], [["2001", 0]]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/import/parity.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: The parity report**

Create `apps/api/src/import/parity.js`:

```js
import { recordNumber, invoiceStatusFor, INVOICE_NUMBER_FIELDS } from "./seazona-records.js";
import { centsOf, legacyIssueDay } from "./map-invoices.js";

/**
 * The cutover's go/no-go (spec "Parity report"): ids, counts and cents only.
 * Clean only when every comparison matches; otherwise `differences` names
 * each failing comparison, for the user to explain and accept or fix.
 */
const countBy = (list, key) => list.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map());
const sumBy = (list, f) => list.reduce((s, x) => s + f(x), 0);
const sameCounts = (a, b) => [...new Set([...a.keys(), ...b.keys()])].every((k) => (a.get(k) ?? 0) === (b.get(k) ?? 0));
const range = (nums) => (nums.length ? [Math.min(...nums), Math.max(...nums)] : null);

export function seazonaInvoiceFacts(summaries, details) {
  return summaries.map(({ seazonaId, payload }) => ({
    seazonaId,
    number: recordNumber(payload, INVOICE_NUMBER_FIELDS),
    status: invoiceStatusFor(payload.status),
    totalCents: centsOf(payload.total),
    year: (legacyIssueDay(payload, details.get(seazonaId) ?? null).day ?? "unknown").slice(0, 4),
  }));
}

/** An export → owed cents per account (credits count as 0: they are reported, never loaded). */
export function exportBalances(rows, mode, accountByInvoiceNumber) {
  const out = new Map();
  for (const r of rows) {
    const key = mode === "per-client" ? r.key : (accountByInvoiceNumber.get(r.key) ?? `invoice ${r.key}`);
    out.set(key, (out.get(key) ?? 0) + Math.max(r.cents, 0));
  }
  return out;
}

function compareBalances(exported, derived) {
  if (!exported) return null;
  const keys = [...new Set([...exported.keys(), ...derived.keys()])].sort();
  const differences = keys
    .map((client) => ({ client, exportCents: exported.get(client) ?? 0, appCents: derived.get(client) ?? 0 }))
    .filter((d) => d.exportCents !== d.appCents);
  return {
    exportTotalCents: sumBy([...exported.values()], (c) => c),
    appTotalCents: sumBy([...derived.values()], (c) => c),
    differenceCount: differences.length,
    differences: differences.slice(0, 200),
  };
}

export function buildParity({ seazona, app, seeds }) {
  const differences = [];
  const linked = new Set(app.linkedClientIds);
  const unlinked = seazona.clientIds.filter((id) => !linked.has(id));
  if (unlinked.length) differences.push("clients");

  const sInv = seazona.invoices.filter((i) => i.number != null);
  const sYears = countBy(sInv, (i) => i.year);
  const aYears = countBy(app.invoices, (i) => i.year);
  const byYear = [...new Set([...sYears.keys(), ...aYears.keys()])].sort().map((year) => ({ year, seazona: sYears.get(year) ?? 0, app: aYears.get(year) ?? 0 }));
  if (!sameCounts(sYears, aYears)) differences.push("invoice counts");
  const seazonaTotalCents = sumBy(sInv.filter((i) => i.status !== "void"), (i) => i.totalCents ?? 0);
  const appTotalCents = sumBy(app.invoices.filter((i) => i.status !== "void"), (i) => i.totalCents);
  if (seazonaTotalCents !== appTotalCents) differences.push("invoice totals");
  const loaded = new Set(app.invoices.map((i) => i.seazonaId));
  const missing = seazona.invoices.filter((i) => !loaded.has(i.seazonaId)).map((i) => i.seazonaId);
  if (missing.length) differences.push("invoices not loaded");

  const balances = compareBalances(seazona.balanceByAccount, app.balanceByAccount);
  if (!balances) differences.push("no balance export compared");
  else if (balances.differenceCount || balances.exportTotalCents !== balances.appTotalCents) differences.push("balances");

  const sOpen = countBy(seazona.orders.filter((o) => o.open), (o) => o.status);
  const aOpen = countBy(app.openOrders, (o) => o.status);
  if (!sameCounts(sOpen, aOpen)) differences.push("open orders");
  if (seeds.errors.length) differences.push("seeds");

  return {
    clients: { seazona: seazona.clientIds.length, linked: app.linkedCount, placeholders: app.placeholders, unlinked: unlinked.length, unlinkedIds: unlinked.slice(0, 50) },
    invoices: {
      seazonaCount: sInv.length, appCount: app.invoices.length, byYear, seazonaTotalCents, appTotalCents,
      numberRange: { seazona: range(sInv.map((i) => i.number)), app: range(app.invoices.map((i) => i.number)) },
      missingCount: missing.length, missingIds: missing.slice(0, 50), openingInvoices: app.openingInvoices,
    },
    balances,
    orders: { seazonaOpen: Object.fromEntries(sOpen), appOpen: Object.fromEntries(aOpen) },
    seeds,
    differences,
    clean: differences.length === 0,
  };
}
```

- [ ] **Step 4: Run the parity tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/import/parity.test.js`
Expected: PASS.

- [ ] **Step 5: The parity reads**

Create `apps/api/src/import/parity-queries.js`:

```js
import { eq, isNotNull } from "drizzle-orm";
import { isOpeningBalanceInvoice, isoDateIn, LAB_TIMEZONE, TERMINAL_LAB_STATUSES } from "@my-app/shared";
import { users, invoices, labOrders } from "../db/schema/index.js";
import { paidCentsByInvoice } from "../services/billing/ledger.service.js";
import { deriveBalance } from "../services/billing/invoice-rules.js";
import { orderStatusFor } from "./seazona-records.js";
import { isPlaceholderEmail } from "./map-clients.js";
import { seazonaInvoiceFacts } from "./parity.js";

/** The raw store's side of parity. Opens records in memory; returns ids, numbers, statuses and cents only. */
export async function readSeazonaSide(raw) {
  const clients = await raw.records("client");
  const summaries = await raw.records("invoice");
  const details = new Map((await raw.records("invoice_detail")).map((r) => [r.seazonaId, r.payload]));
  const orders = await raw.records("order");
  return {
    clientIds: clients.map((c) => c.seazonaId),
    invoices: seazonaInvoiceFacts(summaries, details),
    orders: orders.map(({ payload }) => {
      const m = orderStatusFor(payload.status);
      return { status: m?.status ?? "unknown", open: Boolean(m) && !TERMINAL_LAB_STATUSES.includes(m.status) };
    }),
  };
}

/** The target's side of parity, read-only. Balances use the app's own ledger rule (deriveBalance). */
export async function readAppSide(db) {
  const userRows = await db
    .select({ id: users.id, email: users.email, seazonaClientId: users.seazonaClientId, seazonaAccountNumber: users.seazonaAccountNumber })
    .from(users)
    .where(isNotNull(users.seazonaClientId));
  const legacy = await db
    .select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, kind: invoices.kind, legacySeazonaInvoiceId: invoices.legacySeazonaInvoiceId,
      clientUserId: invoices.clientUserId, status: invoices.status, totalCents: invoices.totalCents, issuedAt: invoices.issuedAt,
    })
    .from(invoices)
    .where(eq(invoices.kind, "legacy"));
  const paid = await paidCentsByInvoice(legacy.map((i) => i.id), db);
  const orders = await db.select({ status: labOrders.status }).from(labOrders).where(eq(labOrders.source, "legacy"));

  const accountOf = new Map(userRows.map((u) => [u.id, u.seazonaAccountNumber ?? u.id]));
  const balanceByAccount = new Map();
  for (const inv of legacy.filter((i) => i.status === "issued")) {
    const { balanceCents } = deriveBalance(inv, paid.get(inv.id) ?? 0);
    const key = accountOf.get(inv.clientUserId) ?? inv.clientUserId;
    balanceByAccount.set(key, (balanceByAccount.get(key) ?? 0) + Math.max(balanceCents, 0));
  }
  const history = legacy.filter((i) => !isOpeningBalanceInvoice(i));
  return {
    linkedClientIds: userRows.map((u) => String(u.seazonaClientId)),
    linkedCount: userRows.length,
    placeholders: userRows.filter((u) => isPlaceholderEmail(u.email)).length,
    invoices: history.map((i) => ({
      seazonaId: i.legacySeazonaInvoiceId, number: i.invoiceNumber, status: i.status, totalCents: i.totalCents,
      year: isoDateIn(LAB_TIMEZONE, new Date(i.issuedAt)).slice(0, 4),
    })),
    accountByInvoiceNumber: new Map(history.map((i) => [i.invoiceNumber, accountOf.get(i.clientUserId) ?? i.clientUserId])),
    balanceByAccount,
    openOrders: orders.filter((o) => !TERMINAL_LAB_STATUSES.includes(o.status)),
    openingInvoices: legacy.length - history.length,
  };
}
```

- [ ] **Step 6: The two CLIs**

Create `apps/api/src/import/load-cli.js`:

```js
/**
 * Piece 5 loader. Operator machine only. DRY RUN BY DEFAULT; rehearsal first.
 *
 *   pnpm --filter @my-app/api import:load <clients|invoices|balances|orders> --target rehearsal [--live]
 *   pnpm --filter @my-app/api import:load <step> --target production --confirm-production diamond_labs \
 *        --invoice-start <n> --order-start <n> [--live]
 *   clients:  [--no-email placeholder|skip]
 *   balances: --balances per-invoice|per-client (--file <export.xls> | --file-id <id>) [--columns name="Header",…] [--cutover-at <ISO>]
 *
 * Run the steps in order: clients, invoices, balances, orders. Every step is
 * re-runnable. Needs IMPORT_DATABASE_URL, the target's *_DATABASE_URL and
 * production's PHI_ENCRYPTION_KEY in the shell. `--file` seals the export into
 * the import DB and prints its id; delete the local file right after.
 */
import { readFile } from "node:fs/promises";
import * as appSchema from "../db/schema/index.js";
import * as importSchema from "./db/schema.js";
import { parseArgs, intFlag } from "./cli-args.js";
import { ImportRefusal } from "./import-errors.js";
import { assertNotCloudRun, resolveImportDb, resolveTarget, connect } from "./targets.js";
import { assertImportKey, assertTargetKey } from "./key-check.js";
import { rawStore } from "./raw-store.js";
import { readExport, parseColumnsFlag } from "./export-table.js";
import { loadClients } from "./load-clients.js";
import { loadInvoices } from "./load-invoices.js";
import { loadBalances } from "./load-balances.js";
import { loadOrders } from "./load-orders.js";
import { printReport, runCli } from "./report.js";

const FLAGS = {
  allowed: ["target", "confirm-production", "live", "invoice-start", "order-start", "no-email", "balances", "file", "file-id", "columns", "cutover-at"],
  booleans: ["live"],
};

async function balancesStep({ raw, db, live, target, starts, flags }) {
  const mode = flags.balances;
  if (mode !== "per-invoice" && mode !== "per-client") throw new ImportRefusal("--balances must be per-invoice or per-client.");
  const kind = mode === "per-client" ? "client" : "invoice";
  let fileId = flags["file-id"];
  if (flags.file) fileId = await raw.saveFile({ kind: `balances_${kind}`, bytes: await readFile(flags.file) });
  if (!fileId) throw new ImportRefusal("balances needs --file <export.xls> (first time) or --file-id <id>.");
  const stored = await raw.readFile(fileId);
  if (!stored || stored.kind !== `balances_${kind}`) throw new ImportRefusal(`No ${mode} export stored with id ${fileId}.`);
  const parsed = readExport(stored.bytes, { kind, columns: flags.columns ? parseColumnsFlag(flags.columns) : {} });
  const cutoverAt = flags["cutover-at"] ? new Date(flags["cutover-at"]) : new Date();
  if (Number.isNaN(cutoverAt.getTime())) throw new ImportRefusal("--cutover-at must be an ISO date-time.");
  return loadBalances({ raw, db, live, target, mode, parsed, fileId, starts, cutoverAt });
}

const STEPS = {
  clients: ({ raw, db, live, flags }) => {
    const noEmail = flags["no-email"] ?? "placeholder";
    if (noEmail !== "placeholder" && noEmail !== "skip") throw new ImportRefusal("--no-email must be placeholder or skip.");
    return loadClients({ raw, db, live, noEmail });
  },
  invoices: ({ raw, db, live, target, starts }) => loadInvoices({ raw, db, live, target, starts }),
  balances: balancesStep,
  orders: ({ raw, db, live, target, starts }) => loadOrders({ raw, db, live, target, starts }),
};

async function main(argv, env) {
  assertNotCloudRun(env);
  const { positional, flags } = parseArgs(argv, FLAGS);
  const step = positional[0];
  if (!STEPS[step] || positional.length !== 1) throw new ImportRefusal(`Usage: import:load <${Object.keys(STEPS).join("|")}> --target <rehearsal|production> [--live]`);
  const target = resolveTarget(flags.target, env, { confirmProduction: flags["confirm-production"] });
  const importConn = connect(resolveImportDb(env), importSchema);
  const targetConn = connect(target, appSchema);
  try {
    await assertImportKey(importConn.db, { keyCheck: importSchema.keyCheck });
    await assertTargetKey(targetConn.db);
    const live = flags.live === true;
    const starts = { invoice: intFlag(flags, "invoice-start"), order: intFlag(flags, "order-start") };
    const report = await STEPS[step]({ raw: rawStore(importConn.db), db: targetConn.db, live, target: target.name, starts, flags });
    printReport({ target: target.name, database: target.database, ...report });
    if (!live) process.stdout.write("Dry run: nothing was written to the target. Re-run with --live.\n");
    return 0;
  } finally {
    await Promise.all([importConn.close(), targetConn.close()]);
  }
}

runCli(main);
```

Create `apps/api/src/import/parity-cli.js`:

```js
/**
 * Piece 5 parity report. Read-only on the target; the report (ids, counts,
 * cents) is printed and saved to the import DB's parity_reports.
 *
 *   pnpm --filter @my-app/api import:parity --target rehearsal [--balances per-invoice|per-client --file-id <id> [--columns …]] [--invoice-start <n> --order-start <n>]
 *   pnpm --filter @my-app/api import:parity --target production --confirm-production diamond_labs --balances … --file-id <id> --invoice-start <n> --order-start <n>
 *
 * Exit 0 = clean; 4 = differences to explain (the cutover is a go only when clean or every difference is accepted by the user).
 */
import * as appSchema from "../db/schema/index.js";
import * as importSchema from "./db/schema.js";
import { parseArgs, intFlag } from "./cli-args.js";
import { ImportRefusal } from "./import-errors.js";
import { assertNotCloudRun, resolveImportDb, resolveTarget, connect } from "./targets.js";
import { assertImportKey } from "./key-check.js";
import { rawStore } from "./raw-store.js";
import { readExport, parseColumnsFlag } from "./export-table.js";
import { enforceSeeds } from "./seed-check.js";
import { readSeazonaSide, readAppSide } from "./parity-queries.js";
import { buildParity, exportBalances } from "./parity.js";
import { printReport, runCli } from "./report.js";

const FLAGS = { allowed: ["target", "confirm-production", "balances", "file-id", "columns", "invoice-start", "order-start"], booleans: [] };

async function exportedBalances(raw, flags, app) {
  if (!flags.balances) return null;
  const kind = flags.balances === "per-client" ? "client" : flags.balances === "per-invoice" ? "invoice" : null;
  if (!kind) throw new ImportRefusal("--balances must be per-invoice or per-client.");
  const stored = flags["file-id"] ? await raw.readFile(flags["file-id"]) : null;
  if (!stored || stored.kind !== `balances_${kind}`) throw new ImportRefusal(`No ${flags.balances} export stored with id ${flags["file-id"]}.`);
  const { rows } = readExport(stored.bytes, { kind, columns: flags.columns ? parseColumnsFlag(flags.columns) : {} });
  return exportBalances(rows, flags.balances, app.accountByInvoiceNumber);
}

async function main(argv, env) {
  assertNotCloudRun(env);
  const { flags } = parseArgs(argv, FLAGS);
  const target = resolveTarget(flags.target, env, { confirmProduction: flags["confirm-production"] });
  const importConn = connect(resolveImportDb(env), importSchema);
  const targetConn = connect(target, appSchema);
  try {
    await assertImportKey(importConn.db, { keyCheck: importSchema.keyCheck });
    const raw = rawStore(importConn.db);
    const app = await readAppSide(targetConn.db);
    const seazona = { ...(await readSeazonaSide(raw)), balanceByAccount: await exportedBalances(raw, flags, app) };
    const starts = { invoice: intFlag(flags, "invoice-start"), order: intFlag(flags, "order-start") };
    const seeds = (await enforceSeeds({ raw, db: targetConn.db, target: target.name, live: false, starts })).summary;
    const report = buildParity({ seazona, app, seeds });
    await raw.saveParityReport({ target: target.name, clean: report.clean, report });
    printReport({ target: target.name, database: target.database, ...report });
    return report.clean ? 0 : 4;
  } finally {
    await Promise.all([importConn.close(), targetConn.close()]);
  }
}

runCli(main);
```

In `apps/api/package.json` `scripts`, add:

```json
    "import:load": "node --env-file=.env src/import/load-cli.js",
    "import:parity": "node --env-file=.env src/import/parity-cli.js",
```

**Do not run these against any real database.** The step logic is covered by Tasks 10–13's tests and the parity tests; the operator runs them per `docs/import-operations.md`.

- [ ] **Step 7: Verify both CLIs load and refuse cleanly with no configuration**

Run: `cd apps/api && node --env-file=.env src/import/load-cli.js invoices --target rehearsal; echo "exit=$?"`
Expected: `Refused: REHEARSAL_DATABASE_URL is not set.` and `exit=2` (no connection is attempted).

Run: `cd apps/api && node --env-file=.env src/import/load-cli.js invoices --target production; echo "exit=$?"`
Expected: `Refused: PRODUCTION_DATABASE_URL is not set.`, `exit=2`.

Run: `cd apps/api && node --env-file=.env src/import/parity-cli.js --target staging; echo "exit=$?"`
Expected: `Refused: --target must be rehearsal or production.`, `exit=2`.

Run: `cd apps/api && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/src/import
git commit -m "feat(import): import:load and import:parity CLIs; parity report (ids, counts, cents)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Read side: legacy invoices, statements, payment history, legacy lab orders (API and web)

**Files:**
- Modify (API): `apps/api/src/services/billing/ledger.service.js` (+ `ledger.service.test.js`), `apps/api/src/routes/refund.routes.js` (+ `routes/__tests__/refund.routes.test.js`), `apps/api/src/services/billing/invoice-views.js` (+ test), `apps/api/src/services/billing/invoice-queries.js`, `apps/api/src/services/billing/invoice-model.js` (+ test), `apps/api/src/services/billing/statement-model.js` (+ test), `apps/api/src/services/billing/statements.service.js`, `apps/api/src/services/lab/lab-order-rules.js` (+ test), `apps/api/src/services/lab/lab-orders.service.js`, `apps/api/src/services/lab/ticket-model.js` (+ test)
- Modify (web): `apps/web/src/lib/invoices.js` (+ `lib/__tests__/invoices.test.js`), `apps/web/src/components/billing/InvoiceView.jsx`, `apps/web/src/pages/app/AdminInvoiceDetailPage.jsx`, `apps/web/src/pages/lab/LabOrderDetailPage.jsx`
- Create (web): `apps/web/src/components/lab/LegacyOrderPanel.jsx`

**Interfaces:**
- Consumes: `HISTORY_EXCLUDED_SOURCES`, `LEGACY_SETTLEMENT_SOURCE`, `isOpeningBalanceInvoice`, `LAB_ORDER_SOURCE_LABELS` (Task 1); sealed legacy columns (Task 2); `OPENING_LINE_DESCRIPTION` wording (Task 12).
- Produces:
  - `ledgerEntryKind(row)` → `"settlement"` for a `legacy_settlement` row; statements label it "Settled in Seazona"; an opening invoice reads "Opening balance carried from Seazona — invoice #N".
  - Payment history (doctor and admin) and the refund screen exclude every `HISTORY_EXCLUDED_SOURCES` row.
  - `getInvoiceDetail` lines show a legacy line's opened `legacyDescription` as its `description`; the doctor view's `patientName` falls back to `invoice.legacyPatient`; the doctor list's `patientInitials` falls back to it too; the PDF prints it.
  - `getLabOrderDetail` returns `legacy: { seazonaOrderId, patientName, caseId, caseNumber } | null`. Board cards of legacy orders have `reference: "Seazona"`. The work ticket prints the Seazona order and patient.
  - Web: `ENTRY_LABELS.settlement`, `legacyOrderBlock(invoice)`, a "Carried over from Seazona" badge on legacy invoices, `<LegacyOrderPanel legacy order />`.

- [ ] **Step 1: Write the failing API tests**

In `apps/api/src/services/billing/ledger.service.test.js` (it already reads the service as `source`), REPLACE the existing test "shop checkouts stay out of payment history (and so out of the refund screen)" with:

```js
test("shop checkouts and Seazona settlements stay out of payment history (and so out of the refund screen)", () => {
  assert.match(source, /notInArray\(invoicePayments\.source, HISTORY_EXCLUDED_SOURCES\)/);
  assert.doesNotMatch(source, /\[SHOP_PAYMENT_SOURCE\]/);
  assert.doesNotMatch(source, /catch \(/, "ledger reads fail closed — no soft-fail fallbacks");
});
```

`apps/api/src/routes/__tests__/refund.routes.test.js` is a `describe/it/expect` file: add `import { readFileSync } from "node:fs";` and `import { fileURLToPath } from "node:url";` at the top, and append:

```js
it("never offers a Seazona settlement row as a refundable payment", () => {
  const src = readFileSync(fileURLToPath(new URL("../refund.routes.js", import.meta.url)), "utf8");
  expect(src).toMatch(/notInArray\(invoicePayments\.source, \[\.\.\.HISTORY_EXCLUDED_SOURCES, CREDIT_SOURCE\]\)/);
});
```

Append to `apps/api/src/services/billing/invoice-views.test.js`:

```js
test("a settlement row reads as a settlement; a legacy invoice shows its Seazona patient", () => {
  assert.equal(ledgerEntryKind({ source: "legacy_settlement", appliedCents: 500 }), "settlement");
  const legacy = { ...detail, invoice: { ...detail.invoice, kind: "legacy", labOrderId: null, legacyPatient: "Test Patient" }, labOrder: null };
  const v = doctorInvoiceView(legacy);
  assert.equal(v.kind, "legacy");
  assert.equal(v.patientName, "Test Patient");
  assert.equal(doctorInvoiceView(detail).patientName, detail.labOrder?.patientName ?? null, "a normal invoice is unchanged");
});
```

Append to `apps/api/src/services/billing/invoice-model.test.js`:

```js
test("a legacy invoice prints Seazona's patient when there is no lab order", () => {
  const m = buildInvoiceModel({ ...invoice, kind: "legacy", legacyPatient: "Test Patient" }, lines, client, null, { generatedAt });
  assert.deepEqual(m.header.find((h) => h[0] === "Patient"), ["Patient", "Test Patient"]);
});
```

Append to `apps/api/src/services/billing/statement-model.test.js`:

```js
test("statements: an opening balance and a Seazona settlement read plainly", () => {
  const events = statementEvents({
    invoices: [
      { id: "o", invoiceNumber: 16211, kind: "legacy", legacySeazonaInvoiceId: "opening:1324", status: "issued", totalCents: 9000, issuedAt: new Date("2026-11-07T02:00:00Z"), voidedAt: null },
      { id: "h", invoiceNumber: 11115, kind: "legacy", legacySeazonaInvoiceId: "inv-11115", status: "issued", totalCents: 30000, issuedAt: new Date("2026-01-30T17:00:00Z"), voidedAt: null },
    ],
    payments: [{ invoiceId: "h", invoiceNumber: "11115", appliedCents: 17950, source: "legacy_settlement", paidOn: "2026-01-30", createdAt: new Date() }],
  });
  assert.deepEqual(events.map((e) => [e.kind, e.description, e.amountCents]), [
    ["invoice", "Invoice #11115", 30000],
    ["settlement", "Settled in Seazona — invoice #11115", -17950],
    ["invoice", "Opening balance carried from Seazona — invoice #16211", 9000],
  ]);
});
```

Append to `apps/api/src/services/lab/lab-order-rules.test.js` (add `presentBoardCard` to its imports if missing):

```js
test("a legacy order's board card says where it came from and never shows a patient", () => {
  const card = presentBoardCard({ order: { id: "lo", orderNumber: 98000, source: "legacy", sourceId: "ord-1", status: "in_production", version: 1, legacyPatient: "Test Patient" }, clientName: "Dr. Example" }, [], "2026-11-01");
  assert.equal(card.reference, "Seazona");
  assert.equal(card.practice, "Dr. Example");
  assert.ok(!JSON.stringify(card).includes("Test Patient"));
});
```

Append to `apps/api/src/services/lab/ticket-model.test.js`:

```js
test("a legacy order's ticket names the Seazona order and its patient", () => {
  const m = buildTicketModel({
    order: { orderNumber: 98000, status: "in_production", receivedAt: new Date("2026-10-20T17:00:00Z"), clientName: "Dr. Example" },
    lines: [], rxCase: null, shopOrder: null, files: [],
    legacy: { seazonaOrderId: "ord-1", patientName: "Test Patient", caseId: null, caseNumber: null },
  }, { generatedAt: new Date("2026-11-01T15:00:00Z") });
  assert.deepEqual(m.header.find((h) => h[0] === "Seazona order"), ["Seazona order", "ord-1"]);
  assert.deepEqual(m.header.find((h) => h[0] === "Patient"), ["Patient", "Test Patient"]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/billing src/services/lab src/routes/__tests__/refund.routes.test.js`
Expected: FAIL on each new test.

- [ ] **Step 3: Payment history and refunds leave out settlements**

`apps/api/src/services/billing/ledger.service.js`: import `HISTORY_EXCLUDED_SOURCES` (drop `SHOP_PAYMENT_SOURCE` from the import if unused) and replace the `NOT_SHOP` constant and its comment with:

```js
// A shop checkout pays an order, not a bill someone chose to pay, and a
// Seazona settlement (piece 5) is bookkeeping: both stay out of payment
// history (and so out of the refund screen).
const IN_HISTORY = or(isNull(invoicePayments.source), notInArray(invoicePayments.source, HISTORY_EXCLUDED_SOURCES));
```

and use `IN_HISTORY` in `listPaymentsForUser` and `listAllPayments` in place of `NOT_SHOP`.

`apps/api/src/routes/refund.routes.js`: in its `@my-app/shared` import replace `SHOP_PAYMENT_SOURCE` with `HISTORY_EXCLUDED_SOURCES`, and change the original-rows filter to:

```js
        or(isNull(invoicePayments.source), notInArray(invoicePayments.source, [...HISTORY_EXCLUDED_SOURCES, CREDIT_SOURCE])),
```

(update the comment above it: "Shop checkouts, Seazona settlements and staff credits are not portal card payments: never refunded here.").

- [ ] **Step 4: Legacy invoices read correctly**

`apps/api/src/services/billing/invoice-views.js`: import `LEGACY_SETTLEMENT_SOURCE` from `@my-app/shared`; `ledgerEntryKind` becomes:

```js
/** What a ledger row is, to a person reading the invoice. */
export function ledgerEntryKind(row) {
  if (row.source === LEGACY_SETTLEMENT_SOURCE) return "settlement";
  if (row.source === "credit") return "credit";
  return row.appliedCents < 0 ? "refund" : "payment";
}
```

and in `doctorInvoiceView`, change the patient to `patientName: labOrder?.patientName ?? invoice.legacyPatient ?? null,`.

`apps/api/src/services/billing/invoice-queries.js`:
- import `decryptField` from `../../lib/crypto.js`.
- Below `patientInitials`, add:

```js
/** A legacy invoice's patient initials (its sealed legacy_patient); null when none or unreadable. */
function legacyInitials(sealed) {
  if (!sealed) return null;
  try {
    return initialsFor(decryptField(sealed));
  } catch {
    return null;
  }
}

/** A legacy line shows its Seazona text (opened) as its description; every other line is unchanged. */
const presentLine = ({ legacyDescription, ...line }) => (legacyDescription ? { ...line, description: legacyDescription } : line);
```

- In `listClientInvoices`, change `patientInitials: patientInitials(rows[i]),` to `patientInitials: patientInitials(rows[i]) ?? legacyInitials(rows[i].invoice.legacyPatient),`.
- In `getInvoiceDetail`, change the lines line to:

```js
  const lines = (await database.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position))).map(openLine).map(presentLine);
```

`apps/api/src/services/billing/invoice-model.js`: change the patient header row to `["Patient", order?.patientName ?? invoice.legacyPatient ?? "—"],`.

`apps/api/src/services/billing/statement-model.js`:
- import `isOpeningBalanceInvoice` from `@my-app/shared`.
- `const KIND_ORDER = { invoice: 0, payment: 1, settlement: 1, credit: 2, refund: 3, void: 4 };`
- In `statementEvents`, the invoice event's description becomes:

```js
    const description = isOpeningBalanceInvoice(inv) ? `Opening balance carried from Seazona — invoice #${inv.invoiceNumber}` : `Invoice #${inv.invoiceNumber}${order}`;
    events.push({ date: labDay(inv.issuedAt), kind: "invoice", invoiceId: inv.id, description, amountCents: inv.totalCents });
```

- and the payment label becomes:

```js
    const label = kind === "credit" ? "Credit" : kind === "refund" ? "Refund" : kind === "settlement" ? "Settled in Seazona" : paymentLabel(p.source);
```

`apps/api/src/services/billing/statements.service.js` `loadStatementActivity`: add `kind: invoices.kind, legacySeazonaInvoiceId: invoices.legacySeazonaInvoiceId,` to the invoice select.

- [ ] **Step 5: Legacy lab orders read correctly**

`apps/api/src/services/lab/lab-order-rules.js` `presentBoardCard`: replace the `reference` line with:

```js
    reference: o.source === "rx_case" ? (row.caseNumber ?? null) : o.source === "legacy" ? "Seazona" : (row.shopOrderNumber ?? null),
```

`apps/api/src/services/lab/lab-orders.service.js` `getLabOrderDetail`: replace the `} else {` branch that loads the shop order with two branches, and add `legacy` to the result:

```js
  } else if (order.source === "shop_order") {
    const [s] = await db
      .select({ id: orders.id, orderNumber: orders.orderNumber, email: orders.email, phone: orders.phone, shipping: orders.shipping, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.id, order.sourceId));
    shopOrder = s ?? null;
  } else if (order.source === "legacy") {
    // A Seazona order imported at cutover (piece 5). If a portal Rx case was
    // pushed to it, link the case: its files and form live there.
    const [c] = await db
      .select({ id: rxCases.id, caseNumber: rxCases.caseNumber })
      .from(rxCases)
      .where(eq(rxCases.seazonaOrderId, order.sourceId))
      .limit(1);
    legacy = { seazonaOrderId: order.sourceId, patientName: order.legacyPatient ?? null, caseId: c?.id ?? null, caseNumber: c?.caseNumber ?? null };
  }
```

with `let legacy = null;` declared next to `let shopOrder = null;`, and `legacy,` added to the returned object after `shopOrder,`.

`apps/api/src/services/lab/ticket-model.js` `buildTicketModel`: destructure `legacy = null` from `detail`, and change two header rows:

```js
      rxCase ? ["Case", rxCase.caseNumber ?? "—"] : legacy ? ["Seazona order", legacy.seazonaOrderId] : ["Shop order", shopOrder?.orderNumber ?? "—"],
```

```js
      ["Patient", rxCase?.patientName || legacy?.patientName || "—"],
```

- [ ] **Step 6: Run the API tests to verify they pass**

Run: `cd apps/api && pnpm test`
Expected: PASS.

- [ ] **Step 7: Web — legacy invoices**

Append to `apps/web/src/lib/__tests__/invoices.test.js` (add `ENTRY_LABELS, legacyOrderBlock` to its import):

```js
test("a Seazona settlement has a label; a legacy invoice's order block carries its patient", () => {
  assert.equal(ENTRY_LABELS.settlement, "Settled in Seazona");
  assert.deepEqual(legacyOrderBlock({ kind: "legacy", legacyPatient: "Test Patient" }), { patientName: "Test Patient" });
  assert.equal(legacyOrderBlock({ kind: "order" }), null);
});
```

In `apps/web/src/lib/invoices.js`:

```js
export const ENTRY_LABELS = { payment: "Payment", credit: "Credit", refund: "Refund", settlement: "Settled in Seazona" };

/** The order block InvoiceView shows for a legacy invoice with no lab order: just Seazona's patient. */
export const legacyOrderBlock = (invoice) => (invoice?.kind === "legacy" ? { patientName: invoice.legacyPatient ?? null } : null);
```

In `apps/web/src/components/billing/InvoiceView.jsx`, after the issued/due `<span>`s inside the status row, add:

```jsx
            {invoice.kind === "legacy" && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">Carried over from Seazona</span>
            )}
```

In `apps/web/src/pages/app/AdminInvoiceDetailPage.jsx`, import `legacyOrderBlock` from `../../lib/invoices.js` and change `order={labOrder}` to `order={labOrder ?? legacyOrderBlock(invoice)}`. (The doctor detail page needs no change: the API's `patientName` already falls back.)

- [ ] **Step 8: Web — legacy lab orders**

Create `apps/web/src/components/lab/LegacyOrderPanel.jsx`:

```jsx
import { Link } from "react-router-dom";
import { History } from "lucide-react";

/**
 * A Seazona order imported at cutover. Shipped and cancelled ones are history;
 * open ones are worked on the board like any order, but their bill is the
 * imported Seazona invoice, so shipping one issues nothing new.
 */
export function LegacyOrderPanel({ legacy, order }) {
  const open = order.status !== "shipped" && order.status !== "cancelled";
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-semibold"><History size={14} /> Seazona history</p>
      <p className="mt-1">
        Seazona order <span className="font-mono">{legacy.seazonaOrderId}</span>
        {legacy.patientName ? <> · Patient: <span className="font-medium">{legacy.patientName}</span></> : null}
      </p>
      <p className="mt-1 text-amber-800/80">
        {open ? "Open when we left Seazona: work it here. It was billed in Seazona; shipping it adds no new invoice." : "Read-only history from Seazona."}
      </p>
      <p className="mt-1 text-amber-800/80">
        {legacy.caseId
          ? <>Files and the prescription are on portal case <Link className="font-mono underline" to={`/admin/rx-cases/${legacy.caseId}`}>{legacy.caseNumber}</Link>.</>
          : "Its files stay in Seazona."}
      </p>
    </div>
  );
}
```

In `apps/web/src/pages/lab/LabOrderDetailPage.jsx`:
- import `{ LegacyOrderPanel }` from `../../components/lab/LegacyOrderPanel.jsx`.
- `const { order, lines, events, rxCase, files, shopOrder, shipment, legacy } = detail;`
- In the header row, after `{shopOrder && <span className="font-mono text-xs">{shopOrder.orderNumber}</span>}`, add `{legacy && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Seazona history</span>}`.
- Directly before `{rxCase?.buildNotes && <Panel title="Build notes">…`, add `{legacy && <LegacyOrderPanel legacy={legacy} order={order} />}`.
- In the practice/patient block, change the patient line to `{(rxCase?.patientName || legacy?.patientName) && <>Patient: <span className="text-navy">{rxCase?.patientName || legacy?.patientName}</span></>}`.

That is 5 changed lines in a page already over the component limit (noted for the PR body).

- [ ] **Step 9: Verify**

Run: `pnpm test && pnpm --filter @my-app/web build`
Expected: PASS, build succeeds.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src apps/web/src
git commit -m "feat(lab,billing): legacy invoices, settlements, opening balances and Seazona orders read plainly

Settlements stay out of payment history and refunds; legacy lines show their
sealed Seazona text; legacy orders show their patient and the linked portal case.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Runbooks, CLAUDE.md, whole-piece verification and PR

**Files:**
- Create: `docs/import-operations.md`, `docs/cutover-runbook.md`
- Modify: `CLAUDE.md` (the "Bulk import" paragraph only)

**Interfaces:**
- Consumes: every CLI and flag from Tasks 5–14; Task 4's `main` PR.
- Produces: the two operator documents the spec names. They are executed by the operator with the user, never by an implementer.

- [ ] **Step 1: Write `docs/import-operations.md`**

````markdown
# Seazona import operations (own-the-lab piece 5)

How to fetch Seazona into the raw store, rehearse the load, and read parity.
Spec: `docs/superpowers/specs/2026-10-21-migration-and-cutover-design.md`.
The cutover itself is `docs/cutover-runbook.md`.

## Rules (from the spec — every step obeys them)

1. Work happens on `feat/own-the-lab-5-cutover` / `feat/own-the-lab`. Nothing touches `main` or the production DB before the cutover; the cutover needs the user's explicit go.
2. Seazona calls go only through `seazona.service.js` (50/min, one stream). Every fetch is a dry run first. **Any fetch over 100 requests needs the user's OK, given the request count and minutes the dry run prints.** No fetch runs from Cloud Run (the CLIs refuse there).
3. PHI never lands on a laptop disk: records go straight into `diamond_labs_import`, sealed with production's `PHI_ENCRYPTION_KEY`.
4. Every load runs against `diamond_labs_rehearsal` first; production uses the same command with `--target production`.

One Seazona stream at a time: never run two `import:fetch` commands at once, and never while anything else (a script, a dev server with Seazona enabled) is calling Seazona.

## One-time setup

All on project `diamond-labs-prod`, instance `diamond-labs-db`, as a gcloud account that administers it.

1. Create the database and its own role (no access to app tables):

   ```bash
   gcloud sql databases create diamond_labs_import --instance=diamond-labs-db --project=diamond-labs-prod
   gcloud sql users create importer --instance=diamond-labs-db --project=diamond-labs-prod --password="$(openssl rand -base64 30)"
   ```

   Then, as `postgres` through the proxy: `ALTER DATABASE diamond_labs_import OWNER TO importer; REVOKE CONNECT ON DATABASE diamond_labs_import FROM PUBLIC; GRANT CONNECT ON DATABASE diamond_labs_import TO importer; \c diamond_labs_import; ALTER SCHEMA public OWNER TO importer;`. Keep the importer password in Secret Manager (`IMPORT_DATABASE_PASSWORD`), never in a file.

2. Open the proxies (one terminal each; ports are a convention):

   ```bash
   cloud-sql-proxy --port 6001 diamond-labs-prod:us-central1:diamond-labs-db   # import + rehearsal
   ```

   (One proxy serves every database on the instance; the URLs below differ only by user and database.)

3. In the shell that runs the commands — never in `.env`:

   ```bash
   export IMPORT_DATABASE_URL="postgresql://importer:${IMPORTER_PW}@127.0.0.1:6001/diamond_labs_import"
   # Production's PHI key: the secret the API service's PHI_ENCRYPTION_KEY points at
   gcloud run services describe diamond-labs-api --region=us-central1 --project=diamond-labs-prod \
     --format="yaml(spec.template.spec.containers[0].env)" | grep -A3 PHI_ENCRYPTION_KEY
   export PHI_ENCRYPTION_KEY="$(gcloud secrets versions access latest --secret=<that secret> --project=diamond-labs-prod)"
   ```

   An inline export wins over `apps/api/.env` (`node --env-file` never overrides a set variable). Every CLI checks the key: the first run writes a key check into the import DB, every later run must open it, and loads must also open a sealed value in the target.

4. Migrate the import DB: `pnpm --filter @my-app/api import:db:migrate`.

## Fetch

Summaries are a handful of list calls; details are one call per record.

| Command | Requests | Notes |
|---|---|---|
| `import:fetch clients` | 1 | |
| `import:fetch users` | 1 | lab staff (archive only) |
| `import:fetch products` | 1 | archive only; the catalog is local since piece 1 |
| `import:fetch invoices` | ≈2 | ~16k invoices, past the 10k cap |
| `import:fetch orders` | ≥1 | one per 10k orders |

1. Run each without `--live`: it prints the planned requests and minutes and calls nothing. Tell the user the total (≈6 requests) before the first live run, even though it is under 100.
2. Run each with `--live`. A summary fetch is always full and re-runnable.
3. Detail, dry run first. The usual scope (user decision 3):
   - **Invoices with an open balance:** seal the lab's per-invoice export first (`import:fetch export --balances per-invoice --file <export.xls>` prints its id; no Seazona call; delete the local file), then `import:fetch invoices --detail --open-balance --file-id <id>`.
   - **Invoices of the last 12 months:** `import:fetch invoices --detail --since <YYYY-MM-DD>`.
   - **Open orders:** `import:fetch orders --detail --open`.
   Each prints `Plan: N Seazona request(s), about M min at 50/min.` Give the user N and M. With the OK: re-run with `--live --approved N`.
4. **If a run prints "BLOCKED" (403):** stop everything that talks to Seazona. Do not retry. Tell the user at once (production's portal is blocked too). Check `GET /api/v1/health/seazona` (authenticated) every hour or so; when it answers 200, resume with `import:fetch <entity> --detail --resume <runId> --live --approved <remaining>`.
5. A later re-fetch skips details already as new as their summary (`--refetch` forces).
6. **Order files probe (once, needs the user's OK — 1 request):** whether an order's files can be downloaded is still unknown. Pick one open order id from the dry run and run `import:fetch orders --detail --ids <id> --live`; then look (in memory, via a one-off `node -e` that reads the record through `raw-store.js` `readRecords` — never print it) at the `files` entries' fields. Record the field names only. If a download URL exists, copying files is a follow-up task; otherwise the order page keeps saying "Its files stay in Seazona".

## Rehearse

1. **Clone production into `diamond_labs_rehearsal`** (the staging recipe; PHI stays inside GCP):

   ```bash
   gcloud storage buckets create gs://diamond-labs-rehearsal-seed --project=diamond-labs-prod --location=us-central1 --uniform-bucket-level-access
   gcloud storage buckets update gs://diamond-labs-rehearsal-seed --lifecycle-file=<(echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}')
   # grant the instance's service account write on the bucket (gcloud sql instances describe … --format='value(serviceAccountEmailAddress)')
   gcloud sql export sql diamond-labs-db gs://diamond-labs-rehearsal-seed/prod.sql --database=diamond_labs --project=diamond-labs-prod
   gcloud sql databases create diamond_labs_rehearsal --instance=diamond-labs-db --project=diamond-labs-prod
   gcloud sql import sql diamond-labs-db gs://diamond-labs-rehearsal-seed/prod.sql --database=diamond_labs_rehearsal --project=diamond-labs-prod
   gcloud storage rm gs://diamond-labs-rehearsal-seed/prod.sql   # whatever the import's result
   ```

   The rehearsal holds real PHI: same protections as production, wired to no service, dropped after the cutover.

2. **Migrate it with the branch's migrations, and time it** (this number sets the freeze window):

   ```bash
   export REHEARSAL_DATABASE_URL="postgresql://<admin user>:<pw>@127.0.0.1:6001/diamond_labs_rehearsal"
   time DATABASE_URL="$REHEARSAL_DATABASE_URL" pnpm --filter @my-app/api db:migrate:run
   ```

3. **Load, in order, dry run then `--live`:**

   ```bash
   pnpm --filter @my-app/api import:load clients  --target rehearsal [--live]
   pnpm --filter @my-app/api import:load invoices --target rehearsal --invoice-start <seazona max + 1> --order-start <seazona max + 1> [--live]
   pnpm --filter @my-app/api import:load balances --target rehearsal --balances per-invoice --file-id <id> [--live]
   pnpm --filter @my-app/api import:load orders   --target rehearsal --order-start <seazona max + 1> [--live]
   ```

   The invoices dry run prints `seeds.seazonaMax`: those + 1 are the seed values for the cutover. An `unknown_status` problem in the orders dry run means a Seazona state isn't in `import/seazona-records.js` yet: add it (one line + its test), and re-run. Time each live step.

4. **Parity:** `pnpm --filter @my-app/api import:parity --target rehearsal --balances per-invoice --file-id <id> --invoice-start … --order-start …`. Exit 0 = clean. Anything else lists `differences`; each must be fixed or explained to the user and accepted.

5. **Lab walkthrough (optional):** a local, private dev server pointed at the rehearsal — never a public service:

   ```bash
   DATABASE_URL="$REHEARSAL_DATABASE_URL" SEAZONA_DISABLED=true AUTHORIZE_NET_ENV=sandbox PAYMENTS_PAUSED=true \
     MAILGUN_API_KEY= CARRIER_ENV=sandbox pnpm --filter @my-app/api dev
   pnpm --filter @my-app/web dev   # localhost only
   ```

   No mail leaves (no Mailgun key), no card is charged (sandbox, payments paused), no Seazona call is possible.

## Credits, unmatched rows and other problems

- `credit_balance_for_staff`: a client or invoice with a negative balance. Nothing is written; after cutover staff apply it with the invoice Credit action.
- `export_row_without_invoice` / `export_account_without_client`: the export names something the load doesn't have. Usually a client skipped for no email (`--no-email skip`) or an invoice whose summary wasn't fetched. Fix the cause and re-run; never edit the export.
- `invoice_number_taken` / seed errors: a number collision. Stop and tell the user.
````

- [ ] **Step 2: Write `docs/cutover-runbook.md`**

````markdown
# Cutover runbook (own-the-lab piece 5)

Executed once, by the operator with the user, inside the agreed window. Every
time below is the lab's local time (America/Chicago). Read
`docs/import-operations.md` first: its setup, rules and commands apply here.

**Nothing here starts without the user's explicit go. Step 4 (the merge to
`main`) needs a second, separate sign-off at that moment.**

## T−1 week (all must be true)

- [ ] Rehearsal parity is clean, or every difference is accepted by the user in writing.
- [ ] The lab has walked through the rehearsal.
- [ ] The user has given the go and picked the window. Freeze length = rehearsal migrate time + load time + 2 h margin (fill in: migrate ___ min, load ___ min).
- [ ] The doctors' notice email is drafted; the user sends it (code never does).
- [ ] The `PAYMENTS_PAUSED` PR (plan Task 4) is merged to `main`, deployed, and production still takes payments with the flag unset. Merge SHA: ___
- [ ] New env and secrets are staged in Secret Manager (not attached yet): carriers and `LAB_*` (`docs/shipping-operations.md`), mail settings, and the seeds (computed in step 3).
- [ ] Cloud Run env to drop at the merge: `RX_LIVE_PUSH`, `SEAZONA_ORDER_USER_ID` (piece 2 carry-over). `LAB_SHOP_REPAIR_SINCE` = piece 2's production deploy date.

## 1. Freeze

1. The lab stops entering invoices, payments and orders in Seazona.
2. Pause payments on the current production revision, at least **35 minutes before step 4** (the hosted-payment binding lives 30 minutes, so no hosted payment can still be completing when migration 0030 drops `applied_amount`):

   ```bash
   gcloud run services update diamond-labs-api --region=us-central1 --project=diamond-labs-prod --update-env-vars=PAYMENTS_PAUSED=true
   ```

   Check: a doctor pressing Pay sees "Payments are paused for an upgrade."
3. AutoPay stays off (`AUTOPAY_LIVE_RUN` unset; it runs dry).

## 2. Backup and record

```bash
gcloud sql backups create --instance=diamond-labs-db --project=diamond-labs-prod --description="pre-cutover"
gcloud sql backups list --instance=diamond-labs-db --project=diamond-labs-prod --limit=1   # record BACKUP_ID
git rev-parse origin/main                                                                   # record MAIN_SHA
gcloud run services describe diamond-labs-api --region=us-central1 --project=diamond-labs-prod \
  --format="value(spec.template.spec.containers[0].image)"                                  # record IMAGE (digest)
```

Backup id ___ · main SHA ___ · image ___

## 3. Final delta fetch and final balance export

1. Summaries (≈6 requests): `import:fetch clients|invoices|orders --live`.
2. Details for what changed (dry run first; the count is small; with the user's OK `--live --approved N`): `import:fetch invoices --detail --since <last rehearsal fetch date>` and `import:fetch orders --detail --open`.
3. The lab produces the final balance export from the Seazona portal. Seal it at once and delete the local file:
   `import:fetch export --balances <path chosen at T−1> --file <export.xls>` (prints the file id; no Seazona call) — then delete the downloaded file and empty the Trash.
4. Seeds: the invoices dry run's `seeds.seazonaMax` + 1 → `INVOICE_NUMBER_START`, `LAB_ORDER_NUMBER_START`.

## 4. Merge `feat/own-the-lab` → `main` (user's explicit sign-off now)

1. Attach the staged env and secrets, with the seeds, to the service **before** the merge so the new revision boots with them (`gcloud run services update … --update-env-vars INVOICE_NUMBER_START=…,LAB_ORDER_NUMBER_START=… --update-secrets …`; remove `RX_LIVE_PUSH`, `SEAZONA_ORDER_USER_ID`). Keep `PAYMENTS_PAUSED=true`.
2. Open the PR `feat/own-the-lab` → `main` (≈424+ files: over CodeRabbit's cap; every piece was reviewed as its own PR — say so in the body). If it conflicts on `middleware/payments-paused.js`, its test or `payments-paused-wiring.test.js`, the two sides are identical; on `env.js` / route files keep `feat/own-the-lab`'s side (it already has the flag).
3. The user merges. Cloud Build (`deploy-api-on-main`) runs migrate (0025–0033, one transaction) then deploy. Watch it to completion: `gcloud builds list --project=diamond-labs-prod --limit=1` then `gcloud builds log <id> --project=diamond-labs-prod --stream`.

## 5. Load into production, then parity

```bash
export PRODUCTION_DATABASE_URL="postgresql://<admin user>:<pw>@127.0.0.1:6001/diamond_labs"
P="--target production --confirm-production diamond_labs --invoice-start <seed> --order-start <seed>"
pnpm --filter @my-app/api import:load clients  $P            # dry run, read it, then:
pnpm --filter @my-app/api import:load clients  $P --live
pnpm --filter @my-app/api import:load invoices $P --live     # each after its dry run
pnpm --filter @my-app/api import:load balances $P --balances <path> --file-id <final export id> --cutover-at <ISO of step 1> --live
pnpm --filter @my-app/api import:load orders   $P --live
pnpm --filter @my-app/api import:parity $P --balances <path> --file-id <final export id>
```

Parity must be clean (exit 0), or the user accepts each difference. Otherwise: rollback (step 8).

## 6. Smoke (operator + one lab admin)

- Log in as a lab admin and as a test doctor.
- Open a legacy invoice: "Carried over from Seazona", the patient, the right balance.
- Check a known client's balance against the final export.
- Release a test Rx case to the board; it gets a number from `LAB_ORDER_NUMBER_START`.
- With `PAYMENTS_PAUSED` still on, confirm Pay is refused; then (step 7) after unfreezing, make a $1 card payment and refund it.
- Run the tracking job dry (`docs/shipping-operations.md`).

## 7. Unfreeze

```bash
gcloud run services update diamond-labs-api --region=us-central1 --project=diamond-labs-prod --remove-env-vars=PAYMENTS_PAUSED
```

- $1 payment + refund (step 6's last item).
- Cloud Scheduler: the jobs in `docs/shipping-operations.md` and `docs/autopay-operations.md`, plus `shop-lab-orders-repair` (POST `/internal/jobs/shop-lab-orders-repair/run`, header `x-jobs-trigger-secret`, body `{"dryRun":false}`), its first documented schedule.
- GCP log alerts: `[PAYMENT][LEDGER_WRITE_FAILED]`, `[PAYMENT][CAPTURED_NOT_RECORDED]`, `[PAYMENT][REFUND_UNCERTAIN]`, `[PAYMENT][REFUND_LEDGER_WRITE_FAILED]`, `[PAYMENT][REFUND_PENDING_CLEANUP_FAILED]`, `[BILLING][ISSUE_FAILED]`, `[BILLING][VOID_FAILED]`, `[AutoPay][LEDGER_WRITE_FAILED]`, `[LAB][SHOP_ORDER_FAILED]`, `[LAB][SHOP_ORDER_REPAIR_FAILED]`, and the `[SHIP][…]` lines in `docs/shipping-operations.md`.
- The lab works in the new system. Seazona is read-only reference.
- Watch the first day closely: anything entered after unfreeze is re-keyed by hand on a rollback.

## 8. Rollback (before unfreeze, or within the first day if something is badly wrong)

1. `gcloud run deploy diamond-labs-api --image=<IMAGE from step 2> --region=us-central1 --project=diamond-labs-prod`
2. Restore the database from the step-2 backup: `gcloud sql backups restore <BACKUP_ID> --restore-instance=diamond-labs-db --project=diamond-labs-prod`. A git revert is not enough: 0030 dropped a column the old code needs. **This restores the whole instance**, so `diamond_labs_staging` and `diamond_labs_import` roll back too: re-run the staging scrub job afterwards (staging refuses to boot otherwise) and re-run step 3's fetches before any retry.
3. Remove `PAYMENTS_PAUSED` once the old revision is serving. The lab resumes on Seazona.
4. Revert the merge on `main` in a PR (user sign-off) so the next push doesn't redeploy it.

## After the cutover

- Drop `diamond_labs_rehearsal`: `gcloud sql databases delete diamond_labs_rehearsal --instance=diamond-labs-db --project=diamond-labs-prod`.
- Keep `diamond_labs_import` until the lab signs off on Seazona being gone (piece 5b).
````

- [ ] **Step 3: Update `CLAUDE.md`**

Replace the "**Bulk import:**" paragraph (the one naming `pnpm db:import-seazona`) with:

```markdown
**Bulk import (own-the-lab piece 5):** Seazona is imported through a sealed raw store (`diamond_labs_import`), never by live calls from a load: `import:fetch` (the only Seazona caller; dry run first, `--approved <n>` over 100 requests, stops on a 403), then `import:load clients|invoices|balances|orders --target rehearsal|production`, then `import:parity`. Runbooks: `docs/import-operations.md`, `docs/cutover-runbook.md`. Imported doctors have `passwordHash=null` and log in after a password reset; clients with no email get a suspended placeholder on `@seazona-clients.invalid`, which is never mailed.
```

- [ ] **Step 4: Whole-piece verification**

Run each and confirm:
- `pnpm test` (repo root): PASS.
- `pnpm --filter @my-app/web build`: succeeds.
- `cd apps/api && pnpm db:generate`: "No schema changes"; `pnpm import:db:generate`: "No schema changes".
- `cd apps/api && pnpm vitest run src/services/seazona-access.test.js src/routes/__tests__/seazona-order-retired.test.js src/routes/__tests__/seazona-invoice-retired.test.js`: PASS.
- `grep -rln "seazona.service" apps/api/src/import`: only `fetch-cli.js`.
- `grep -rn "alert(\|confirm(\|prompt(" apps/web/src/components/doctor/PaymentsPausedBanner.jsx apps/web/src/components/lab/LegacyOrderPanel.jsx`: nothing.
- Size limits: no new source file over 1,000 lines (`wc -l apps/api/src/import/*.js` — all well under 300), no function over 150 lines.
- `git diff --name-only origin/feat/own-the-lab...HEAD | wc -l`: expect about 137. Over ~145: split per "Estimated size" before opening a PR.

- [ ] **Step 5: Commit**

```bash
git add docs/import-operations.md docs/cutover-runbook.md CLAUDE.md
git commit -m "docs: import operations and cutover runbook (piece 5)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Push and open the PR into `feat/own-the-lab`**

1. Check CodeRabbit capacity first (the user's rule): look for a recent "Review paused" notice and count CodeRabbit reviews in the last hour across the repo; if no slot is free, wait.
2. `git push origin feat/own-the-lab-5-cutover` (never a bare `git push`).
3. Open the PR into `feat/own-the-lab` (not `main`): `gh pr create --base feat/own-the-lab --head feat/own-the-lab-5-cutover`. The body lists every task, states the file count, and carries:
   - the user decisions below, open for the user;
   - follow-ups: `LabOrderDetailPage.jsx` split (over the component limit before this piece); copying open orders' files if the probe shows downloads work; piece 5b clean-up;
   - "No live Seazona call, no production write and no `main` change was made. Task 4's `main` PR is NOT opened: it needs the user's sign-off."
4. Verify CodeRabbit actually reviewed (inline findings, not just the walkthrough). Merging into `feat/own-the-lab` deploys staging only; staging has `SEAZONA_DISABLED=true` and the CLIs refuse on Cloud Run.

---

## Decisions for the user (raised at plan review)

From the spec, with what this plan does by default:

1. **Window.** Date and freeze length. The rehearsal measures migrate and load times (runbook T−1).
2. **Balances path.** Per-invoice if the lab can export open balances per invoice (Invoices & Payments report); otherwise per-client. Both are built; the operator picks with `--balances`.
3. **Fetch scope.** Summaries for everything (≈6 requests); detail for open-balance invoices, the last 12 months of invoices, and open orders. Exact counts come from the dry runs; each fetch over 100 requests is approved with its count.
4. **Placeholder logins.** Default `--no-email placeholder`: a suspended doctor on `@seazona-clients.invalid` (never mailed) so its invoices have an owner; `--no-email skip` leaves them out (their invoices then don't load and parity shows it).
5. **Payments pause.** Task 4's `main` PR, signed off on its own, merged and deployed before the window.

Added by this plan:

6. **Credit balances** are reported for staff, not written (Spec correction 12).
7. **Order files** are not copied; the probe is one approved request, and copying is a follow-up if it works (Spec correction 14).
8. **Doctor profiles** for imported doctors are created from a complete Seazona address with a blank NPI (Spec correction 4). Say "no" and the clients step can skip profiles (drop `plan.profiles` from the write).
9. **Open legacy orders are worked on the board but never billed again** (Spec correction 9). If the lab instead wants open orders billed by the new system and their Seazona invoices voided, that is a different design; raise it before the rehearsal.
10. **Shop checkout is not paused** during the freeze (it writes no invoice ledger on `main`; on the new revision a shop invoice is paid in full at checkout).

## Self-review (done while writing; kept for the executor)

**Spec coverage.**
- Safety rules → Global Constraints (verbatim) and enforced in code: Cloud Run refusal (Task 5), one-stream limiter + dry run + `--approved` (Tasks 7, 9), sealed raw store + key checks (Tasks 5, 6), fixed rehearsal/production targets with confirmation (Task 5).
- A. Raw store (`seazona_records`, `fetch_runs`, own config/migrations) → Task 6; fetcher, filters, 403 stop, cursor resume → Task 9; delta → Spec correction 2 + `--refetch`/freshness (Task 9).
- B. Loader steps: clients (+ placeholders, profiles) → Task 10; legacy invoices (+ void table, sealed patient and line text, summary line) → Task 11; opening balances (both paths, credits) → Task 12; legacy orders (+ status table, lines, files) → Task 13; seeds check → Task 11 (used by 12, 13, 14).
- Parity report → Task 14. Rehearsal DB and timing → `docs/import-operations.md` (Task 16). Cutover runbook steps 0–8 → `docs/cutover-runbook.md` (Task 16).
- Code changes list: import code (Tasks 5–14), import DB (Task 6), app schema in one migration (Task 2; `lab_orders.source` and `invoice_payments.source` are varchar, so their new values are vocabulary only — Task 1), `PAYMENTS_PAUSED` on the branch (Task 3) and the `main` PR (Task 4), UI (Task 15), guard tests (Task 7), scrub (Task 2), docs (Task 16).
- Testing list: every mapper, export parsing, both balance paths, seed checks, parity arithmetic, fetcher fake-service tests (bounded counts, no-call dry run, 403 stop, resume), writer idempotency with `fakeTx` — each has a test above.

**Placeholder scan.** No TBD/TODO. The only `<…>` values are operator inputs in the runbooks (secret names, ports' passwords, seed numbers, ids) that only exist at run time.

**Type consistency.** `raw.records(entity) → [{ seazonaId, payload, lastModified }]` everywhere; `problems` are `[{ kind, count, seazonaIds|keys }]`; `starts = { invoice, order }`; `target` is the string name in steps and the resolved object only in CLIs; `legacyIssueDay`, `centsOf`, `labNoon` live in `map-invoices.js` and are imported by `map-orders.js` and `parity.js`; `ownerIndex` / `accountOwnerIndex` / `isPlaceholderEmail` live in `map-clients.js`.

**Review Focus.** The five lines above are each pinned: Task 9 (fetcher stop/resume/404/no-call), Task 8 (export edge cases), Task 5 (targets and key), Tasks 11–13 (re-runs), Tasks 10/13/15 (live-screen effects).
