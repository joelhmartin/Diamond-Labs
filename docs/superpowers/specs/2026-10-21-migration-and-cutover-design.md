# Piece 5: Migration and cutover (design)

_2026-10-21 · roadmap: `2026-10-05-own-the-lab-roadmap.md` · builds on pieces 1–4,
all merged into `feat/own-the-lab` and running on staging_

## Goal

Move the lab off Seazona in a single, rehearsed, reversible cutover:
- load the history the lab and doctors still need;
- carry every client's balance over exactly;
- prove parity with Seazona before going live;
- switch production to the new system inside a short freeze.

Seazona is never written to. It stays readable, as the fallback, until the lab
signs off.

**Safety rules.** These bind every task in this piece.

1. **Branches.** Work happens on `feat/own-the-lab-5-cutover`, in the separate
   `own-the-lab-3` worktree, merged into `feat/own-the-lab`.
   - Nothing touches `main` or the production DB before the cutover.
   - The cutover itself needs the user's explicit go.
2. **Seazona calls** go only through `seazona.service.js` (50/min limiter, one
   stream).
   - Every bulk fetch is dry-run first.
   - Every fetch over ~100 requests needs the user's OK, given the request
     count and the expected duration.
   - No fetch runs from Cloud Run.
3. **Patient data.** PHI never lands on a laptop disk. Fetched records are
   written straight into a Cloud SQL database, with patient fields sealed by
   the existing `PHI_ENCRYPTION_KEY` helpers.
4. **Load target.** Every load runs against a rehearsal copy first. The
   production load uses the same command with a different target.

## What exists (survey 2026-10-21)

**Seazona calls left on the branch:**
- reads only;
- clients and products import scripts;
- the Rx mapping page's live product list;
- `/health/seazona`;
- the registration-time client lookup.

No payment, invoice or order code calls Seazona.

**Importers:**
- Exist, idempotent, with `DRY_RUN=1`:
  - clients (`db:import-seazona`);
  - products (`db:sync-products`);
  - catalog (`db:import-catalog`).
- Do not exist: invoices, payments, orders, files, opening balances.

**Targets that already exist:**
- `invoices.kind = 'legacy'` with unique `legacy_seazona_invoice_id`.
- `invoice_payments` legacy columns.
- Paid and balance are derived only from `invoice_payments.applied_cents`.

**Missing targets:**
- `lab_orders` has no legacy source: `source` is `rx_case | shop_order`, and
  `source_id` is NOT NULL.

**Number seeds:**
- `INVOICE_NUMBER_START` (default 500000) and `LAB_ORDER_NUMBER_START`
  (default 100000) allocate as `max(existing + 1, start)`.
- Imported legacy rows keep their own numbers. The seeds must be set to
  Seazona's last number + 1 before the first live row is created.

**The merge to `main`:**
- 424 files, which is over CodeRabbit's 150-file cap. Every piece was reviewed
  separately as its own PR.
- It applies migrations 0025–0032 to production in one transaction, before
  the new revision deploys (`cloudbuild.yaml` migrates, then deploys).
- 0030 drops `invoice_payments.applied_amount`. The old revision still writes
  that column, so payments must be frozen for the window between migrate and
  deploy.
- `main` has no commits that `feat/own-the-lab` lacks (checked 2026-10-21).

**Seazona facts** (memory, verified earlier):
- **Invoice summaries:** about 16k exist. The list endpoint caps at 10k rows,
  so it takes two fetches: `lastModified=1900-01-01` and
  `lastModified=2025-11-29T15:05:51`. That is a handful of calls for every
  summary.
