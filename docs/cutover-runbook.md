# Cutover runbook (own-the-lab piece 5)

Executed once, by the operator with the user, inside the agreed window. Every
time below is the lab's local time (America/Chicago). Read
`docs/import-operations.md` first: its setup, rules and commands apply here
(the shell exports, the production PHI key, the load lock, exit codes).

**Nothing here starts without the user's explicit go. Step 4 (the merge to
`main`) needs a second, separate sign-off at that moment.**

Every `import:*` command below is `pnpm --filter @my-app/api import:<x> ...`.
Dry-run each step, read it, then re-run with `--live`.

## T-1 week (all must be true)

- [ ] Rehearsal parity is clean, or every difference was accepted with `--accept` and the user agreed in writing (record `report.accepted`).
- [ ] The lab has walked through the rehearsal.
- [ ] The user has given the go and picked the window. Freeze length = rehearsal migrate time + load time + 2 h margin (fill in: migrate ___ min, load ___ min).
- [ ] The doctors' notice email is drafted; the user sends it (code never does).
- [ ] **The `PAYMENTS_PAUSED` PR is merged to `main`, deployed, and production still takes payments with the flag unset.** Merge SHA: ___ (instructions below).
- [ ] New env and secrets are staged in Secret Manager (not attached yet): carriers and `LAB_*` (`docs/shipping-operations.md`), mail settings, and the seeds (computed in step 3).
- [ ] Cloud Run env to drop at the merge: `RX_LIVE_PUSH`, `SEAZONA_ORDER_USER_ID` (piece 2 carry-over). `LAB_SHOP_REPAIR_SINCE` = piece 2's production deploy date.
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

1. The lab stops entering invoices, payments and orders in Seazona.
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

   Time set: ___ (the merge gate in step 4 is this time + 35 min).
4. **Verify it took.** The new revision must be serving (a malformed value would leave the old one). `GET /api/v1/payments/status` returns `paused: true`, and a doctor pressing Pay sees "Payments are paused for an upgrade."

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

