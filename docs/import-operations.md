# Seazona import operations (own-the-lab piece 5)

How to fetch Seazona into the raw store, rehearse the load, and read parity.
Spec: `docs/superpowers/specs/2026-10-21-migration-and-cutover-design.md`.
The cutover itself is `docs/cutover-runbook.md`.

Everything here is run by the operator with the user. The CLIs (`import:fetch`,
`import:load`, `import:parity`) were built and tested only against fakes: the
first real run is yours, so read every dry run before its `--live`.

## Rules (every step obeys them)

1. Work happens on `feat/own-the-lab-5-cutover` / `feat/own-the-lab`. Nothing touches `main` or the production DB before the cutover; the cutover needs the user's explicit go.
2. Seazona calls go only through `seazona.service.js`, and only `import:fetch` calls it. The documented limit is 60 requests/minute for the whole host IP, shared with the live portal, so the fetcher paces itself at **30/min** (Ruling Q3) and **fetching runs off-hours**. Every fetch is a dry run first. **Any fetch over 100 requests needs the user's OK, given the request count and minutes the dry run prints** (`--live --approved <count>` stands for that OK). No fetch runs from Cloud Run (every CLI refuses there).
3. PHI never lands on a laptop disk: records go straight into `diamond_labs_import`, sealed with production's `PHI_ENCRYPTION_KEY`. The one file that does touch the disk is the lab's balance export (client/account/amount columns, no patient data): download it to an encrypted disk, seal it with `import:fetch export`, then delete the local copy at once and empty the Trash.
4. Every load runs against `diamond_labs_rehearsal` first; production uses the same command with `--target production --confirm-production diamond_labs`.
5. One Seazona stream at a time: never run two `import:fetch` commands at once, and never while anything else (a script, a dev server with Seazona enabled) is calling Seazona. The fetcher enforces its half with a Postgres advisory lock on the import DB (see "Fetch lock" below).

## One-time setup

All on project `diamond-labs-prod`, instance `diamond-labs-db`, as a gcloud account that administers it.

1. **Create the database and its own role** (no access to app tables). The password is 48 hex characters, generated once, stored in Secret Manager, and never echoed or written to a file:

   ```bash
   IMPORTER_PW="$(openssl rand -hex 24)"
   printf %s "$IMPORTER_PW" | gcloud secrets create IMPORT_DATABASE_PASSWORD --project=diamond-labs-prod --data-file=-
   gcloud sql databases create diamond_labs_import --instance=diamond-labs-db --project=diamond-labs-prod
   gcloud sql users create importer --instance=diamond-labs-db --project=diamond-labs-prod --password="$IMPORTER_PW"
   unset IMPORTER_PW
   ```

   Then, as `postgres` through the proxy: `ALTER DATABASE diamond_labs_import OWNER TO importer; REVOKE CONNECT ON DATABASE diamond_labs_import FROM PUBLIC; GRANT CONNECT ON DATABASE diamond_labs_import TO importer; \c diamond_labs_import; ALTER SCHEMA public OWNER TO importer;`. Later sessions read the password back with `gcloud secrets versions access latest --secret=IMPORT_DATABASE_PASSWORD --project=diamond-labs-prod` straight into the URL below (hex needs no URL-encoding).

2. **Open the proxy** (one terminal; the port is a convention):

   ```bash
   cloud-sql-proxy --port 6001 diamond-labs-prod:us-central1:diamond-labs-db
   ```

   One proxy serves every database on the instance; the URLs below differ only by user and database.

