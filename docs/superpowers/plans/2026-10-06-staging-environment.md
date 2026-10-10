# Staging Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Stand up a staging copy of Diamond Labs that auto-deploys from `feat/own-the-lab`, runs on a PHI-scrubbed copy of production, and can't reach real people, real money or Seazona.

**Architecture:**
- **Service:** a second Cloud Run service, `diamond-labs-api-staging`, built from the same Dockerfile, in project `diamond-labs-prod`.
- **Database:** a new database, `diamond_labs_staging`, on the existing Cloud SQL instance `diamond-labs-db`, so no new instance and about $0 added. It gets its own DB user, which can reach only that database.
- **Config:** an `APP_ENV=staging` switch does three things:
  - redirects all outbound email to one inbox;
  - hard-disables Seazona;
  - marks responses `noindex` and shows a staging banner.
- **Payments:** sandbox Authorize.net only, enforced by config and checked at boot.
- **Data:** production is copied inside GCP. That means a Cloud SQL export to a private, auto-expiring bucket, then an import into the staging database, then an in-place scrub run as a Cloud Run Job. PHI never lands on a laptop.

**Tech:** Cloud Run (service + jobs), Cloud SQL (Postgres 15), Secret Manager, Cloud Build trigger, GCS. Same Node/Fastify/Drizzle/Vite stack.

## Global Constraints
- **Production stays untouched.** Prod is read only through `gcloud sql export`. Never write to the `diamond_labs` DB, the `diamond-labs-api` service, or prod secrets and jobs. The prod `cloudbuild.yaml` is not modified.
- **Staging can't reach real people, money or Seazona.**
  - `APP_ENV=staging` must make all three behaviours hold: email redirected, Seazona off, `AUTHORIZE_NET_ENV=sandbox`.
  - The API refuses to boot under `APP_ENV=staging` if `AUTHORIZE_NET_ENV !== "sandbox"` or the email redirect address is unset.
  - The scrub refuses to run unless `current_database() = 'diamond_labs_staging'` and `APP_ENV=staging`.
- **Scrubbed copy only.** No PHI and no customer PII survives the scrub (field list in Task S3). Doctors' names, practice names and emails stay, so the lab recognises its clients, but email is redirected and no prod password works on staging.
- **Prod alerts stay prod-only.** The Seazona alert policies must be scoped to `resource.labels.service_name="diamond-labs-api"`.
- **Commits and branches.** Commit trailers name the model that did the work. Work happens on `feat/own-the-lab-0-staging` and lands by PR into `feat/own-the-lab`. Push with `git push origin <branch>`, never a bare `git push`.

## Decisions for the plan review
1. **Staging email inbox:** all staging mail goes to one address. Proposed: the user's own address. Not the lab's admin inbox.
2. **Who logs into staging:**
   - A fresh admin login is created for the user, with the password stored in Secret Manager as `STAGING_ADMIN_PASSWORD`.
   - Lab staff get accounts on request.
   - Every prod password hash is nulled, so doctors can't log in until someone sets them up.
3. **Merging piece PRs:** standing OK to merge piece PRs into `feat/own-the-lab` once CodeRabbit's findings are addressed. `main` still needs explicit sign-off.

---

### Task S1: Staging safety switches (API)
**Files:** `apps/api/src/config/env.js`, `apps/api/src/config/app-env.js` (new; pure), `apps/api/src/services/email.service.js`, `apps/api/src/services/seazona.service.js`, `apps/api/src/index.js`; tests beside each.
- Add the env vars:
  - `APP_ENV: z.enum(["production","staging","development"]).default("development")`;
  - `STAGING_EMAIL_TO` (email);
  - `SEAZONA_DISABLED` (boolean string).
- Pure `assertSafeConfig(env)`: under staging, throw unless `AUTHORIZE_NET_ENV==="sandbox"`, `STAGING_EMAIL_TO` is set, and `SEAZONA_DISABLED==="true"`. Call it at boot, before `listen`.
- Email: one choke point. Every send goes through a single `deliver()`. Under staging, `to` is rewritten to `STAGING_EMAIL_TO`, the subject gets the prefix `[STAGING → original@x]`, and cc/bcc are dropped. Pure `stagingRewrite(message, env)`, tested.
- Seazona: when `SEAZONA_DISABLED==="true"`, `requestRaw` returns `{ ok:false, status:0, data:null }` without any network call. It logs `[SeazonaDisabled]`, which is NOT the alert-matched `[Seazona] …` prefix. Tested by stubbing `fetch` and asserting it is never called.
- Every response under staging carries `X-Robots-Tag: noindex, nofollow`.