main SHA ___ · service image ___ · jobs image ___ (a deploy's `update-jobs` step moves the Job to the new image, so it must be rolled back too)

## 3. Final delta fetch and final balance export

Off-hours does not apply inside the window, but the fetcher still paces itself at 30/min under the live portal's shared quota; keep the counts small.

1. Summaries (about 6 requests): `import:fetch clients|invoices|orders --live`.
2. Details for what changed (dry run first; the count is small; with the user's OK `--live --approved N`):
   - `import:fetch invoices --detail --since <last rehearsal fetch date>`
   - `import:fetch orders --detail --open --refetch` (**`--refetch` is required**: an order has no `lastModified`, so without it a stored open order is never re-read and its status would be stale).
3. The lab produces the final balance export from the Seazona portal. Download to an encrypted disk, seal it at once, delete the local file and empty the Trash: `import:fetch export --balances <per-invoice|per-client, as chosen at T-1> --file <export.xls>` (prints the file id and any row problems; no Seazona call). **Fix problems with the lab and re-export now:** a corrected export after a live balances run means a restore, not a re-run.
4. **Seeds (a hard prerequisite of step 4; do not merge without them).** After step 3.1's summary fetch, derive Seazona's highest invoice and order numbers with a **rehearsal** dry run: `import:load invoices --target rehearsal` (no `--live`), and read `seeds.seazonaMax` (invoice and order). The raw store is shared, so the numbers are the same for production. Do NOT use a production dry run for this: production's pre-merge schema has no `invoices` / `lab_orders` tables, so it fails. `INVOICE_NUMBER_START` = invoice max + 1, `LAB_ORDER_NUMBER_START` = order max + 1. Record: ___ / ___ . (The rehearsal must still be migrated and loadable; if it was dropped, re-clone it first.)

## 4. Merge `feat/own-the-lab` to `main` (user's explicit sign-off now)

1. Stage the env and secrets, with the seeds, **before** the merge so the new revision boots with them: on the service (`gcloud run services update ... --update-env-vars INVOICE_NUMBER_START=...,LAB_ORDER_NUMBER_START=... --update-secrets ...`; remove `RX_LIVE_PUSH`, `SEAZONA_ORDER_USER_ID`) **and on the `diamond-labs-jobs` Job if it exists** (`gcloud run jobs update diamond-labs-jobs ...` with the same seeds and the carrier / `LAB_*` / mail settings from `docs/shipping-operations.md`): the Job runs the same code, and its tracking and repair runs allocate invoice and order numbers, so without the seeds it would number from the defaults. Keep `PAYMENTS_PAUSED=true`.
2. **Gate: it is now at least the recorded pause time + 35 minutes** (step 1.3). Now: ___ . If not, wait.
3. **Take the backup now, as the last action before the merge** (after the final fetch, the export and the env staging):

   ```bash
   gcloud sql backups create --instance=diamond-labs-db --project=diamond-labs-prod --description="pre-cutover"
   gcloud sql backups list --instance=diamond-labs-db --project=diamond-labs-prod --filter="description='pre-cutover'" --sort-by=~windowStartTime --limit=1   # record BACKUP_ID
   ```

   Backup id ___ · taken at ___
4. Open the PR `feat/own-the-lab` to `main` (hundreds of files: over CodeRabbit's cap; every piece was reviewed as its own PR, so say so in the body). If it conflicts on `middleware/payments-paused.js`, its test or `payments-paused-wiring.test.js`, the two sides are identical; on `env.js` / route files keep `feat/own-the-lab`'s side (it already has the flag).
5. The user merges. Cloud Build (`deploy-api-on-main`) runs migrate (0025 to 0033, one transaction) then deploy. Watch it to completion: `gcloud builds list --project=diamond-labs-prod --limit=1` then `gcloud builds log <id> --project=diamond-labs-prod --stream`.

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

- Before the live `balances` run, read the dry run's `exportProblems`, `warnings` and `reconciliation`. A live run refuses on export problems; `--accept-export-problems` leaves unreadable/duplicate rows open but **settles keyless rows as paid**, and a corrected export afterwards needs a restore. Prefer a fixed export.
- Every live step holds the target's load lock; parity takes it too. Do not run two loads at once.
- Unowned invoices or orders in the reports (`loaded_invoices_still_unowned_client`, `client_has_multiple_owners`, ...): link the owner (an admin approves/links the doctor), then **re-run the step** (`invoices`, `orders`), which reattaches them. Parity lists what is still unowned and its open balance.
- **Parity must exit 0**: clean, or every remaining difference accepted by the user (`--accept <kind>,<kind>`). Record the saved report id and `report.accepted` here: report id ___ · accepted ___ . Check `report.accepted`, not only the exit code. Otherwise: rollback (step 8).

## 6. Smoke (operator + one lab admin)

- Log in as a lab admin and as a test doctor.
- Open a legacy invoice: "Carried over from Seazona", the patient, the right balance. Credit and Void are hidden on any unowned legacy invoice.
- Check a known client's balance against the final export.
- Release a test Rx case to the board; it gets a number from `LAB_ORDER_NUMBER_START`.
- A legacy order cannot be remade (staff start a new Rx case instead).
- With `PAYMENTS_PAUSED` still on, confirm Pay is refused; then (step 7) after unfreezing, make a $1 card payment and refund it.
- Run the tracking job dry (`docs/shipping-operations.md`).

## 7. Unfreeze

**Unset the flag; never set it to an empty value** (an empty string fails env validation and the revision never becomes ready):

```bash
gcloud run services update diamond-labs-api --region=us-central1 --project=diamond-labs-prod --remove-env-vars=PAYMENTS_PAUSED
```

- Verify: `GET /api/v1/payments/status` returns `paused: false`, then the $1 payment and its refund (step 6's last item).
- Cloud Scheduler: the jobs in `docs/shipping-operations.md` and `docs/autopay-operations.md`, plus `shop-lab-orders-repair` (POST `/internal/jobs/shop-lab-orders-repair/run`, header `x-jobs-trigger-secret`, body `{"dryRun":false}`), its first documented schedule. `AUTOPAY_LIVE_RUN` stays as it was; changing it is a separate decision.
- GCP log alerts: `[PAYMENT][LEDGER_WRITE_FAILED]`, `[PAYMENT][CAPTURED_NOT_RECORDED]`, `[PAYMENT][REFUND_UNCERTAIN]`, `[PAYMENT][REFUND_LEDGER_WRITE_FAILED]`, `[PAYMENT][REFUND_PENDING_CLEANUP_FAILED]`, `[BILLING][ISSUE_FAILED]`, `[BILLING][VOID_FAILED]`, `[AutoPay][LEDGER_WRITE_FAILED]`, `[LAB][SHOP_ORDER_FAILED]`, `[LAB][SHOP_ORDER_REPAIR_FAILED]`, and the `[SHIP][...]` lines in `docs/shipping-operations.md`.
- The lab works in the new system. Seazona is read-only reference.
- Watch the first day closely: anything entered after unfreeze is re-keyed by hand on a rollback.

## 8. Rollback (before unfreeze, or within the first day if something is badly wrong)

0. **Before restoring, list what happened since the backup so it can be re-entered.** Guest shop checkout stays open during the freeze, and a card captured after the backup would vanish from the database but not from Authorize.net. From the live database list the shop orders created since `taken at` in step 4.3, and from the Authorize.net merchant portal list every transaction since then; keep both lists (ids and amounts, no PHI in chat) and re-enter or refund them after the restore. Anything the lab entered after unfreeze is re-keyed by hand as well.
1. Roll the code back: `gcloud run deploy diamond-labs-api --image=<service image from step 2> --region=us-central1 --project=diamond-labs-prod`, **and the Job**: `gcloud run jobs update diamond-labs-jobs --image=<jobs image from step 2> --region=us-central1 --project=diamond-labs-prod` (skip if it did not exist).
2. Restore the database from the step-4.3 backup: `gcloud sql backups restore <BACKUP_ID> --restore-instance=diamond-labs-db --project=diamond-labs-prod`. **A git revert is not enough: migration 0030 dropped a column (`applied_amount`) the old code needs.** This restores the whole instance, so `diamond_labs_staging`, `diamond_labs_import` and `diamond_labs_rehearsal` roll back too: re-run the staging scrub job afterwards (staging refuses to boot otherwise) and re-run step 3's fetches before any retry (the import DB loses everything fetched since the backup, including the sealed exports; re-fetch and re-seal).
3. Unset `PAYMENTS_PAUSED` (`--remove-env-vars`, not blank) once the old revision is serving. The lab resumes on Seazona.
4. Revert the merge on `main` in a PR (user sign-off) so the next push doesn't redeploy it.

## After the cutover

- Drop `diamond_labs_rehearsal`: `gcloud sql databases delete diamond_labs_rehearsal --instance=diamond-labs-db --project=diamond-labs-prod`.
- Keep `diamond_labs_import` until the lab signs off on Seazona being gone (piece 5b).
