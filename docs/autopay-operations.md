# AutoPay Operations Runbook

_Written 2026-08-07 (Task 19). Commands in this doc have NOT been run against
GCP — credentials for `diamond-labs-prod` were unavailable when it was
written. Treat every command as unverified until a human with prod
credentials runs it once and confirms the output matches what's described
here._

This document covers the one-time GCP setup for the AutoPay scheduled sweep,
the go-live checklist that gates turning charging on, and the operational
caveats found while building it.

**Read first:** `cloudbuild.yaml` (the `update-jobs` step — deploy-time,
image-only, never executes) and `apps/api/src/jobs/cli.js` (the entrypoint
the job runs). Background: `docs/superpowers/specs/2026-08-07-autopay-and-admin-parity-design.md`
section 3, "Scheduler subsystem".

---

## 0. How this is wired, in one paragraph

`diamond-labs-jobs` is a second Cloud Run Job, same image as the API
(`diamond-labs-api`), same Cloud SQL connection and mostly the same secrets.
Its command is `node apps/api/src/jobs/cli.js autopay --live`. Deploys
(`cloudbuild.yaml`'s `update-jobs` step) only ever `gcloud run jobs update`
it — point it at the new image — **never** `--execute-now`. Cloud Scheduler
is the only thing that runs it, once a day. Whether a run actually charges
anyone is controlled by a single Secret Manager value, `AUTOPAY_LIVE_RUN`,
read by `apps/api/src/config/env.js` and checked in
`apps/api/src/jobs/definitions/autopay.job.js`. The `--live` flag baked into
the job's args is a constant — it always *asks* to charge; `AUTOPAY_LIVE_RUN`
is the thing that decides whether that request is honored. This is
deliberate: it means the entire go-live/rollback lever is "flip one secret,
redeploy the job" — nothing about the job definition or Scheduler needs to
change.

---

## 1. One-time setup

All commands assume:

```bash
PROJECT_ID=diamond-labs-prod
REGION=us-central1
JOB_NAME=diamond-labs-jobs
IMAGE=us-central1-docker.pkg.dev/diamond-labs-prod/diamond-labs/api:latest   # pin to a SHA tag if you have one
SQL_INSTANCE=diamond-labs-prod:us-central1:diamond-labs-db
RUNTIME_SA=565921059210-compute@developer.gserviceaccount.com   # same runtime SA the API service and diamond-labs-migrate already use
```

### 1.1 Find the secrets the API service already uses

`diamond-labs-jobs` runs the same `apps/api/src/config/env.js`, and its
`parseEnv()` hard-exits if required vars (`DATABASE_URL`, `JWT_SECRET`, and
`PHI_ENCRYPTION_KEY` in production) are missing. Rather than re-guess secret
resource names here, pull the exact `--set-secrets` value the running API
service already uses and reuse it:

```bash
gcloud run services describe diamond-labs-api \
  --project=$PROJECT_ID --region=$REGION \
  --format="yaml(spec.template.spec.containers[0].env)"
```

Copy the resulting secret references (`DATABASE_URL`, `JWT_SECRET`,
`PHI_ENCRYPTION_KEY`, `SEAZONA_API_KEY`, `SEAZONA_SECRET`,
`SEAZONA_BASE_URL`, `AUTHORIZE_NET_API_LOGIN`,
`AUTHORIZE_NET_TRANSACTION_KEY`, `AUTHORIZE_NET_ENV`, `MAILGUN_*`,
`EMAIL_FROM`, `APP_URL`, `NODE_ENV`, etc.) — the job needs all of them,
because the AutoPay sweep touches Seazona, Authorize.net, and email exactly
like the doctor-facing routes do. Call that value `$EXISTING_SECRETS` below
(a comma-separated `KEY=secret:version` list).

### 1.2 Create the AutoPay-specific secrets

These five are new — nothing in the existing service uses them:

```bash
# The live-charge gate. Starts false — this is the whole point.
printf 'false' | gcloud secrets create autopay-live-run --project=$PROJECT_ID --data-file=-
printf '200' | gcloud secrets create autopay-min-amount --project=$PROJECT_ID --data-file=-
printf 'America/Chicago' | gcloud secrets create autopay-timezone --project=$PROJECT_ID --data-file=-
printf '3' | gcloud secrets create autopay-max-failures --project=$PROJECT_ID --data-file=-

# High-entropy shared secret guarding the internet-reachable /internal/jobs/*
# HTTP trigger on the PUBLIC diamond-labs-api service (apps/api/src/jobs/triggers/http.js).
# That route is mounted on the same Fastify instance that serves the SPA with
# no ingress restriction in front of it — this secret is the only thing
# standing between it and anyone on the internet. Generate 32+ random bytes,
# never a memorable string. (This secret belongs on diamond-labs-api, the
# service that hosts the route — the diamond-labs-jobs Job itself is invoked
# directly by Cloud Scheduler via the Cloud Run Admin API in this setup and
# does not need it, though there's no harm giving it the same value.)
openssl rand -hex 32 | gcloud secrets create jobs-trigger-secret --project=$PROJECT_ID --data-file=-

for s in autopay-live-run autopay-min-amount autopay-timezone autopay-max-failures jobs-trigger-secret; do
  gcloud secrets add-iam-policy-binding $s --project=$PROJECT_ID \
    --member="serviceAccount:$RUNTIME_SA" --role="roles/secretmanager.secretAccessor"
done

# Also add JOBS_TRIGGER_SECRET to the running API service so the HTTP trigger
# route stops 503ing (env.js: unset -> requireTriggerSecret returns 503):
gcloud run services update diamond-labs-api --project=$PROJECT_ID --region=$REGION \
  --update-secrets="JOBS_TRIGGER_SECRET=jobs-trigger-secret:latest"
```

Alternative to a shared secret for `/internal/jobs/*`: restrict ingress on
`diamond-labs-api` to internal-only and drop the route behind IAM instead.
Not done here because the service also serves the public SPA and API — worth
reconsidering if this route ever needs to be more than a manual/break-glass
trigger.

### 1.3 Create the `diamond-labs-jobs` Cloud Run Job

```bash
gcloud run jobs create $JOB_NAME \
  --project=$PROJECT_ID \
  --region=$REGION \
  --image=$IMAGE \
  --command=node \
  --args=apps/api/src/jobs/cli.js,autopay,--live \
  --service-account=$RUNTIME_SA \
  --set-cloudsql-instances=$SQL_INSTANCE \
  --set-secrets="$EXISTING_SECRETS,AUTOPAY_LIVE_RUN=autopay-live-run:latest,AUTOPAY_MIN_AMOUNT=autopay-min-amount:latest,AUTOPAY_TIMEZONE=autopay-timezone:latest,AUTOPAY_MAX_FAILURES=autopay-max-failures:latest" \
  --max-retries=0 \
  --task-timeout=30m
```

Notes on the non-obvious flags:

- **`--args=...,autopay,--live`** — see section 0. This is permanent; the
  live/dry-run switch is `AUTOPAY_LIVE_RUN`, not this flag.
- **`--max-retries=0`** — the sweep takes a durable `kv_store`-backed lock
  per job name (`apps/api/src/jobs/runner.js`, TTL 1h). If a task dies
  mid-run, a Cloud Run-initiated retry would immediately hit that lock and
  fail again — it cannot resume or re-sweep, it can only burn time before
  the execution is marked failed. Zero retries fails fast and lets the next
  day's scheduled run (or a manual re-run once the issue is understood) be
  the recovery path, rather than retry-storming against a lock.
- **`--task-timeout=30m`** — see the rate-limit caveat in section 4. Revisit
  upward if the enrolled cohort grows large enough that 30 minutes becomes
  tight; there's no way to know a safe number in advance without live data,
  so treat this as a starting point, not a validated ceiling.
- **No `--set-env-vars=NODE_ENV=production`** — pull that from
  `$EXISTING_SECRETS`/env if it's set as a plain env var rather than a
  secret on the API service; confirm with the `describe` command in 1.1.

### 1.4 Create a Scheduler-only invoker service account

Least-privilege: a dedicated SA that can only run this one job, rather than
reusing the runtime SA (which has DB/secret access it doesn't need for the
scheduler role).

```bash
gcloud iam service-accounts create autopay-scheduler-invoker \
  --project=$PROJECT_ID \
  --display-name="Cloud Scheduler invoker for diamond-labs-jobs"

gcloud run jobs add-iam-policy-binding $JOB_NAME \
  --project=$PROJECT_ID --region=$REGION \
  --member="serviceAccount:autopay-scheduler-invoker@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

### 1.5 Create the Cloud Scheduler job

```bash
gcloud scheduler jobs create http autopay-daily-sweep \
  --project=$PROJECT_ID \
  --location=$REGION \
  --schedule="0 9 * * *" \
  --time-zone="America/Chicago" \
  --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB_NAME}:run" \
  --http-method=POST \
  --oauth-service-account-email="autopay-scheduler-invoker@${PROJECT_ID}.iam.gserviceaccount.com"