### Task S2: Staging-aware web build
**Files:** `apps/web/index.html`, `apps/web/vite.config.*`, `apps/web/src/main.jsx`, a new `StagingBanner` component, and `apps/api/Dockerfile` (build args).
- Pick the Accept.js URL at build time from `VITE_AUTHORIZE_NET_ENV`: `jstest.authorize.net` for sandbox, `js.authorize.net` for production. The default is production, so the prod build is unchanged. Do it with a Vite `transformIndexHtml` hook, with a pure URL picker that is tested.
- `VITE_APP_ENV=staging` renders a fixed, unmissable "STAGING — test data, sandbox payments" banner.
- Dockerfile: pass through the `VITE_APP_ENV` and `VITE_AUTHORIZE_NET_ENV` build args. The defaults keep the prod build byte-identical.

### Task S3: Scrub job
**Files:** `apps/api/src/db/scrub-staging.js` (script), `apps/api/src/db/scrub/plan.js` (pure: statement list), tests.
- **Guard first:** abort unless `current_database()='diamond_labs_staging'` and `APP_ENV==='staging'`.
- **One transaction, idempotent:**
  - `rx_cases`: overwrite every patient-identifying and clinical free-text column. The implementer enumerates them from `schema/rx-cases.js` and lists each one in the test. Encrypted PHI columns are replaced, not decrypted.
  - Delete all `rx_case_files` rows. GCS objects are never touched.
  - `orders`: guest email becomes `guest+<id>@example.invalid`, shipping becomes a placeholder address, phone becomes null.
  - `users`: `password_hash` set to null; MFA secrets and recovery codes set to null; `authorize_net_customer_profile_id` and `default_payment_profile_id` set to null, since prod CIM ids must never be sent to sandbox.
  - Truncate `sessions`, `kv_store`, `approval_tokens` and `invitations`.
  - AutoPay enrollments: `enabled=false`.
  - `audit_log`: drop IP addresses and free-text metadata.
- Print a per-table count of rows touched.
- The test asserts the plan covers every column on a named PHI/PII list. A new PHI column added later must be added to that list, or the test fails.

### Task S4: Staging pipeline
**Files:** `cloudbuild.staging.yaml` (new).
- Steps: build, with `VITE_APP_ENV=staging`, `VITE_AUTHORIZE_NET_ENV=sandbox` and the sandbox `VITE_AUTHORIZE_NET_API_LOGIN` / `VITE_AUTHORIZE_NET_CLIENT_KEY` from Secret Manager; then push the `staging-${SHORT_SHA}` tag; then run `diamond-labs-migrate-staging --execute-now --wait`; then deploy `diamond-labs-api-staging`.
- There is no jobs step, so staging never runs AutoPay.
- Add `.coderabbit.yaml` with `reviews.auto_review.base_branches: ["feat/own-the-lab"]`. CodeRabbit skips PRs into non-default branches by default; PR #46 got no review until one was triggered by hand.

### Task S5: Provision (controller runs, with the user's authenticated gcloud)
Each command is shown before it runs. Everything new is named `*-staging` / `STAGING_*`.

**Serve-after-scrub rule:** the `diamond-labs-api-staging` service does NOT exist from the moment prod data is imported until the scrub exits 0. `--max-instances=0` is not an acceptable substitute (it does not guarantee Cloud Run stops serving): the service is deleted. Crash, kill and connection-loss during a scrub cannot be handled in code, so the database is simply never served before a clean exit. **Backstop: the scrub marker.** The scrub creates `staging_seed_marker` (outside the Drizzle schema) and upserts row id=1 in the same transaction that commits; fail-closed emptying truncates it. Under `APP_ENV=staging` the API refuses to start unless that row exists (`assertScrubMarker`, before `listen`), and a fresh prod import has no such table, so no deploy, re-created service or crash path can serve unscrubbed data.

