# Staging scrub: column classification

Source of truth is `plan.js` (data) and `plan.test.js` (fails if any schema column is unclassified). This file explains the reasoning. Run with `pnpm --filter @my-app/api db:scrub-staging`; it only runs against `current_database() = 'diamond_labs_staging'` with `APP_ENV=staging`.

Classes: **keep** (copied), **phi** (patient health info/identity), **pii** (customer or free-text personal data), **secret** (credentials, tokens, payment profiles), **reset** (operational state neutralised). Everything not "keep" is overwritten in one transaction, followed by `VACUUM FULL` on each touched table (outside the transaction) so old PHI tuples do not linger in dead pages.

**Fail closed** (`run.js`): after the guard passes, ANY failure (schema behind code, an unclassified live table/column, the scrub transaction, VACUUM) empties the database. The table list comes from the live catalog (`pg_class`/`pg_namespace`, relkind r/p/m, all non-system schemas, excluding only `drizzle.__drizzle_migrations`), not from the plan, so it works when plan tables do not exist. One `TRUNCATE ... CASCADE` per table so one failure cannot block the rest; materialized views are dropped; foreign tables are reported and skipped. The guard is re-checked on the same connection right before. Exit 1 = "staging DB emptied — re-import"; exit 2 = "CRITICAL: staging DB NOT fully emptied — drop the database now". A guard refusal (wrong DB or env) never truncates anything and exits 1.

Pre-check before the transaction: every plan table and column must exist live ("schema behind code — run diamond-labs-migrate-staging before scrubbing"), and every live table/column (relkind r/p/m/f) must be in the plan. Encrypted PHI is never decrypted; it is replaced (staging has a different key). Doctor and practice names and emails are kept by design (mail is redirected, no password survives).

## Rewritten columns