```

`0 9 * * *` in `America/Chicago` is 9am Central, matching
`AUTOPAY_TIMEZONE` — the schedule and the "what day is it for billing
purposes" logic (`apps/api/src/lib/autopay-schedule.js`) should stay in the
same timezone or the sweep can fire on the wrong calendar day relative to
`dayOfMonth`.

### 1.6 Manual test run (safe at any time before go-live)

Because `AUTOPAY_LIVE_RUN` defaults to `false`, executing the job on demand
is safe — it always ends up as a dry run until step 2.3 below flips the
secret:

```bash
gcloud run jobs execute $JOB_NAME --project=$PROJECT_ID --region=$REGION --wait
```

Use this instead of waiting for 9am Central to populate `autopay_attempts`
for the go-live checklist.

---

## 2. Go-live checklist

Do these **in order**. Do not skip to step 2.3.

### 2.1 Confirm `autopay_attempts` has sane `would_charge` rows

Run a manual dry-run execution first if you don't already have recent data
(section 1.6), then:

```sql
-- Most recent would-charge attempts, newest first
select id, enrollment_id, user_id, cycle_key, scheduled_for,
       amount_attempted, allocations, created_at
from autopay_attempts
where status = 'would_charge'
order by created_at desc
limit 50;

-- Sanity aggregate over the last dry run
select count(*)          as would_charge_count,
       min(amount_attempted) as min_amount,
       max(amount_attempted) as max_amount,
       sum(amount_attempted) as total_amount
