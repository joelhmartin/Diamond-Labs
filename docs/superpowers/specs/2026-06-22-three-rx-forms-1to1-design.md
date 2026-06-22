# Three RX Forms — Faithful 1:1 Build

**Date:** 2026-06-22
**Status:** Approved (design direction confirmed by user; full autonomy through PR/merge granted)
**Branch:** `rx-forms-1to1`

## Goal

Build the three canonical live JotForms as complete, fillable, submittable React
experiences inside our app, so the lab can test-drive each form end-to-end. Match
each live JotForm **field-for-field** (same questions, options, sections, order),
rendered in our existing wizard/component style. Automated full-submission tests
are a secondary deliverable.

## The three forms (confirmed live via JotForm HIPAA API)

| Slug | JotForm ID | Title | Fields (meaningful) | Snapshot |
|---|---|---|---|---|
| `digital` | 220598308432154 | Diamond Orthotic Lab Rx. 2025 | 81 | `docs/rx-forms/jotform-api/rx-2025-220598308432154-questions.json` |
| `ortho` | 213545611846154 | Diamond Orthodontic Rx. | 52 | `docs/rx-forms/jotform-api/orthodontic-213545611846154-questions.json` |
| `olmos` | 233543911011141 | OLMOS - Orthodontic Rx. | 48 | `docs/rx-forms/jotform-api/olmos-233543911011141-questions.json` |

Ortho and OLMOS are near-twins (29 identical fields; differences are mostly
Maxillary/Mandibular ↔ MX/MD wording plus ~7 device-specific options each). They
share a field/section library underneath. Digital Rx is the larger device-selection
form.

## Non-goals / explicit exclusions