3. **In the shell that runs the commands, never in `.env`:**

   ```bash
   export IMPORT_DATABASE_URL="postgresql://importer:$(gcloud secrets versions access latest --secret=IMPORT_DATABASE_PASSWORD --project=diamond-labs-prod)@127.0.0.1:6001/diamond_labs_import"
   # Production's PHI key: the secret the API service's PHI_ENCRYPTION_KEY points at
   gcloud run services describe diamond-labs-api --region=us-central1 --project=diamond-labs-prod \
     --format="yaml(spec.template.spec.containers[0].env)" | grep -A3 PHI_ENCRYPTION_KEY
   export PHI_ENCRYPTION_KEY="$(gcloud secrets versions access latest --secret=<that secret> --project=diamond-labs-prod)"
   ```

   - **The FIRST import run, and every run after it, must have production's `PHI_ENCRYPTION_KEY` exported** (T5). The first run writes a key check into the import DB sealed with whatever key it sees; a developer's key from `apps/api/.env` would seal the whole raw store with a key production cannot read. Every later run must open that check, and loads must also open a sealed value in the target, or they refuse.
   - The `pnpm import:*` scripts start node with `--env-file=.env`, which never overrides a variable already set in the shell, so the exports above win. `apps/api/.env` must not define `IMPORT_`, `REHEARSAL_` or `PRODUCTION_DATABASE_URL`; check with `grep -E 'IMPORT_|REHEARSAL_|PRODUCTION_DATABASE' apps/api/.env`. `DATABASE_URL` is never a target.
   - **The import DB must be the Cloud SQL one, never a local Postgres.** The CLIs check the database NAME, not the server: a local database called `diamond_labs_import` would pass, and the first run would write real PHI to the laptop. Before the first run, and whenever the proxy was restarted, confirm port 6001 is the proxy: `lsof -nP -iTCP:6001 -sTCP:LISTEN` must show `cloud-sql-proxy` and nothing else (a local `postgres` there means stop).
   - **Seazona credentials (live fetches only).** `import:fetch` reads `SEAZONA_API_KEY`, `SEAZONA_SECRET` and `SEAZONA_BASE_URL` from the shell (or `apps/api/.env`). Take all three from the secrets the production API service references (the same `describe` listing as the PHI key above), never from a teammate's `.env`:

     ```bash
     export SEAZONA_API_KEY="$(gcloud secrets versions access latest --secret=<the API's SEAZONA_API_KEY secret> --project=diamond-labs-prod)"
     export SEAZONA_SECRET="$(gcloud secrets versions access latest --secret=<the API's SEAZONA_SECRET secret> --project=diamond-labs-prod)"
     export SEAZONA_BASE_URL="$(gcloud secrets versions access latest --secret=<the API's SEAZONA_BASE_URL secret> --project=diamond-labs-prod)"   # must end in a slash
     export SEAZONA_DISABLED=false
     grep -E '^SEAZONA_DISABLED' apps/api/.env   # a dev .env often has SEAZONA_DISABLED=true; the shell export above wins
     ```

     (If `SEAZONA_BASE_URL` is a plain env value on the service rather than a secret, copy it from the listing.) With `SEAZONA_DISABLED=true` every live fetch stops at its first request as "unavailable" (status 0) and stores nothing. A dry run needs none of these.

4. **Migrate the import DB:** `pnpm --filter @my-app/api import:db:migrate` (reads `IMPORT_DATABASE_URL`).

## Fetch

Summaries are a handful of list calls; details are one call per record. Every summary fetch is full and re-runnable (there is no high-water-mark delta; orders have no `lastModified`).

| Command | Requests | Notes |
|---|---|---|
| `import:fetch clients` | 1 | |
| `import:fetch users` | 1 | lab staff (archive only) |
| `import:fetch products` | 1 | archive only; the catalog is local since piece 1 |
| `import:fetch invoices` | about 2 | about 16k invoices, past the 10k cap, so the walk takes more than one page (see "Capped lists" below) |
| `import:fetch orders` | 1 or more | one per 10k orders |

All commands are `pnpm --filter @my-app/api import:fetch <entity> ...`.

1. Run each without `--live`: it prints `Plan: N Seazona request(s), about M min at 30/min.` and calls nothing. Tell the user the total (about 6 requests) before the first live run, even though it is under 100.
2. Run each with `--live`. Off-hours. The invoices summary needs `--accept-capped-timestamp 2025-11-29T15:05:50Z` (step 7: the known bulk stamp).
3. **Detail**, dry run first. The usual scope (user decision 3):
   - **Invoices with an open balance:** seal the lab's per-invoice export first (`import:fetch export --balances per-invoice --file <export.xls>` prints its id and any row problems; no Seazona call; delete the local file), then `import:fetch invoices --detail --open-balance --file-id <id>`.
   - **Invoices of the last 12 months:** `import:fetch invoices --detail --since <YYYY-MM-DD>`.
   - **Open orders:** `import:fetch orders --detail --open`.
   - Single records: `--ids <id,id>`. If the export's headers are not the defaults, `--columns name="Header",...` (same flag on `export`, `load balances`, `parity`).
   Each prints `Plan: N Seazona request(s), about M min at 30/min.` Give the user N and M (N at 30/min is about N/30 minutes). With the OK: re-run with `--live --approved N` (needed over 100; harmless under).