from autopay_attempts
where status = 'would_charge'
  and created_at > now() - interval '2 days';
```

Look for: amounts that match what each doctor actually enrolled at (or a
smaller amount if `resolveChargeAmount` capped to their remaining balance —
never larger), `allocations` that reference real, currently-open invoice
IDs, and no doctor appearing whose balance already looks paid off.

### 2.2 Confirm nobody is enrolled who shouldn't be

```sql
select ae.id, ae.user_id, u.email, u.name, ae.amount, ae.day_of_month,
       ae.status, ae.payment_profile_id, ae.min_amount_override,
       ae.created_by_user_id, ae.created_at
from autopay_enrollments ae
join users u on u.id = ae.user_id
where ae.enabled = true
order by ae.day_of_month;
```

Cross-check this list by hand against whoever actually opted in (doctor
self-enroll or admin-on-behalf-of). Absence of a row means not enrolled —
there is no seed/migration/import path that creates one, so every row here
was a deliberate action; but "deliberate" doesn't mean "correct" — this is
the last chance to catch a fat-fingered amount or the wrong doctor before
money moves.

### 2.3 Set `AUTOPAY_LIVE_RUN=true` and redeploy

```bash
printf 'true' | gcloud secrets versions add autopay-live-run --project=$PROJECT_ID --data-file=-

# Force the job to pick up the new secret version now, rather than trusting
# :latest resolution timing:
gcloud run jobs update $JOB_NAME --project=$PROJECT_ID --region=$REGION \
  --update-secrets="AUTOPAY_LIVE_RUN=autopay-live-run:latest"
```

### 2.4 Watch the first live run

Trigger it manually so you're watching in real time rather than waiting for
9am Central:

```bash
gcloud run jobs execute $JOB_NAME --project=$PROJECT_ID --region=$REGION --wait
```

```sql
-- The run's own summary (charged / failed / skipped / wouldCharge / totalAmount)
select id, job_name, trigger, status, dry_run, started_at, finished_at, summary, error
from job_runs
where job_name = 'autopay'
order by started_at desc
limit 5;