1. Create the `diamond_labs_staging` database and the `staging_app` user, granted on that database only. Its password goes to a new `STAGING_DATABASE_URL` secret (socket form).
2. Create the secrets, and the `diamond-labs-migrate-staging`, `diamond-labs-scrub-staging` and catalog-import / create-admin jobs, but NOT the service. Env on the jobs: `APP_ENV=staging`, `SEAZONA_DISABLED=true`, `AUTHORIZE_NET_ENV=sandbox`, `NODE_ENV=production`; run them as the dedicated `staging-runtime@diamond-labs-prod.iam.gserviceaccount.com` service account (a narrow SA replacing the prod runtime SA): it is granted `secretmanager.secretAccessor` on the `STAGING_*` secrets and the shared mail/JWT-expiry secrets listed in step 7 only, plus `cloudsql.client`, and nothing else. It cannot read any prod secret. Create the jobs with the same flags as the service in step 7 (`gcloud run jobs create <name> --image=<staging image> --region=us-central1 --service-account=staging-runtime@diamond-labs-prod.iam.gserviceaccount.com --set-cloudsql-instances diamond-labs-prod:us-central1:diamond-labs-db --set-env-vars APP_ENV=staging,SEAZONA_DISABLED=true,AUTHORIZE_NET_ENV=sandbox,NODE_ENV=production,... --set-secrets ...`, with the job's own `--command/--args`). Secrets:
   - `STAGING_JWT_SECRET` (random 96 characters)
   - `STAGING_JWT_REFRESH_SECRET` if the app uses one
   - `STAGING_AUTHORIZE_NET_SANDBOX_*`, copied from the local values without printing them
   - `STAGING_VITE_AUTHORIZE_NET_API_LOGIN` and `STAGING_VITE_AUTHORIZE_NET_CLIENT_KEY`
   - `STAGING_EMAIL_TO`
   - `STAGING_ADMIN_PASSWORD`
3. Import, as the staging role: create a private bucket `gs://diamond-labs-staging-seed` with a 1-day delete lifecycle and grant the Cloud SQL SA object write; `gcloud sql export sql diamond-labs-db gs://…/prod.sql --database=diamond_labs`, then `gcloud sql import sql` into `diamond_labs_staging` as the staging role.
4. Run `diamond-labs-migrate-staging` (brings the schema level with the code; the scrub fails closed on a schema mismatch).
5. First confirm the scrub job's image equals the migrate job's (`gcloud run jobs describe diamond-labs-scrub-staging --region=us-central1 --format='value(spec.template.spec.template.spec.containers[0].image)'` against the same for `diamond-labs-migrate-staging`; `cloudbuild.staging.yaml` keeps them in step, but a re-seed must not rely on it). Then run `diamond-labs-scrub-staging`, then delete the export object from `gs://diamond-labs-staging-seed` **whatever the result** (success or failure: an unscrubbed prod dump must not sit in the bucket waiting for the lifecycle rule). **The scrub must exit 0.** Any other result: do not proceed; drop and re-create the database with the step-1 grants (the role already exists) and start again from step 3.
6. Catalog import and create-admin run from a workstation, not as Cloud Run jobs (the image does not contain `apps/web/src/data/catalog.js`). Start `cloud-sql-proxy --gcloud-auth --port 5433 diamond-labs-prod:us-central1:diamond-labs-db`, then from `apps/api` run, as `staging_app`:
   ```
   DATABASE_URL='postgresql://staging_app:<password from STAGING_DATABASE_URL>@127.0.0.1:5433/diamond_labs_staging' \
   APP_ENV=staging SEAZONA_DISABLED=true JWT_SECRET="$(openssl rand -hex 48)" \
   node src/db/import-catalog.js

   DATABASE_URL='<same>' APP_ENV=staging SEAZONA_DISABLED=true JWT_SECRET="$(openssl rand -hex 48)" \
   ADMIN_EMAIL=<admin email> ADMIN_NAME='<admin name>' \
   ADMIN_PASSWORD="$(gcloud secrets versions access latest --secret=STAGING_ADMIN_PASSWORD --project diamond-labs-prod)" \
   node src/db/create-admin.js
   ```
   Run the scripts with `node` directly (the `pnpm db:*` wrappers use `--env-file=.env`, which would load a local .env over these values). The JWT_SECRET is throwaway (the scripts only need config to parse). Never point DATABASE_URL at the prod database.
7. Only now create the `diamond-labs-api-staging` service and the Cloud Build trigger. Service command:
   ```
   gcloud run deploy diamond-labs-api-staging \
     --image=us-central1-docker.pkg.dev/diamond-labs-prod/diamond-labs/api:staging-<sha> \
     --region=us-central1 \
     --service-account=staging-runtime@diamond-labs-prod.iam.gserviceaccount.com \
     --set-cloudsql-instances diamond-labs-prod:us-central1:diamond-labs-db \
     --allow-unauthenticated --max-instances=2 --memory=512Mi \
     --set-env-vars "APP_ENV=staging,SEAZONA_DISABLED=true,AUTHORIZE_NET_ENV=sandbox,NODE_ENV=production,RX_GCS_BUCKET=diamond-labs-rx-files-staging,MEDIA_GCS_BUCKET=diamond-labs-media-staging,APP_URL=https://diamond-labs-api-staging-565921059210.us-central1.run.app,CORS_ORIGINS=https://diamond-labs-api-staging-565921059210.us-central1.run.app,ADMIN_NOTIFICATION_EMAIL=<staging inbox>" \
     --set-secrets "DATABASE_URL=STAGING_DATABASE_URL:latest,JWT_SECRET=STAGING_JWT_SECRET:latest,JWT_EXPIRY=JWT_EXPIRY:latest,REFRESH_TOKEN_EXPIRY=REFRESH_TOKEN_EXPIRY:latest,AUTHORIZE_NET_SANDBOX_API_LOGIN=STAGING_AUTHORIZE_NET_SANDBOX_API_LOGIN:latest,AUTHORIZE_NET_SANDBOX_TRANSACTION_KEY=STAGING_AUTHORIZE_NET_SANDBOX_TRANSACTION_KEY:latest,MAILGUN_API_KEY=MAILGUN_API_KEY:latest,MAILGUN_DOMAIN=MAILGUN_DOMAIN:latest,EMAIL_FROM=EMAIL_FROM:latest,PHI_ENCRYPTION_KEY=STAGING_PHI_ENCRYPTION_KEY:latest,STAGING_EMAIL_TO=STAGING_EMAIL_TO:latest"
   ```
   Then the Cloud Build trigger `deploy-staging-on-own-the-lab`: `^feat/own-the-lab$` → `cloudbuild.staging.yaml`.
8. Scope the two Seazona log-based alert policies to the prod service.

**Re-seed procedure (refreshing an existing staging):**
1. Disable the trigger `deploy-staging-on-own-the-lab` (a push would otherwise re-create the service mid-seed). `gcloud builds triggers update` has no disable flag: `gcloud beta builds triggers export deploy-staging-on-own-the-lab --destination=trigger.yaml`, set `disabled: true`, `gcloud builds triggers import --source=trigger.yaml` (pass the trigger's `--region` if it is regional). Then cancel any in-flight staging builds, which could still deploy after the trigger is disabled: `for id in $(gcloud builds list --ongoing --project diamond-labs-prod --filter='substitutions.TRIGGER_NAME="deploy-staging-on-own-the-lab"' --format='value(id)'); do gcloud builds cancel "$id" --project diamond-labs-prod; done` (add `--region` if regional). The marker gate is the backstop if one slips through.
2. Delete the service: `gcloud run services delete diamond-labs-api-staging`.
3. Drop and re-create `diamond_labs_staging` (`gcloud sql databases delete/create`), then as `postgres` re-apply the step-1 grants to the new database (`ALTER DATABASE … OWNER TO staging_app`, `REVOKE CONNECT … FROM PUBLIC`, `GRANT CONNECT … TO staging_app`, `ALTER SCHEMA public OWNER TO staging_app`; the role itself already exists), then re-run steps 3 to 6 above (import; migrate; confirm the scrub job image equals the migrate job's; scrub, exit 0, deleting the export object whatever the result; catalog import and create-admin from a workstation through `cloud-sql-proxy --gcloud-auth` as `staging_app`, per step 6).
4. Re-create the service only (step 7's `gcloud run deploy`; the trigger still exists, just disabled). Never re-create it after a non-zero scrub exit.
5. Re-enable the trigger: same export/import with `disabled: false`.

### Task S6: Verify
- `/api/v1/health` returns 200 on the staging URL.
- The staging banner shows.
- `X-Robots-Tag` is present.
- Admin login works.
- `GET /catalog` returns the imported shop families.
- A sandbox checkout with test card 4111 1111 1111 1111 succeeds. Confirm it in the sandbox merchant portal, not the prod one.
- The receipt arrives at `STAGING_EMAIL_TO` with the `[STAGING →` prefix.
- A spot SQL query on staging shows no patient names, no rx files, and null password hashes and CIM ids.
- The prod service revision and prod DB are unchanged: compare the revision name and a row count before and after.

**Provisioning notes (first run, 2026-10-07):**
- `import-catalog` and `create-admin` were run from a workstation through `cloud-sql-proxy --gcloud-auth` as `staging_app`, not as Cloud Run jobs: `import-catalog` reads `apps/web/src/data/catalog.js`, which the runtime image does not contain.
- The first image was built with a build-and-push-only config (the full pipeline would have deployed the service before the scrub).
- Cloud SQL's SQL export carries no ownership statements, so an import as `staging_app` leaves every object owned by `staging_app`; no ownership fix-up is needed. Never use `REASSIGN OWNED BY postgres` (it also reassigns shared objects such as the production database).
- The two Seazona alert policies were already scoped to `service_name="diamond-labs-api"`; step 8 needed no change.
- 2026-10-07: product image uploads (main #50) store in `MEDIA_GCS_BUCKET`; staging has its own `gs://diamond-labs-media-staging` (private, staging-runtime objectAdmin only), set on the service.