4. **Cutover refresh of open orders:** an order carries no `lastModified`, so a stored order is never re-read by default. At cutover re-fetch open-order detail with `import:fetch orders --detail --open --refetch --live` (Ruling Q8). Invoices refresh by `lastModified` on their own; `--refetch` forces them too.
5. **Exit codes (fetch):** 0 done (or a dry run), 3 the run stopped before finishing (resume or re-run, below), 2 refused (nothing happened), 1 failed.
6. **If a run prints "BLOCKED" (403):** stop everything that talks to Seazona. Do not retry. Tell the user at once (production's portal is blocked too). Check `GET /api/v1/health/seazona` (authenticated) every hour or so; when it answers 200, resume with `import:fetch <entity> --detail --resume <runId> --live --approved <remaining>`. Other stops (429 after the service's retry, network, `SEAZONA_DISABLED`, 5xx) also stop at once and keep the cursor; the run prints the cause or says it cannot tell. A list walk that could not complete, or a list with id-less records, stores NOTHING and needs operator attention: do not load from it.
7. **Capped lists that share one timestamp (F3, F3b).** Seazona truncates the invoice and order lists at 10,000 rows sorted by id; the walker re-requests from the page's newest `lastModified` / `ordered`. A FULL page whose rows all share one value cannot be paged past without dropping rows (more with that value may lie past the cap), so by default the walk stops as incomplete ("The list walk did not complete"), stores nothing and needs the user.
   - **The known case: Seazona's whole historical invoice archive was bulk-restamped to `lastModified = 2025-11-29T15:05:50`.** An earlier live probe saw the first page (from 1900) come back as a full 10,000 rows all with that stamp, and the next page from `15:05:51` held about 5,790 later rows. So the plain invoices summary fetch always stops. Run it as:

     ```bash
     pnpm --filter @my-app/api import:fetch invoices --accept-capped-timestamp 2025-11-29T15:05:50Z --live
     ```

     The value must be that exact instant (a value without a zone is read as UTC; a day or anything else is refused). Only a full page sharing exactly that stamp is paged past, by one second; any other shared stamp still stops the walk. The flag is for the invoices summary only (orders and detail fetches refuse it).
   - The run is then `done` but **possibly incomplete**: rows past the cap that carry the same stamp were never returned. Its run row's `note` starts `possiblyIncomplete:` with the stamp and page size, and the CLI prints `POSSIBLY INCOMPLETE: …`.
   - **The gap report decides whether anything is missing.** Parity always reports `invoices.seazonaNumberGaps` (holes in Seazona's sequential invoice numbers) as information. When the newest invoices summary run is possibly incomplete and there is any gap, parity raises the difference `seazona_invoice_numbers_missing`, with the count and the first 50 numbers (`invoices.seazonaNumbersMissing`). Give the numbers to the user: the lab can confirm them as deleted or voided-and-removed in Seazona (then `--accept seazona_invoice_numbers_missing` with the user's say-so), or they are real missing history and the user decides what to do. Do not work around the cap by hand.