-- Every attempt from the live run, most recent first
select id, enrollment_id, user_id, status, amount_attempted, amount_charged,
       transaction_id, failure_reason, created_at
from autopay_attempts
where dry_run = false
order by created_at desc
limit 100;
```

Note: `job_runs.trigger` will read `'cli'` here even though Cloud Scheduler
triggered it — `apps/api/src/jobs/cli.js` always passes `trigger: "cli"`
regardless of caller, because the entrypoint IS the CLI. The `'schedule'`
enum value belongs to the separate HTTP trigger path
(`apps/api/src/jobs/triggers/http.js`), which is not what production uses
here (see section 0). Don't go looking for `trigger = 'schedule'` rows and
conclude the scheduler isn't firing — check `started_at` timestamps against
the Scheduler job's history instead.

Confirm: `status.succeeded` count and `summary.totalAmount` match what you
expected from the last dry run; `autopay_attempts.status = 'succeeded'` rows
have a `transaction_id`; no unexpected `failed` rows.

---

## 3. Rollback

```bash
printf 'false' | gcloud secrets versions add autopay-live-run --project=$PROJECT_ID --data-file=-
gcloud run jobs update $JOB_NAME --project=$PROJECT_ID --region=$REGION \
  --update-secrets="AUTOPAY_LIVE_RUN=autopay-live-run:latest"