- **No Seazona auto-mapping / pre-fill** in these forms. They render ALL fields
  independent of `device-seazona-map.js` / `rx_code_overrides`. (User: "I don't
  want all these different options on the backend for the tests.")
- **Do not touch** the existing device wizard (`/app/cases/new`, `RxWizard.jsx`,
  `rx-devices.js`) or the Seazona approve pipeline. The new forms are **additive**.
  The legacy device flow and its Seazona push remain until the lab signs off on a
  switch (see `feedback_build_cadence`).
- No reverse-engineering of JotForm widget internals beyond their visible
  label/options. Where a JotForm `control_widget` is an opaque configurator, we
  represent the same captured data with our existing field types.

## Architecture

Definition-driven. A **form definition** is plain data; a **generic renderer**
walks it. Three hand-authored definitions ported faithfully from the JSON snapshots.

### 1. Form-definition schema (`apps/web/src/data/forms/`)

```
form = {
  slug, jotformId, title, route,
  sections: [ { id, heading?, note?, fields: [field, ...] }, ... ],
}
```

`field` extends the existing vocabulary. Supported `type`s:

- Existing (reused from DeviceOptionsPanel): `radio`, `checkbox`, `select`,
  `text`, `textarea`, `matrix`, `colorPalette`, `fileUpload`, `artboard`.
- New (needed for faithful parity): `fullname` (first/last), `email`, `phone`,
  `address` (multi-part), `date`, `heading` (static section head), `divider`,
  `image` (static reference image), `signature` (wraps existing Signature.jsx),
  `static` (HTML "Please note" copy).

Common keys: `key` (unique within form), `label`, `required?`, `options?`,
`placeholder?`, `note?`, `showIf?` (`{ key, equals | prefix }` — existing
semantics), `columns?`/`rows?` (matrix), `accept?`/`maxFiles?` (fileUpload).

Files:
- `form-fields.js` — shared field builders + the common identification block
  (PATIENT / DOCTOR / dates / records / signature) used by ortho + olmos.
- `digital-rx.form.js`, `orthodontic-rx.form.js`, `olmos-rx.form.js`
- `index.js` — registry: `slug -> { definition, title, route }`.

### 2. Generic renderer (`apps/web/src/components/rx/FormRenderer.jsx`)

- Walks `sections`, renders each via reused field renderers.
- Extracts the field renderers from `DeviceOptionsPanel.jsx` into a shared
  `renderField` / `RENDERERS` export so there is ONE source of truth (the device
  wizard keeps using it unchanged).
- Adds renderers for the new field types listed above.
- Handles `showIf` conditional visibility, required-field validation, and
  collects answers into a flat `{ [field.key]: value }` map.
- Multi-step: paginate by section (or group of sections) with Back/Next + a final
  Review step, matching the existing wizard's stepper UX and Tailwind styling.
- On submit, builds `FormData` (text answers JSON + files + signature PNG) and
  POSTs to the generic endpoint.

### 3. Routes (`apps/web/src/config/routes.js` + `App.jsx`)

- `RX_CHOOSER: /app/rx` — landing chooser linking the three forms.
- `RX_DIGITAL: /app/rx/digital`, `RX_ORTHO: /app/rx/ortho`, `RX_OLMOS: /app/rx/olmos`.
- All wrapped in the existing `RequireDoctor` guard (consistent with `/app/cases/new`).
- One `RxFormPage` component resolves the form by slug from the registry and renders
  `FormRenderer`. One `RxChooserPage` for the landing.

### 4. Backend (`apps/api`)

- **Migration 0009**: `rx_cases` add `form_type varchar(40)` (default `'digital'`
  for existing rows) and `form_data jsonb`; make `device_key` / `device_category`
  **nullable** (generic forms don't set them).
- **Schema** (`rx-cases.js`): reflect the new/relaxed columns.
- **Submit endpoint**: `POST /api/v1/rx/form-submissions` (auth: `authenticate` +
  `requireApprovedDoctor`, mirroring `/rx/cases`). Multipart. Validates a new
  `rxFormSubmitSchema` (`packages/shared/src/schemas/rx.schema.js`):
  `{ formType: enum(['digital','ortho','olmos']), patientFirst, patientLast,
  formData: record(unknown), dueDate?, signatureUrl? }`. Files reuse
  `storage.service` + `rx_case_files`. Persists one `rx_cases` row with
  `formType`, `formData`, patient name, `status='pending_approval'`,
  `deviceKey/deviceCategory = null`. **No Seazona call** (these are intake-only).
- The existing `/rx/cases` device path and approve/Seazona pipeline are unchanged.

### 5. Tests

- **Form-definition integrity** (`apps/web/src/data/forms/*.test.js`, `node --test`):
  every field has a unique `key`, valid `type`, options present where required;
  each form's field count/labels match the snapshot's meaningful fields (parity
  guard against drift); shared ortho/olmos block is identical where expected.
- **Generic submit** (`apps/api/src/routes/__tests__/` or service-level,
  `node --test`): a faithful filled payload for each formType validates against
  `rxFormSubmitSchema` and produces the expected persisted shape (patient name +
  formData round-trip; required-field rejection).
- Frontend renderer logic that is pure (showIf evaluation, validation, FormData
  assembly) extracted into testable helpers and unit-tested.

## Data flow

```
doctor → /app/rx/<slug> → RxFormPage → FormRenderer(definition)
  → fill sections (showIf, validation) → Review
  → POST /api/v1/rx/form-submissions (multipart: formType, patient, formData JSON, files, signature)
  → validate rxFormSubmitSchema → upload files (GCS) → insert rx_cases (formType, formData)
  → { id, caseNumber, status: 'pending_approval' }
```

## Error handling

- Renderer: inline required-field errors per step; block Next/Submit until valid.
- Endpoint: mirrors `/rx/cases` — file-size/count limits, atomic insert, on failure
  delete uploaded files, 500 with logged error; 400 on schema validation failure.

## Risks / mitigations

- **Faithful porting accuracy** — the bulk risk. Mitigation: port directly from the
  committed JSON snapshots; parity test asserts field labels/count vs snapshot.
- **Widget opacity** — represent captured data with existing field types; note any
  widget simplified in a code comment referencing the qid.
- **Two parallel form systems** — intentional and reversible; documented here.
  Decommissioning the legacy wizard is out of scope for this PR.
```
