# Staging scrub: column classification

Source of truth is `plan.js` (data) and `plan.test.js` (fails if any schema column is unclassified). This file explains the reasoning. Run with `pnpm --filter @my-app/api db:scrub-staging`; it only runs against `current_database() = 'diamond_labs_staging'` with `APP_ENV=staging`.

Classes: **keep** (copied), **phi** (patient health info/identity), **pii** (customer or free-text personal data), **secret** (credentials, tokens, payment profiles), **reset** (operational state neutralised). Everything not "keep" is overwritten in one transaction. Encrypted PHI is never decrypted; it is replaced (staging has a different key). Doctor and practice names and emails are kept by design (mail is redirected, no password survives).

## Rewritten columns

| Table.column | Class | Becomes |
|---|---|---|
| users.password_hash | secret | NULL |
| users.mfa_secret | secret | NULL |
| users.mfa_enabled | reset | false |
| users.authorize_net_customer_profile_id | secret | NULL (prod CIM ids must never reach sandbox) |
| users.default_payment_profile_id | secret | NULL |
| accounts.settings | pii | `{}` (free-form jsonb) |
| audit_log.metadata | pii | `{}` (free text: notes, names, emails) |
| audit_log.ip_address | pii | NULL |
| doctor_profiles.delivery_notes | pii | NULL (free text, could name a patient) |
| autopay_enrollments.enabled | reset | false |
| autopay_enrollments.payment_profile_id | secret | `'SCRUBBED'` (NOT NULL) |
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

- users: email, name, avatar_url, status/role/approval, Seazona link ids (inert: Seazona is disabled in staging).
- accounts: name, slug, owner. doctor_profiles: company name, address, phone, NPI, license (practice business data and public identifiers; only the free-text delivery notes go).
- rx_cases: case_number, practice_name, device_key/category, first_device, records_method, physical_bite, form_type, due_date, rush, status. Non-identifying once names, DOB, contact and free text are gone. Clinical-ish (`physical_bite`) but not linkable to a person.
- rx_case_lines.source_label: the doctor's literal product/option selection. rx_code_overrides.note: lab-staff mapping rationale about product codes. Neither is patient text by design; neither is enforced. Revisit if that stops being true.
- invoice_payments, autopay_attempts (allocations are invoice id/number/amount), orders money columns and transaction ids, order_items, catalog and product tables, memberships, app_theme.

## Not in the schema

The plan mentions MFA backup/recovery codes; no such column exists today. If one is added, `plan.test.js` fails until it is classified. The script also checks the live database catalog, so a table or column present in the database but unknown to the plan aborts the run before anything is changed.
