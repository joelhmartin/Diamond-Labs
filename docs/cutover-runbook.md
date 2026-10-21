# Cutover runbook (own-the-lab piece 5)

Executed once, by the operator with the user, inside the agreed window. Every
time below is the lab's local time (America/Chicago). Read
`docs/import-operations.md` first: its setup, rules and commands apply here
(the shell exports, the production PHI key, the load lock, exit codes).

**Nothing here starts without the user's explicit go. Step 4 (the merge to
`main`) needs a second, separate sign-off at that moment.**

Every `import:*` command below is `pnpm --filter @my-app/api import:<x> ...`.
Dry-run each step, read it, then re-run with `--live`.

**Both stacked PRs of this piece (A and B) must be merged into
`feat/own-the-lab` before any rehearsal load or lab walkthrough.** With A alone,
staging and the rehearsal lack B's read side: settlement rows are not yet kept
out of payment history and refunds, and the legacy order page and its Remake
rule are incomplete.

## Freeze timeline (fill in as you go; every later step reads these)

| # | Moment | Set in | Time (CT) |
|---|---|---|---|
| T1 | Lab stopped keying shop orders (and everything else) into Seazona = `LAB_SHOP_REPAIR_SINCE` | 1.1 | ___ |
| T2 | `PAYMENTS_PAUSED=true` serving | 1.3–1.4 | ___ |
| T3 | Earliest start of step 3 = T2 + 35 min | 1.4 | ___ |
| T4 | Final balance export downloaded | 3.4 | ___ |
| T5 | Pre-cutover backup taken (`BACKUP_ID`) | 4.3 | ___ |

Order is binding: T1 ≤ T2 < T3 ≤ T4 < T5.

## T-1 week (all must be true)

- [ ] Rehearsal parity is clean, or every difference was accepted with `--accept` and the user agreed in writing (record `report.accepted`).
- [ ] The lab has walked through the rehearsal.
- [ ] The user has given the go and picked the window. Freeze length = rehearsal migrate time + load time + 2 h margin (fill in: migrate ___ min, load ___ min).
- [ ] The doctors' notice email is drafted; the user sends it (code never does).
- [ ] **The `PAYMENTS_PAUSED` PR is merged to `main`, deployed, and production still takes payments with the flag unset.** Merge SHA: ___ (instructions below).
- [ ] New env and secrets are staged in Secret Manager (not attached yet): carriers and `LAB_*` (`docs/shipping-operations.md`), mail settings, and the seeds (computed in step 3).
- [ ] Cloud Run env to drop at the merge: `RX_LIVE_PUSH`, `SEAZONA_ORDER_USER_ID` (piece 2 carry-over); their current values are recorded in step 2 so a rollback can put them back. `LAB_SHOP_REPAIR_SINCE` is **not** a deploy date: it is the exact timestamp T1 at which the lab stopped keying shop orders into Seazona (step 1.1), set at the merge (step 4.1).
- [ ] A fresh fetch dry run from off-hours is understood: the final delta (step 3) is small and was timed at 30 requests/minute.

### The `PAYMENTS_PAUSED` PR to `main` (T-1 week; needs the user's sign-off)

The current production revision is built from `main`, which has no such flag, so the flag must reach `main` first. The exact diff is in `docs/superpowers/plans/2026-10-21-migration-and-cutover.md`, Task 4 (generated against `origin/main` 6d6c87c; re-check it still applies). Use a NEW worktree, never the main checkout, and a real `pnpm install` there (a symlinked `node_modules` gave 11 false failures):