8. **Resuming:** the cursor is saved every 25 records, so `--detail --resume <runId>` re-fetches at most the last 24. A run's own id list is replayed, so no filter flags are allowed with `--resume`.
9. **Fetch lock (T9).** A live fetch holds a session-level Postgres advisory lock on the import DB for its whole life. A second live fetch, `--mark-stale`, and resuming a run still marked `running` all need that lock free. If a run died (crash, Ctrl-C, laptop slept) it stays marked `running`: start `--mark-stale <runId>` (works only when no live fetch holds the lock), or `--resume`. **Half-open connections:** if the laptop lost its network or slept, the lock's TCP connection can look alive to Postgres for a while, because a dead peer is only noticed through TCP keepalive. Until Postgres drops the dead session the lock stays held, and `--mark-stale`/`--resume` refuse with "another live fetch holds the fetch lock". Wait a few minutes and retry; do not kill anything unless you have checked that no fetch process is still alive on any machine. A fetch process also stops itself before its next request if it notices its own lock connection closed.
10. **Order files probe (once, needs the user's OK, 1 request):** whether an order's files can be downloaded is still unknown. Pick one open order id from the dry run and run `import:fetch orders --detail --ids <id> --live`; then look (in memory, via a one-off `node -e` that reads the record through `raw-store.js` `readRecords`; never print it) at the `files` entries' fields. Record the field names only. If a download URL exists, copying files is a follow-up task; otherwise the order page keeps saying its files stay in Seazona.

## Rehearse

1. **Clone production into `diamond_labs_rehearsal`** (the staging recipe; PHI stays inside GCP):

   ```bash
   gcloud storage buckets create gs://diamond-labs-rehearsal-seed --project=diamond-labs-prod --location=us-central1 --uniform-bucket-level-access
   gcloud storage buckets update gs://diamond-labs-rehearsal-seed --lifecycle-file=<(echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}')
   # grant the instance's service account write on the bucket (gcloud sql instances describe ... --format='value(serviceAccountEmailAddress)')
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

3. **Load, in order, dry run then `--live`.** Every step is re-runnable. The seed flags are optional on rehearsal (when absent nothing is checked; a start at or below Seazona's highest number gives a warning) and required on production for `invoices`, `balances` (both paths) and `orders`; `clients` takes neither.

   ```bash
   pnpm --filter @my-app/api import:load clients  --target rehearsal [--no-email placeholder|skip] [--live]
   pnpm --filter @my-app/api import:load invoices --target rehearsal --invoice-start <seazona max + 1> --order-start <seazona max + 1> [--live]
   pnpm --filter @my-app/api import:load balances --target rehearsal --balances per-invoice --file-id <id> [--invoice-start ... --order-start ...] [--live]
   pnpm --filter @my-app/api import:load orders   --target rehearsal --invoice-start <n> --order-start <n> [--live]
   ```

   - The invoices dry run prints `seeds.seazonaMax`: those + 1 are the seed values for the cutover (`INVOICE_NUMBER_START`, `LAB_ORDER_NUMBER_START`).
   - **Who owns an imported invoice or order (F1, R11b/R11c).** The user carrying the client's Seazona link owns its records when that user is an approved, non-deleted doctor. Email verification and password state do not matter (doctors the old importer created were never verified, and a password reset does not verify them): links only come from the importer, an admin, or the verified pending-link flow. Linking by email is still gated: the clients step links an existing user by email only when that user is an approved, verified doctor; any other match is reported (`email_matches_unverified_or_non_doctor_user`) and never linked. A Seazona client with more than one eligible owner gets none (`client_has_multiple_owners`), and a client whose only linked user is not an approved doctor is `client_owner_not_approved_doctor`. **In both cases the invoices and the orders load unowned** (F2: both steps behave the same; nothing is skipped) and are reported (`loaded_invoices_still_unowned_client`, `loaded_orders_still_unowned_client`); `balances` settles them like any other; accounts-receivable hides unowned invoices, and parity lists them with their open balance. A client with no linked user at all is `client_not_loaded`: its invoices are not loaded (run `clients` first) and its orders load unowned. **The fix path is: correct the link (an admin links or approves the doctor), then re-run the step.** Every `invoices` run reattaches already-loaded unowned legacy invoices whose client now resolves to exactly one owner, and `orders` does the same for orders. Credit and Void on an unowned legacy invoice are refused (and hidden) until an owner is linked.
   - **`invoices` after `balances` (F2).** Once the target has settlement rows or opening-balance invoices, an `invoices` run that would INSERT invoices reports `invoices_inserted_after_balances` and a live run refuses: those invoices would load unsettled, their full totals owed. If inserting them is right (newly fetched history, or a `client_not_loaded` client fixed), re-run with `--allow-after-balances`, then **re-run `balances` with the same `--balances` and `--file-id` before parity** (idempotent: it only settles what is new). The report and the CLI print this as `NEXT:`. A re-run that only reattaches inserts nothing and never refuses.
   - An `unknown_status` problem in the orders dry run means a Seazona state isn't in `import/seazona-records.js` yet: add it (one line plus its test), and re-run. Time each live step.
   - **Account keys must contain a digit** (T8). The export parser takes a row's key (invoice number or account number) only if it is 1 to 32 letters, digits or dashes and contains a digit, so a "Total" row is not an account. An account number that is all letters is read as a keyless row, which is a `export-row-no-key` problem (below).
   - **The `clients` step reads its plan before it writes** (T10), so on production it must run inside the write freeze (the cutover runbook does). On rehearsal it can run any time but re-run it if the data moved.
   - **The load lock.** Every LIVE step (`clients`, `invoices`, `balances`, `orders`) holds the target's load lock for its whole run, taken on the target database; a second live load on the same target refuses, and so does `import:parity`, which takes the same lock so it never reads a half-written target. A dead run frees it when Postgres drops the session (see the half-open note above).
   - **Exit codes (load):** 0 ok or dry run, 2 refused, 1 failed.

4. **Balances.** Per-invoice (`--balances per-invoice`, the Invoices & Payments report) or per-client (`--balances per-client`); `--file <export.xls>` seals the export on first use and prints its id, afterwards `--file-id <id>` (never both). `--cutover-at <ISO>` is the freeze start (defaults to now).
   - **Export problems.** The parser reports row numbers and keys only: `export-row-no-key`, `export-row-bad-balance`, `export-row-duplicate-key`, `export-total-mismatch`. They are always printed. **A live `balances` run refuses while the export has problems** unless you pass `--accept-export-problems`.
   - **The footer "Total" row (F4).** The portal ends every export with a keyless "Total" / "Totals" / "Grand Total" row. When it is the last non-empty row it is read as the export's own total (`exportTotalCents`, printed by `import:fetch export` and in the balances report), not as a problem, and the parsed rows must add up to it to the cent; if they do not, that is `export-total-mismatch` (some balance was not read: find the row). A keyless row anywhere else is still `export-row-no-key`.
   - **What `--accept-export-problems` does and does not do (T12).** Rows with an unreadable (`export-row-bad-balance`) or duplicated (`export-row-duplicate-key`) balance are left open: nothing is settled for those invoices (per-invoice) or those accounts' history (per-client), and they are reported as `invoice_left_open_export_problem` / `account_left_open_export_problem`. **A keyless row cannot be matched to any invoice or account, so whatever it owed is settled as PAID** unless you fix the file; the refusal text and the report's `warnings` say so. Fix the export (the lab re-saves it) rather than accepting keyless rows. Credits (negative balances) are not written at all: they are reported as `credit_balance_for_staff` and staff apply them with the invoice Credit action after cutover.
   - **A corrected export after a live balances run needs a re-clone** (T12). Settlements are idempotent by transaction id, so a re-run with a changed export never adjusts rows already written. On rehearsal, drop and re-clone `diamond_labs_rehearsal` and reload from the start. On production this is the rollback path, not a re-run, so get the final export right before the live production `balances` run (the dry run's `exportProblems` and `reconciliation` must be understood first).
   - **Problems that mean a data gap, not a bug:** `export_row_without_invoice` / `export_account_without_client`: the export names something the load doesn't have (a client skipped for no email under `--no-email skip`, an invoice whose summary wasn't fetched, an account no loaded user carries). Fix the cause and re-run; never edit the export. `invoice_number_taken`, `order_number_taken` and seed errors are number collisions: stop and tell the user.

5. **Parity:** `pnpm --filter @my-app/api import:parity --target rehearsal --balances per-invoice --file-id <id> --invoice-start <n> --order-start <n> [--accept <kind>[,<kind>...]]`. It is read-only on the target (the connection refuses writes) and saves every report to the import DB's `parity_reports`.
   - **Exit codes:** 0 = clean, or every remaining difference was accepted; 4 = unaccepted differences (they are listed under `differences`); 2 refused; 1 failed.
   - **Accepting differences (R14a).** Each difference must be fixed or explained to the user. To record the user's acceptance, re-run with `--accept <kind>,<kind>`; kinds are the strings in `differences`: `clients`, `invoice counts`, `invoice totals`, `invoices not loaded`, `unowned invoices with a balance`, `balances`, `no balance export compared`, `balance export problems`, `open orders`, `orders not loaded`, `unowned open orders`, `seeds`, `seazona_invoice_numbers_missing`. Accepted kinds move to `accepted` in the printed and the saved report, and the report also records `acceptRequested`, the kinds you asked for; each requested kind that was not in the report is printed ("Requested to accept but not present"), which is how a typo or a stale accept shows. An unknown kind is refused before anything opens.
   - **`clean: true` in `parity_reports` also means "every difference was accepted".** The saved row does not say which. **Always check `report.accepted`** (and write it into the cutover record) before treating a clean exit as "nothing differed".
   - Parity reports counts, ids and cents only; it also lists unowned legacy invoices and orders (by client id), the export's problems, and Seazona's invoice-number gaps (`invoices.seazonaNumberGaps`: information only, unless the invoice summary was fetched with `--accept-capped-timestamp`, when any gap is the difference `seazona_invoice_numbers_missing`).

6. **Lab walkthrough (optional):** a local, private dev server pointed at the rehearsal, never a public service:

   ```bash
   DATABASE_URL="$REHEARSAL_DATABASE_URL" SEAZONA_DISABLED=true AUTHORIZE_NET_ENV=sandbox PAYMENTS_PAUSED=true \
     MAILGUN_API_KEY= CARRIER_ENV=sandbox pnpm --filter @my-app/api dev
   pnpm --filter @my-app/web dev   # localhost only
   ```

   No mail leaves (no Mailgun key), no card is charged (sandbox, payments paused), no Seazona call is possible.

## Remakes of Seazona orders (R13a)

A legacy (Seazona) order cannot be remade in this system: the button is hidden and the server refuses. Staff start a new Rx case for the job instead. Tell the lab before cutover that old cases needing a remake are re-keyed as new cases.

## Other loader notes

- Imported doctors have `passwordHash=null` and log in after a password reset. A client with no email gets a suspended placeholder on `@seazona-clients.invalid`, which `email.service` never mails.
- Open legacy orders are worked on the board but never billed again (their Seazona invoice already carries the balance), and may be labelled and shipped alone only.
- Seazona-era `invoice_payments` rows stay unlinked from legacy invoices (they are already inside Seazona's open balances).
- No PHI in anything you paste: the CLIs print ids, numbers, counts and cents, and a database error prints its code only.

## Staging full-data preview (2026-10-26, user decision)

The user chose to load the full Seazona data into staging, so the app can be tried with real accounts while still in development. Payments on staging are Authorize.net sandbox, and `PAYMENTS_PAUSED=true` turns off every purchase. Mail is redirected to `STAGING_EMAIL_TO` and Seazona is disabled. Imported doctors have no password and cannot log in. Staging then holds real patient names, sealed with `STAGING_PHI_ENCRYPTION_KEY`.

- **Use the staging key for everything:** export `PHI_ENCRYPTION_KEY` from secret `STAGING_PHI_ENCRYPTION_KEY` for the fetch AND the loads. The import DB's key check is then sealed with the staging key.
  - A production load from this raw store refuses, because the key does not open production's data.
  - **Before the real cutover, drop and recreate `diamond_labs_import` and fetch again with production's key** (this is also the fresh pull).
- **The target is `--target staging`, through `STAGING_TARGET_DATABASE_URL`** (`staging_app` through the proxy, database `diamond_labs_staging`). `STAGING_DATABASE_URL` is the service's socket secret and is never used.
  - The scrubbed copy holds nothing sealed until its first load, so the target key check lets an empty staging through. A sealed value the key cannot open still refuses.
- **Re-seeding staging from production wipes the import:** re-run the loads afterwards.