| Table.column | Class | Becomes |
|---|---|---|
| users.password_hash | secret | NULL |
| users.mfa_secret | secret | NULL |
| users.mfa_enabled | reset | false |
| users.email, users.name (role = 'user' only) | pii | `user+<id>@example.invalid` / `Scrubbed User`. Public sign-ups, not doctors; doctors and admins keep both |
| users.authorize_net_customer_profile_id | secret | NULL (prod CIM ids must never reach sandbox) |
| users.default_payment_profile_id | secret | NULL |
| accounts.settings | pii | `{}` (free-form jsonb) |
| audit_log.metadata | pii | `{}` (free text: notes, names, emails) |
| audit_log.ip_address | pii | NULL |
| doctor_profiles.delivery_notes | pii | NULL (free text, could name a patient) |
| autopay_enrollments.enabled | reset | false |
| autopay_enrollments.payment_profile_id | secret | `'SCRUBBED'` (NOT NULL) |
| autopay_enrollments.paused_reason | pii | NULL (free text) |
| rx_case_lines.source_label | phi | NULL (copies the doctor's free-form "Other" device text verbatim; the app encrypts the source as PHI) |
| rx_case_lines.name | phi | `Manual line` when origin = 'manual' (staff-typed), else unchanged |
| rx_case_lines.map_key | phi | kept only when it is a KNOWN catalog-map key (same list as rx_code_overrides); otherwise `line:<id>`; NULL stays NULL. Any line (auto/confirmed too) can carry a doctor-typed literal when an "always" override fed it |
| autopay_attempts.failure_reason | pii | NULL (gateway/Seazona error text) |
| job_runs.summary | pii | NULL |
| job_runs.error | pii | NULL |
| orders.email | pii | `guest+<id>@example.invalid` |
| orders.phone | pii | NULL |
| orders.shipping | pii | placeholder address jsonb |
| orders.auth_code | secret | NULL |
| orders.seazona_push_error | pii | NULL (can echo the customer payload) |
| rx_cases.patient_first | phi | `Test` |
| rx_cases.patient_last | phi | `Patient <case_number>` |
| rx_cases.dob, gender, contact_phone | phi | NULL |
| rx_cases.ship_to, form_data, payload_snapshot | phi | NULL (encrypted JSON blobs) |
| rx_cases.device_options | phi | `{}` plaintext (phi-crypto passes un-prefixed values through) |
| rx_cases.signature_url | phi | NULL (GCS reference) |
| rx_cases.general_comments, manual_note | phi | NULL |
| rx_cases.seazona_push_error | phi | NULL (can echo the order payload, incl. patient name) |
| client_prices.note | pii | NULL (free text about a client) |

## Tables emptied (DELETE all rows)

| Table | Why |
|---|---|
| rx_case_files | Patient scans/photos/prescriptions/sleep studies; deleting rows removes every GCS reference (`gcs_url`, `original_name`). GCS objects are never touched. |
| sessions | Refresh-token hashes, IPs, user agents. |
| kv_store | Magic links, MFA setup state, temp tokens, rate-limit counters. |
| approval_tokens | One-click approval tokens. |
| invitations | Invitee emails and invite tokens. |

## Kept (judgement calls)

- users with role doctor/admin: email, name; all users: avatar_url, status/role/approval, Seazona link ids (inert: Seazona is disabled in staging).
- accounts: name, slug, owner. doctor_profiles: company name, address, phone, NPI, license. DEVIATION from the strictest reading (addresses/phones scrubbed): accepted as practice business data and public identifiers; only the free-text delivery notes go. A sole practitioner's practice address may also be a home address.
- rx_cases: case_number, practice_name, device_key/category, first_device, records_method, physical_bite, form_type, due_date, rush, status. Non-identifying once names, DOB, contact and free text are gone. Clinical-ish (`physical_bite`) but not linkable to a person.
- rx_code_overrides: only rows whose map_key is a KNOWN catalog-map key (from the DEVICE/MODIFICATION/ATTRIBUTE/LAB_SERVICE/GUARD/ORTHO tables, `known-map-keys.js`) are kept; every other row is DELETED. The key prefixes (`mod:`, `attr:`, `primary:`) are shared by stable slugs and by doctor-typed literals (`mod:<literal>`), so shape cannot tell them apart; this is the "not in the known set" fallback. Consequence: a real lab override on a key the tables no longer emit is also dropped. `note` and the rest of each kept row are lab-staff mapping data.
- invoice_payments, autopay_attempts (allocations are invoice id/number/amount), orders money columns and transaction ids, order_items, catalog and product tables, memberships, app_theme.

## Not in the schema

The plan mentions MFA backup/recovery codes; no such column exists today. If one is added, `plan.test.js` fails until it is classified. The script also checks the live catalog (`pg_attribute`/`pg_class`/`pg_namespace`, relkind r/p/m/f, every non-system schema; only `drizzle.__drizzle_migrations` is ignored), so a table or column present in the database but unknown to the plan aborts the run before anything is changed.

## Operational rule: never serve the database until the scrub exits 0

Crash, `kill`, OOM, Cloud Run Job timeout and connection loss cannot be handled in code (a dead process cannot empty anything; the scrub transaction rolls back, leaving the unscrubbed import in place). They are covered operationally:

- The staging service is not created, or is at 0 max instances / 0 traffic, from the moment prod data lands in `diamond_labs_staging` until `diamond-labs-scrub-staging` exits 0.
- Any non-zero exit means "do not serve": exit 1 = refused, or failed and emptied; exit 2 or a missing "committed" line = possibly unscrubbed. The script prints "staging DB NOT scrubbed — do not serve it; drop or re-run" for every pre-guard failure (module load, config, connection) and for exit 2. If in doubt, drop the database.
- Re-seeding an existing staging: first set `diamond-labs-api-staging` to `--max-instances=0` (or delete the database), then import, migrate, scrub (exit 0), run the catalog import, and only then restore max instances. See Task S5 in the staging plan.