```bash
git fetch origin
git worktree add ../main-payments-paused -b chore/payments-paused origin/main
cd ../main-payments-paused
git checkout feat/own-the-lab-5-cutover -- apps/api/src/middleware/payments-paused.js apps/api/src/middleware/payments-paused.test.js apps/api/src/routes/__tests__/payments-paused-wiring.test.js
# save Task 4's ```diff block to a file, then apply it to the index:
awk 'f&&/^```$/{exit} f{print} /^```diff$/{f=1}' ../own-the-lab-3/docs/superpowers/plans/2026-10-21-migration-and-cutover.md > /tmp/payments-paused.diff
git apply --check /tmp/payments-paused.diff && git apply --index /tmp/payments-paused.diff
pnpm install && pnpm test
git diff --cached --name-only | wc -l   # expect 8 (5 changed + 3 new)
```

(Adjust the path to the plan file to wherever the `own-the-lab-3` worktree lives. `git apply --index` is what stages the five modified files; the three new files are already staged by the `git checkout <branch> -- <paths>` line.) Commit, push `chore/payments-paused`, and open the PR only on the user's instruction, with the user's sign-off before the merge. In the PR body say:

- It adds a **new route**, `GET /api/v1/payments/status` (authenticated; `{ data: { paused } }`), which the doctor banner and the wiring test read.
- **A malformed `PAYMENTS_PAUSED` fails the deploy.** Only unset, `true` or `false` (any case) are accepted; anything else fails env validation at boot, so a new Cloud Run revision never becomes ready and the old one keeps serving. An empty string is malformed: **to turn it off, unset it (`--remove-env-vars`), never blank it.**
- The flag refuses what starts a card payment or writes the ledger by hand (doctor `charge-saved` and `hosted-token`, admin `charge-saved`, refunds, staff credits, manual payments). It does not refuse `/payments/hosted-complete` (the card is already captured) and does not pause guest shop checkout.

After it deploys, verify on production that the flag is understood but off: `GET /api/v1/payments/status` (with a logged-in session) returns `paused: false`, and a normal payment still works.

## 1. Freeze

1. The lab stops entering invoices, payments and orders in Seazona. **First confirm with the lab that every guest shop order paid before now has been keyed into Seazona** (those become legacy orders); then record this exact moment, to the second, as T1 (ISO with offset, e.g. `2026-11-07T18:00:00-06:00`). T1 is `LAB_SHOP_REPAIR_SINCE`: the repair sweep after unfreeze creates lab orders for paid shop orders from T1 on, which the lab no longer keys. A later value loses the freeze's shop orders (paid, in neither system); an earlier one (e.g. a bare date) makes the lab build already-keyed orders twice.
2. **AutoPay must not charge during the freeze:** confirm `AUTOPAY_LIVE_RUN` is `false` or unset on the service AND on the `diamond-labs-jobs` Job (if it exists yet). The AutoPay sweep and `/admin/jobs/:name/run` can still charge cards if it is `true`, and `PAYMENTS_PAUSED` does not stop them.

   ```bash
   gcloud run services describe diamond-labs-api --region=us-central1 --project=diamond-labs-prod --format="value(spec.template.spec.containers[0].env)" | tr ';' '\n' | grep -i AUTOPAY_LIVE_RUN
   gcloud run jobs describe diamond-labs-jobs --region=us-central1 --project=diamond-labs-prod --format="value(spec.template.spec.template.spec.containers[0].env)" | tr ';' '\n' | grep -i AUTOPAY_LIVE_RUN
   ```

   If either is `true`, set it to `false` now and note it here to restore after the freeze (only on the user's say-so): ___
3. Pause payments on the current production revision, **at least 35 minutes before step 4's migrate** (a hosted-payment binding lives 30 minutes, so none can still be completing when migration 0030 drops `applied_amount`):

   ```bash
   gcloud run services update diamond-labs-api --region=us-central1 --project=diamond-labs-prod --update-env-vars=PAYMENTS_PAUSED=true
   ```

   Time set: ___ (T2; T3 = T2 + 35 min gates step 3 and step 4).
4. **Verify it took.** The new revision must be serving (a malformed value would leave the old one). `GET /api/v1/payments/status` returns `paused: true`, and a doctor pressing Pay sees "Payments are paused for an upgrade." Record T2 as the time the paused revision was serving, and T3 = T2 + 35 min.

## 2. Record the rollback points

The Cloud SQL backup is taken later (step 4), as the last action before the merge, so it contains everything the freeze produced. Record the code points now:

```bash
git fetch origin
git rev-parse origin/main                                                                   # record MAIN_SHA
gcloud run services describe diamond-labs-api --region=us-central1 --project=diamond-labs-prod \
  --format="value(spec.template.spec.containers[0].image)"                                  # record IMAGE (digest)