- **Invoice detail** (lines) is one call per invoice.
- **Payments and balances are not readable** through the API. The admin portal
  has an "Export to Excel" (an HTML `<table>` saved as `.xls`) for the
  statements grid.
  - That export is the only source of balances.
  - Whether a *per-invoice* open-balance export exists is unknown (the
    portal's "Invoices & Payments" report may give one).
- **Orders:** the list (`?ordered=`) is a few calls. Detail (lines, files,
  settings) is one call per order.
  - Whether files can be downloaded is unknown. The 2026-10-05 probe was
    blocked by the rate limit.
- **Client price lists** are UI-only.

## Design

### Three phases

| Phase | When | Touches prod? | What happens |
|---|---|---|---|
| **A. Fetch** | Weeks before cutover, then a delta at cutover | No (writes only the import DB) | Pull Seazona records into an encrypted raw store |
| **B. Rehearse** | Before cutover, repeatable | No (writes a rehearsal DB cloned from prod) | Migrate the clone to the branch schema, load from the raw store, run parity, have the lab click through |
| **C. Cutover** | One agreed window (e.g. Friday evening to Saturday) | Yes | Freeze → backup → merge to main (migrate + deploy) → delta fetch → load → opening balances → parity → unfreeze |

A post-cutover clean-up (**piece 5b**) is out of this design. It drops the
`seazona*` columns, removes `seazona.service.js`, the Rx-mapping Seazona list
and the health probe, and renames `seazonaCode`. It ships only after the lab
has run on the new system for a while. Rollback stays simple in the meantime:
nothing is deleted on day one.

### A. Raw store (`legacy_raw` in a dedicated import database)

- **Database.** `diamond_labs_import` sits on the existing Cloud SQL
  instance, owned by its own role. Only the importer and the operator use it.
  It holds raw Seazona JSON, not app tables.
- **Table.** `seazona_records`:
  - `entity` (`client | product | invoice | invoice_detail | order |
    order_detail | user`);
  - `seazona_id`;
  - `payload` (the JSON, sealed with `encryptJson`);
  - `last_modified`, `fetched_at`, `fetch_run_id`.

  The row is unique on `(entity, seazona_id)` and upserted, so fetching is
  idempotent and resumable.
- **Table.** `fetch_runs`: id, entity, started/finished, request count,
  error count, cursor (for resuming detail fetches).
- **Fetcher** (`apps/api/src/import/seazona-fetch.js`, CLI
  `pnpm --filter @my-app/api import:fetch <entity> [--detail <filter>] [--live]`):
  - Calls only `seazona.service.js`.
  - Without `--live` it prints the planned request count and estimated
    minutes and makes **no** Seazona call beyond the cheap list calls, which
    are themselves counted and shown first.
  - Detail fetches take an explicit filter, so the request count is bounded
    and approved. The filters are:
    - invoices with an open balance per the export;
    - invoices issued since a date;
    - orders not yet shipped;
    - an explicit id list.
  - It stops on the first 403 "temporarily disabled" and records the cursor.
    It never retries into a block.
- **Delta at cutover.** A summary re-fetch with `lastModified` / `ordered`
  after the last run's high-water mark.

### B. Loader (raw store → app tables), shared by rehearsal and production

Pure mapping modules (`apps/api/src/import/map-*.js`) turn raw records into
app rows. A writer applies them in batches, idempotently, keyed by the legacy
ids. The CLI is
`pnpm --filter @my-app/api import:load <step> --target <rehearsal|production> [--live]`.

Without `--live` the loader reports counts and samples, with ids only and no
PHI. Steps run in order and each is re-runnable.

1. **Clients.**
   - Reuse `import-seazona-clients` logic, moved into a mapper over the raw
     store instead of a live call.
   - If Seazona client records carry an address, fill missing
     `doctor_profiles` addresses (piece 4 ship-to). This is checked in the
     rehearsal.
   - Clients with no email still get a `users` row: `status: inactive`, no
     login, a placeholder email in a reserved domain. Their invoices then have
     an owner and show on statements once a real login is linked.
2. **Legacy invoices.** One `invoices` row per Seazona invoice:
   - `kind: legacy`, `status: issued` (or `void` where Seazona's workflow
     status is a void/cancel state; mapping table in the plan);
   - Seazona's `invoiceNumber`;
   - `total_cents` from `total`;
   - `issued_at`, `due_date`.

   Lines:
   - With detail fetched: real lines (code, description, qty, unit).
   - Without: one summary line, "Seazona invoice — see archive", priced at
     the total.

   PHI: Seazona's `patient` field is sealed into a new encrypted column
   `invoices.legacy_patient` (the doctor needs it to match the bill). Line
   descriptions from Seazona detail are sealed too, because they can carry
   patient names. That means a new nullable encrypted column, used only for
   legacy lines.
3. **Opening balances** (`import:load balances --file <export>`).
   - The export file is parsed in memory and never committed. It is uploaded
     to the import DB as a sealed blob.
   - **Preferred:** a per-invoice open-balance export. Each legacy invoice
     gets a ledger row `source: 'legacy_settlement'` for
     `total − open balance` (a synthetic `transaction_id` of
     `legacy:<seazonaInvoiceId>`). Aging is then exact.
   - **Fallback:** only the per-client statement export exists.
     - Every legacy invoice is fully settled.
     - Each client with a non-zero balance gets one `kind: legacy` "Opening
       balance (carried from Seazona)" invoice for the amount, dated at
       cutover.
     - Aging restarts at cutover. This is a known loss, stated in the parity
       report.
   - Credit balances (negative) become a credit ledger row on the opening
     invoice, or are reported for staff where no invoice can carry them.
4. **Legacy orders.**
   - A new `lab_orders.source` value `legacy` (shared enum + Zod), with
     `source_id` = Seazona order id.
   - Status: shipped/cancelled history maps to terminal statuses. Orders still
     open at cutover map to the board's statuses (mapping table in the plan),
     so the bench keeps working on them in the new system.
   - Lines come from order detail, which is fetched for open orders only.
   - Files: if the probe shows files are downloadable, open orders' files copy
     into the existing Rx files bucket. Otherwise the order page links to the
     Seazona archive while it lasts.
5. **Number seeds.** These are not a load step. The loader **checks** them:
   - It reads Seazona's highest invoice and order numbers from the raw store.
   - It refuses to load into production unless `INVOICE_NUMBER_START` and
     `LAB_ORDER_NUMBER_START` are greater than them.
   - It refuses to run if any live (non-legacy) invoice or order already holds
     a number at or below Seazona's highest.

**Out of the load (not imported):**
- Seazona payment history: the API cannot read it. Balances carry over
  instead.
- Client price lists.
- Product settings and services.

Price inference from billed lines (piece 1's `client_prices.source =
'inferred'`) is a separate optional step after cutover. It only works for
invoices whose detail was fetched.

### Parity report (`import:parity --target …`)

A read-only report, written to stdout and to the import DB, with ids, counts
and cents only, no PHI:
- Clients: Seazona count vs users linked, unlinked, inactive placeholders.
- Invoices: Seazona count vs legacy rows, by year. Sum of totals, both sides.
  Number range.
- Balances: per client, export amount vs derived balance; any difference is
  listed. The total AR must match to the cent.
- Orders: open orders in Seazona vs open legacy lab orders, by status.
- Seeds: highest Seazona numbers vs the configured starts.

The cutover is a **go only when the report is clean**, or every difference is
explained and accepted by the user.

### Rehearsal DB

- **Database.** `diamond_labs_rehearsal`, cloned from the production backup
  on the same instance.
  - It holds real PHI, protected the same way as prod.
  - It is not wired to any service.
  - It is dropped after the cutover.
- **Rehearsal steps:**
  1. Migrate it with the branch's migrations, which proves 0025–0032 apply
     cleanly to real data.
  2. Run the loader.
  3. Run parity.
  4. Optionally point a short-lived, private, local dev server at it for the
     lab walkthrough. Never a public service.
- **Timing.** The production migrate step's runtime is measured here. That
  number sets the freeze window.

### C. Cutover runbook (`docs/cutover-runbook.md`)

The runbook is written and rehearsed in this piece and executed once.

0. **T-1 week.**
   - Rehearsal parity is clean.
   - The lab has walked through the rehearsal.
   - The user has given the go and picked the window.
   - The doctors' notice email is drafted. It is sent by the user, not by
     code.
   - All new env and secrets (carriers, `LAB_*`, seeds, mail) are staged in
     Secret Manager, not yet attached.
1. **Freeze.**
   - The lab stops entering invoices, payments and orders in Seazona.
   - Production's doctor payment pages are paused by a new maintenance flag:
     `PAYMENTS_PAUSED=true` on the current `main` revision. That is a small
     PR to `main` ahead of time, reviewed and signed off on its own; it shows
     "Payments are paused for an upgrade" and refuses charges.
   - AutoPay stays off (it already runs dry).
2. **Backup.**
   - On-demand Cloud SQL backup of the production instance.
   - Record the backup id and the current `main` SHA and image digest.
3. **Final delta fetch** (small, approved count) and **final balance export**
   from the Seazona portal (the lab does the export).
4. **Merge `feat/own-the-lab` → `main`.**
   - Requires the user's explicit sign-off at that moment.
   - Attach the new env and secrets, with seeds set to Seazona's last numbers
     + 1, before the merge, so the new revision boots with them.
   - Cloud Build migrates and then deploys. Watch it to completion.
5. **Load into production:** clients delta, invoices, balances, orders. Then
   **parity** against production.
6. **Smoke**, by the operator and one lab admin:
   - log in;
   - open an invoice;
   - check a known client's balance;
   - release a test Rx case to the board;
   - make a $1 card payment and refund it;
   - run the tracking job dry.
7. **Unfreeze.**
   - Remove `PAYMENTS_PAUSED`.
   - Set up the Cloud Scheduler jobs per the piece 3/4 runbooks
     (`shop-lab-orders-repair` gets its first documented schedule here).
   - Enable the GCP log alerts collected in pieces 3–4.
   - The lab works in the new system. Seazona becomes read-only reference.
8. **Rollback** (any time before unfreeze, or within the first day if
   something is badly wrong):
   - Redeploy the recorded old image.
   - Restore the database from the step-2 backup. A plain git revert is not
     enough: 0030 dropped a column the old code needs.
   - The lab resumes on Seazona.
   - Anything entered in the new system after unfreeze is re-keyed by hand,
     which is why the first day is watched closely.

### Code changes this piece makes (all on the branch)

- `apps/api/src/import/`: fetcher, mappers, writer, parity, CLIs. Each file
  has one job and stays under the size limits.
- Import DB schema and migration: a separate drizzle config and folder,
  never applied to the app DB.
- App schema:
  - `lab_orders.source` gains `legacy`;
  - `invoices.legacy_patient` (encrypted);
  - an encrypted `invoice_lines.legacy_description`;
  - `invoice_payments.source` gains `legacy_settlement`.

  This is one generated migration.
- `PAYMENTS_PAUSED`: shared by the doctor payment routes and pages on this
  branch too, so the flag survives the merge. The tiny `main` PR is its own
  change.
- **UI:**
  - legacy invoices show "Carried over from Seazona" and the patient field;
  - legacy orders show read-only, with a "Seazona history" label;
  - the opening-balance invoice reads clearly on statements.
- **Guard tests:** `seazona-access`, `seazona-order-retired` and
  `seazona-invoice-retired` allow the fetcher (and only the fetcher) to call
  `getInvoices*`, `getOrders`, `getOrder`, `getInvoice` and `listUsers`.
- **Scrub plan:** the new columns are classified (`phi`).
- **Docs:** `docs/cutover-runbook.md`, `docs/import-operations.md`.

## Decisions for the user (raised at plan review, not blocking design)

1. **Window.** The cutover date and freeze length. The rehearsal measures the
   migrate and load times.
2. **Balances.** Whether the lab can produce a per-invoice open-balance export.
   That decides the preferred or fallback balance path.
3. **Fetch scope.** How much detail to fetch. Proposed:
   - summaries for everything (a few calls);
   - detail for open-balance invoices and the last 12 months (estimated in
     the plan once the summary fetch gives exact counts);
   - detail for open orders.

   Each fetch is approved with its count.
4. **Placeholder logins.** For clients with no email: placeholder inactive
   logins, or skip them.
5. **Payments pause.** The `PAYMENTS_PAUSED` PR to `main` before the window.

## Testing

- **Vitest, pure:**
  - every mapper (Seazona fixture → rows, PHI sealed, money in cents, status
    tables);
  - export parsing (HTML table → rows, with malformed and edge rows);
  - balance planning, both paths;
  - seed checks;
  - parity arithmetic.
- **Fetcher:** tests against a fake `seazona.service`. Bounded counts, the
  dry-run makes no detail calls, it stops on 403, resume works from the
  cursor.
- **Writer:** idempotency tests with `fakeTx`. A re-run inserts nothing new.
- **Integration rehearsal:** the real run against `diamond_labs_rehearsal` is
  the acceptance test.

## Out of scope

- Piece 5b clean-up: column drops, Seazona service removal, `seazonaCode`
  rename.
- A practice entity replacing `seazonaClientId` sharing (still a follow-up).
- Price inference from history.
- Importing Seazona payment history (not readable).
- Doctor-facing emails about the switch (the user sends them).