```

`autopay_enrollments` rows are untouched — nobody is un-enrolled. The next
sweep (scheduled or manual) resolves balances and writes `would_charge`
attempts exactly as before, and charges nothing, because
`effectiveDryRun = dryRun || !env.AUTOPAY_LIVE_RUN` in
`apps/api/src/jobs/definitions/autopay.job.js` forces dry-run the instant the
env gate is false again, independent of the `--live` flag baked into the
job's args.

---

## 4. Known operational caveats

These were found during implementation and are accepted risks, not bugs to
"just go fix" without a separate decision to do so:

- **A `job_runs` row can stay `running` forever.** If the process is killed
  mid-sweep (Cloud Run timeout, OOM, a bad deploy racing an in-flight
  execution), nothing ever transitions that row to `succeeded`/`failed` —
  there is deliberately no reconciliation job. Do not treat `job_runs.status
  = 'running'` as proof a sweep is currently in progress; check `started_at`
  age and the Cloud Run execution's own status instead. (See the comment in
  `apps/api/src/jobs/runner.js` above the `jobRuns` insert.)
- **A crash-window double-charge is possible, and is an accepted risk.**
  `withIdempotency` (`apps/api/src/lib/payment-helpers.js`) caches the
  charge result only *after* both the Authorize.net charge and
  `recordPaymentAndAllocations` complete. Its in-flight lock TTL is 120
  seconds; the job-level lock in `runner.js` is 1 hour. If the process dies
  in the window between "card charged" and "result cached" (Cloud Run OOM
  or hard timeout), a retry more than 120 seconds later has no memory of the
  charge and can charge the same doctor again for the same cycle. Not
  re-architected as part of this task — flagged so it stays a known,
  monitored risk rather than a silent one. Mitigation in practice:
  `--max-retries=0` (section 1.3) means this can only happen via a manual
  re-run, not an automatic one, which gives a human a chance to check
  `autopay_attempts` first.
- **Seazona rate-limits hard, so the sweep is serial.** Concurrency 8 failed
  448 of 476 requests against Seazona; the sweep is deliberately serial with
  ~110ms spacing between enrollments (`SEAZONA_SPACING_MS` in
  `apps/api/src/services/autopay-runner.service.js`), on top of each
  enrollment's own Seazona invoice fetch and (if live) Authorize.net charge
  latency. Wall-clock time scales with the size of the enrolled cohort, not
  just that floor. This is why `--task-timeout=30m` (section 1.3) is a
  starting point, not a fixed answer — watch `job_runs.finished_at -
  started_at` as the enrolled cohort grows and raise the timeout before it
  becomes a real constraint, not after a run gets killed mid-sweep (which
  triggers the crash-window risk above).
- **`JOBS_TRIGGER_SECRET` guards an internet-reachable endpoint.** The
  `/internal/jobs/*` routes (`apps/api/src/jobs/triggers/http.js`) are
  mounted on `diamond-labs-api`, the same Fastify instance that serves the
  public SPA and API with no ingress restriction in front of it. That
  secret is the only thing standing between those routes and anyone on the
  internet — it must be high-entropy (32+ random bytes, generated, never
  chosen) and never logged or committed. The lower-risk alternative is
  restricting ingress on the service to internal-only, which wasn't done
  here because the service also has to be publicly reachable for the SPA
  and the doctor-facing API.
- **The `invoice_payments.source` backfill is unproven against production
  data.** `pnpm db:backfill-payment-source`
  (`apps/api/src/db/backfill-payment-source.js`) is idempotent and has a
  dry-run mode, but has never been run against the real production
  `invoice_payments` table. Run it with `DRY_RUN=1` first
  (`DRY_RUN=1 pnpm db:backfill-payment-source`, or
  `DRY_RUN=1 pnpm --filter @my-app/api db:backfill-payment-source` from the
  repo root), read the per-source counts it prints, and only re-run without
  `DRY_RUN` once those counts look right. This is unrelated to whether
  AutoPay is live, but matters for the same reason: it touches the ledger
  that AutoPay reads balances from (`getPortalPaidMapStrict`).

---

## 5. Quick reference

| Action | Command |
|---|---|
| Manual dry-run execution | `gcloud run jobs execute diamond-labs-jobs --project=diamond-labs-prod --region=us-central1 --wait` |
| Go live | flip `autopay-live-run` secret to `true` + `gcloud run jobs update ... --update-secrets` (section 2.3) |
| Roll back | flip `autopay-live-run` secret to `false` + `gcloud run jobs update ... --update-secrets` (section 3) |
| Recent runs | `select * from job_runs where job_name = 'autopay' order by started_at desc limit 10;` |
| Recent attempts | `select * from autopay_attempts order by created_at desc limit 50;` |
| Current enrollments | `select * from autopay_enrollments where enabled = true;` |

## Seazona rate limits (documented, confirmed by Seazona support)

<https://support.seazona.net/Api.html#rate-limits>

- **60 requests/minute per integration**, all request types combined
- **20 requests/minute** for POST/PUT/PATCH/DELETE — counted *inside* the 60, not on top
- Exceeding either returns **429 with a `Retry-After` header**

**Sustained overage escalates past 429 to a tenant-wide block.** On 2026-08-07 a burst of
roughly 950 GETs in 90 seconds (~630/min, about 10x the limit) got API access disabled for the
entire host: every endpoint returned `403 API access is temporarily disabled for this host`.
It was not recoverable by issuing new credentials or calling from a different IP — only Seazona
support can clear it. Treat the limit as a hard operational boundary, not a guideline.

**How we comply.** The throttle is enforced centrally in
`apps/api/src/services/seazona.service.js`, inside the single `requestRaw` every Seazona call
funnels through — so no caller can bypass it and no future code has to remember to. It caps at
50 requests/minute overall and 15 writes/minute, deliberately under the documented ceilings to
leave headroom, and it honours `Retry-After` on a 429 with exactly one retry (never an
unbounded loop, which is what turns a throttle into a block).

The AutoPay sweep additionally paces ~1.1s between doctors. That is not what keeps us legal —
the wrapper does — it exists so a long sweep does not consume the whole minute's budget in one
burst and starve doctors loading their invoice pages concurrently.

**Sizing the Cloud Run Job timeout.** Because the ceiling is 60/min, sweep duration is bounded
by request count, not CPU. Budget roughly: (invoice-archive pages) + (one `getInvoice` per
allocated invoice, per doctor) requests, at <=50/min. A cohort large enough to approach the
`--task-timeout` should be split across days rather than run faster.

**Seazona's own recommendation for bulk reads:** use the `lastModified` query parameter to pull
only records changed since the last sync rather than refetching the full set. Our invoice reads
currently pass the epoch (everything) on each run — moving to incremental sync is the main
remaining lever if the archive grows.