gcloud run jobs describe diamond-labs-jobs --region=us-central1 --project=diamond-labs-prod \
  --format="value(spec.template.spec.template.spec.containers[0].image)"                    # record JOB_IMAGE (skip if the Job does not exist yet)
```

```bash
gcloud run jobs describe diamond-labs-migrate --region=us-central1 --project=diamond-labs-prod \
  --format="value(spec.template.spec.template.spec.containers[0].image)"                    # record MIGRATE_IMAGE (the deploy's migrate step moves it too)
# The env step 4.1 changes. Names, plain values of the two Rx settings, and secret REFERENCES only; never print a secret's value.
for target in "services describe diamond-labs-api" "jobs describe diamond-labs-jobs"; do
  gcloud run $target --region=us-central1 --project=diamond-labs-prod --format=json \
    | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const t=d.spec.template.spec;const c=(t.template?.spec??t).containers[0];for(const e of c.env??[])console.log(e.name, e.valueFrom?.secretKeyRef?`secret:${e.valueFrom.secretKeyRef.name}:${e.valueFrom.secretKeyRef.key}`:(["RX_LIVE_PUSH","SEAZONA_ORDER_USER_ID","AUTOPAY_LIVE_RUN","PAYMENTS_PAUSED"].includes(e.name)?e.value:"(plain value, not printed)"))'
done
```

main SHA ___ · service image ___ · jobs image ___ · migrate job image ___ (a deploy's `migrate` and `update-jobs` steps move both Jobs to the new image, so they are rolled back too)

Env record (service / Job): `RX_LIVE_PUSH` = ___ / ___ · `SEAZONA_ORDER_USER_ID` = ___ / ___ · full list of env names and secret references (keep it with the cutover record; it holds no secret values): ___

## 3. Final delta fetch and final balance export

Off-hours does not apply inside the window, but the fetcher still paces itself at 30/min under the live portal's shared quota; keep the counts small.

**Gate: do not start step 3 before T3 (pause time + 35 min).** The old revision keeps accepting `/payments/hosted-complete` for up to 30 minutes after the pause (the card is already captured), and each completion records a Seazona account payment. An export or fetch taken before those land still shows the balance, and the new system would bill it again. Now: ___ ≥ T3.

**Pre-check before the export (ids and amounts only, no PHI in chat):** list every portal payment since the last export the lab reconciled, and every logged payment the portal captured but could not write to Seazona, then have the lab reconcile each one in Seazona **before** step 3.4:

```bash
# Portal payments since the last reconciled export (production DB, read-only, through the proxy):
#   select id, invoice_number, applied_amount, transaction_id, seazona_payment_id, created_at from invoice_payments
#     where created_at >= '<last export time>' order by created_at;
# (main's columns, before migration 0030; a row with seazona_payment_id null was never written to Seazona)
gcloud logging read 'resource.labels.service_name="diamond-labs-api" AND (textPayload:"PAYMENT_WRITE_FAILED" OR textPayload:"CAPTURED_NOT_RECORDED")' \
  --project=diamond-labs-prod --freshness=400d --format="value(timestamp,textPayload)" | cut -c1-300
```

Every `[Seazona][PAYMENT_WRITE_FAILED]` (paid by card, never written to Seazona) and `[PAYMENT][CAPTURED_NOT_RECORDED]` line is money Seazona's export still shows as owed: the lab records it in Seazona (or confirms it already did) before exporting. Reconciled: ___

1. Summaries (about 6 requests): `import:fetch clients|invoices|orders --live`.
2. Details for what changed (dry run first; the count is small; with the user's OK `--live --approved N`):
   - `import:fetch invoices --detail --since <last rehearsal fetch date>`
   - `import:fetch orders --detail --open --refetch` (**`--refetch` is required**: an order has no `lastModified`, so without it a stored open order is never re-read and its status would be stale).
3. (The pre-check above is done and reconciled.)
4. The lab produces the final balance export from the Seazona portal (record T4). Download to an encrypted disk, seal it at once, delete the local file and empty the Trash: `import:fetch export --balances <per-invoice|per-client, as chosen at T-1> --file <export.xls>` (prints the file id and any row problems; no Seazona call). **Fix problems with the lab and re-export now:** a corrected export after a live balances run means a restore, not a re-run.
   The portal export ends with a "Total" row: the parser reads it as the export's footer total and checks the rows add up to it (`export-total-mismatch` if not); it is not a problem by itself. Any other row problem is.
5. **Seeds (a hard prerequisite of step 4; do not merge without them).** After step 3.1's summary fetch, derive Seazona's highest invoice and order numbers with a **rehearsal** dry run: `import:load invoices --target rehearsal` (no `--live`), and read `seeds.seazonaMax` (invoice and order). The raw store is shared, so the numbers are the same for production. Do NOT use a production dry run for this: production's pre-merge schema has no `invoices` / `lab_orders` tables, so it fails. `INVOICE_NUMBER_START` = invoice max + 1, `LAB_ORDER_NUMBER_START` = order max + 1. Record: ___ / ___ . (The rehearsal must still be migrated and loadable; if it was dropped, re-clone it first.)

## 4. Merge `feat/own-the-lab` to `main` (user's explicit sign-off now)

1. Stage the env and secrets, with the seeds, **before** the merge so the new revision boots with them: on the service (`gcloud run services update ... --update-env-vars INVOICE_NUMBER_START=...,LAB_ORDER_NUMBER_START=...,LAB_SHOP_REPAIR_SINCE=<T1> --update-secrets ...`; remove `RX_LIVE_PUSH`, `SEAZONA_ORDER_USER_ID`, whose values step 2 recorded) **and on the `diamond-labs-jobs` Job if it exists** (`gcloud run jobs update diamond-labs-jobs ...` with the same seeds and the carrier / `LAB_*` / mail settings from `docs/shipping-operations.md`): the Job runs the same code, and its tracking and repair runs allocate invoice and order numbers, so without the seeds it would number from the defaults. Keep `PAYMENTS_PAUSED=true`.
2. **Gate: it is now at least T3** (pause time + 35 minutes; step 3 already waited for it). Now: ___ . If not, wait.
3. **Take the backup now, as the last action before the merge** (after the final fetch, the export and the env staging):

   ```bash
   gcloud sql backups create --instance=diamond-labs-db --project=diamond-labs-prod --description="pre-cutover"
   gcloud sql backups list --instance=diamond-labs-db --project=diamond-labs-prod --filter="description='pre-cutover'" --sort-by=~windowStartTime --limit=1   # record BACKUP_ID
   ```

   Backup id ___ · taken at ___
4. Open the PR `feat/own-the-lab` to `main` (hundreds of files: over CodeRabbit's cap; every piece was reviewed as its own PR, so say so in the body). If it conflicts on `middleware/payments-paused.js`, its test or `payments-paused-wiring.test.js`, the two sides are identical; on `env.js` / route files keep `feat/own-the-lab`'s side (it already has the flag).
5. The user merges. Cloud Build (`deploy-api-on-main`) runs migrate (0025 to 0033, one transaction) then deploy. Watch it to completion: `gcloud builds list --project=diamond-labs-prod --limit=1` then `gcloud builds log <id> --project=diamond-labs-prod --stream`.
   - **If migrate succeeded but deploy failed, go straight to rollback (step 8).** The old revision is then serving a migrated database (0030 dropped `applied_amount`), so invoice and payment pages error. Do not retry the build in place.

## 5. Load into production, then parity

The `clients` step reads its plan before it writes, so it runs here, inside the write freeze. Only `invoices`, `balances` and `orders` take the seeds; `clients` and `parity`'s target flags are separate.

```bash
export PRODUCTION_DATABASE_URL="postgresql://<admin user>:$(gcloud secrets versions access latest --secret=<the secret holding the admin password> --project=diamond-labs-prod)@127.0.0.1:6001/diamond_labs"
T="--target production --confirm-production diamond_labs"
S="--invoice-start <INVOICE_NUMBER_START> --order-start <LAB_ORDER_NUMBER_START>"
pnpm --filter @my-app/api import:load clients  $T [--no-email placeholder|skip]            # dry run, read it, then add --live
pnpm --filter @my-app/api import:load invoices $T $S                                       # dry run, then --live
pnpm --filter @my-app/api import:load balances $T $S --balances <path> --file-id <final export id> --cutover-at <ISO of step 1> # dry run, then --live
pnpm --filter @my-app/api import:load orders   $T $S                                       # dry run, then --live
pnpm --filter @my-app/api import:parity $T $S --balances <path> --file-id <final export id>
```

- Before the live `balances` run, read the dry run's `exportProblems`, `exportTotalCents`, `warnings` and `reconciliation`. The footer "Total" row is not a problem (it is `exportTotalCents`, cross-checked against the rows). A live run refuses on export problems; `--accept-export-problems` leaves unreadable/duplicate rows open but **settles keyless rows as paid**, and a corrected export afterwards needs a restore. Prefer a fixed export.
- Every live step holds the target's load lock; parity takes it too. Do not run two loads at once.
- Unowned invoices or orders in the reports (`client_owner_not_approved_doctor`, `client_has_multiple_owners`, `loaded_invoices_still_unowned_client`, ...): both steps load them **unowned** (nothing is skipped for an owner problem). Link the owner (an admin approves/links the doctor), then **re-run the step** (`invoices`, `orders`), which reattaches them and inserts nothing. Parity lists what is still unowned and its open balance.
- **An `invoices` run after `balances` that would insert invoices refuses** (they would load unsettled, their full totals owed). That happens only when new invoices reached the raw store or a `client_not_loaded` client was fixed. If inserting them is right, re-run with `--allow-after-balances`, then **re-run `balances` with the same `--balances` and `--file-id`** (idempotent; it settles only the new ones) **before parity**. The run prints this as `NEXT:`.
- **Parity must exit 0**: clean, or every remaining difference accepted by the user (`--accept <kind>,<kind>`). Record the saved report id and `report.accepted` here: report id ___ · accepted ___ . Check `report.accepted`, not only the exit code. Otherwise: rollback (step 8).

## 6. Smoke (operator + one lab admin)

- Log in as a lab admin and as a test doctor.
- Open a legacy invoice: "Carried over from Seazona", the patient, the right balance. Credit and Void are hidden on any unowned legacy invoice.
- Check a known client's balance against the final export.
- Release a test Rx case to the board; it gets a number from `LAB_ORDER_NUMBER_START`.
- A legacy order cannot be remade (staff start a new Rx case instead).
- With `PAYMENTS_PAUSED` still on, confirm Pay is refused; then (step 7) after unfreezing, make a $1 card payment and refund it.
- Run the tracking job dry (`docs/shipping-operations.md`).
- Run the shop repair dry (`{"dryRun":true}`, step 7's call): its `missing` count must equal the number of shop orders paid between T1 and the new revision going live in step 4.5 (`select count(*) from orders where status = 'paid' and created_at >= '<T1>' and created_at < '<new revision live>'`; orders placed after that already got their lab order at checkout). A mismatch means T1 is wrong: stop and fix `LAB_SHOP_REPAIR_SINCE` before the live run.

## 7. Unfreeze

**Unset the flag; never set it to an empty value** (an empty string fails env validation and the revision never becomes ready):

```bash
gcloud run services update diamond-labs-api --region=us-central1 --project=diamond-labs-prod --remove-env-vars=PAYMENTS_PAUSED
```

- Verify: `GET /api/v1/payments/status` returns `paused: false`, then the $1 payment and its refund (step 6's last item).
- Cloud Scheduler: the jobs in `docs/shipping-operations.md` and `docs/autopay-operations.md`, plus `shop-lab-orders-repair` (POST `/internal/jobs/shop-lab-orders-repair/run`, header `x-jobs-trigger-secret`, body `{"dryRun":false}`), its first documented schedule. After its first live run, its `repaired` count must equal the dry run's `missing` from step 6 (the shop orders paid during the freeze). `AUTOPAY_LIVE_RUN` stays as it was; changing it is a separate decision.
- GCP log alerts: `[PAYMENT][LEDGER_WRITE_FAILED]`, `[PAYMENT][CAPTURED_NOT_RECORDED]`, `[PAYMENT][REFUND_UNCERTAIN]`, `[PAYMENT][REFUND_LEDGER_WRITE_FAILED]`, `[PAYMENT][REFUND_PENDING_CLEANUP_FAILED]`, `[BILLING][ISSUE_FAILED]`, `[BILLING][VOID_FAILED]`, `[AutoPay][LEDGER_WRITE_FAILED]`, `[LAB][SHOP_ORDER_FAILED]`, `[LAB][SHOP_ORDER_REPAIR_FAILED]`, and the `[SHIP][...]` lines in `docs/shipping-operations.md`.
- The lab works in the new system. Seazona is read-only reference.
- Watch the first day closely: anything entered after unfreeze is re-keyed by hand on a rollback.

## 8. Rollback (before unfreeze, or within the first day if something is badly wrong)

0. **Before restoring, list what happened since the backup so it can be re-entered.** Guest shop checkout stays open during the freeze, and a card captured after the backup would vanish from the database but not from Authorize.net. From the live database list the shop orders created since `taken at` in step 4.3, and from the Authorize.net merchant portal list every transaction since then; keep both lists (ids and amounts, no PHI in chat) and re-enter or refund them after the restore. Anything the lab entered after unfreeze is re-keyed by hand as well.
1. Roll the code back **and put back the env step 4.1 changed** (a plain `--image` deploy keeps the current env, and old `main` without `RX_LIVE_PUSH` / `SEAZONA_ORDER_USER_ID` accepts Rx cases without pushing them to Seazona, so doctors' cases would silently never reach the lab):

   ```bash
   gcloud run deploy diamond-labs-api --image=<service image from step 2> --region=us-central1 --project=diamond-labs-prod \
     --update-env-vars=RX_LIVE_PUSH=<recorded>,SEAZONA_ORDER_USER_ID=<recorded>
   gcloud run jobs update diamond-labs-jobs --image=<jobs image from step 2> --region=us-central1 --project=diamond-labs-prod \
     --update-env-vars=RX_LIVE_PUSH=<recorded>,SEAZONA_ORDER_USER_ID=<recorded>    # only the vars the Job had; skip if it did not exist
   gcloud run jobs update diamond-labs-migrate --image=<migrate job image from step 2> --region=us-central1 --project=diamond-labs-prod
   ```

   Then compare the rolled-back service's and Job's env names and secret references with step 2's record (same `node -e` listing): anything else step 4.1 removed goes back; the variables it added (seeds, `LAB_*`, carriers) are ignored by old code and may stay. Verify `RX_LIVE_PUSH` and `SEAZONA_ORDER_USER_ID` are present on the serving revision.
   **Order and expected errors:** do 8.1 then 8.2 back to back. Between them the old code runs against the migrated schema: expect 500s on invoice and payment pages (`applied_amount` is gone). Payments are paused and the lab is frozen, so nothing is written meanwhile.
2. Restore the database from the step-4.3 backup: `gcloud sql backups restore <BACKUP_ID> --restore-instance=diamond-labs-db --project=diamond-labs-prod`. **A git revert is not enough: migration 0030 dropped a column (`applied_amount`) the old code needs.** This restores the whole instance, so `diamond_labs_staging`, `diamond_labs_import` and `diamond_labs_rehearsal` roll back too: re-run the staging scrub job afterwards (staging refuses to boot otherwise) and re-run step 3's fetches before any retry (the import DB loses everything fetched since the backup, including the sealed exports; re-fetch and re-seal).
3. Unset `PAYMENTS_PAUSED` (`--remove-env-vars`, not blank) once the old revision is serving. The lab resumes on Seazona.
4. Revert the merge on `main` in a PR (user sign-off) so the next push doesn't redeploy it.

## After the cutover

- Drop `diamond_labs_rehearsal`: `gcloud sql databases delete diamond_labs_rehearsal --instance=diamond-labs-db --project=diamond-labs-prod`.
- Keep `diamond_labs_import` until the lab signs off on Seazona being gone (piece 5b).
