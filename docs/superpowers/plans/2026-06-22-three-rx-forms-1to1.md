# Three RX Forms — Faithful 1:1 Build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three live JotForms (Digital Rx, Orthodontic Rx, OLMOS Ortho Rx) as faithful, fillable, submittable React forms at `/app/rx/*`, additive to the existing device wizard.

**Architecture:** Definition-driven. Plain-data form definitions ported field-for-field from the committed JotForm JSON snapshots, rendered by one generic `FormRenderer` that reuses the existing field renderers. Generic multipart submit persists to `rx_cases` with new `formType`/`formData` columns. No Seazona mapping involvement.

**Tech Stack:** React + Vite (apps/web), Tailwind, GSAP (existing wizard patterns); Fastify v5 + Drizzle (apps/api); `node --test`; Zod (packages/shared).

## Global Constraints

- Field renderers have ONE source of truth — extract from `DeviceOptionsPanel.jsx`; the device wizard keeps using them unchanged.
- New forms are ADDITIVE. Do NOT modify `RxWizard.jsx`, `rx-devices.js`, the `/rx/cases` device path, or the Seazona approve pipeline.
- New forms NEVER call `device-seazona-map.js` / `rx_code_overrides`. Intake-only; no Seazona write on submit.
- Routes wrapped in existing `RequireDoctor` guard.
- Tests use `node --test` + `node:assert/strict` (no new test deps).
- Tailwind tokens/styling match the existing wizard (`navy`, `brand-500`, `surface-*`, `rounded-xl`/`rounded-2xl`).
- Faithful parity: match each snapshot's meaningful fields (labels/options/order). Any opaque JotForm widget simplified must carry a code comment citing its qid.

---

### Task 1: Extract & extend shared field renderers

**Files:**
- Create: `apps/web/src/components/rx/fields.jsx` (exports `RENDERERS`, `FormField`, `shouldShow`)
- Modify: `apps/web/src/components/rx/DeviceOptionsPanel.jsx` (import renderers from `fields.jsx` instead of defining inline)
- Test: `apps/web/src/components/rx/field-logic.test.js`

**Interfaces:**
- Produces: `shouldShow(field, answers) -> bool`; `FormField({ field, value, onChange, answers }) -> JSX`; `RENDERERS` map keyed by field `type`.
- Reuses existing renderers: radio, checkbox, select, text, textarea, matrix, colorPalette, fileUpload, artboard.
- Adds renderers: `fullname` (→ `{first,last}`), `email`, `phone`, `address` (→ `{office?,street,city,state,zip,country}`), `date`, `heading` (static), `divider` (static), `image` (static, `src`/`alt`), `static` (HTML copy), `signature` (wraps `Signature.jsx` → data URL string).

- [ ] **Step 1:** Move the existing renderer functions (RadioField…ArtboardField) and `shouldShow` out of `DeviceOptionsPanel.jsx` into `fields.jsx`; re-export `RENDERERS`. In `DeviceOptionsPanel.jsx`, import `{ RENDERERS, shouldShow }` from `./fields.jsx`. Add the new renderers listed above. Add `FormField` wrapper that picks the renderer by `field.type`, applies `shouldShow`, and renders the label + required asterisk + note.
- [ ] **Step 2:** Write `field-logic.test.js`: `shouldShow` returns false when `showIf.equals` unmet, true when met, true when no `showIf`; `prefix` operator works.
- [ ] **Step 3:** Run `node --test apps/web/src/components/rx/field-logic.test.js` → PASS.
- [ ] **Step 4:** Sanity: `cd apps/web && pnpm build` compiles (DeviceOptionsPanel still works).
- [ ] **Step 5:** Commit `refactor(rx): extract field renderers to shared module + add form-field types`.

---

### Task 2: Form-definition schema, pure helpers, registry

**Files:**
- Create: `apps/web/src/data/forms/form-fields.js` (shared field builders + common identification block)
- Create: `apps/web/src/data/forms/form-logic.js` (pure helpers)
- Create: `apps/web/src/data/forms/index.js` (registry)
- Test: `apps/web/src/data/forms/form-logic.test.js`

**Interfaces:**
- Definition shape: `{ slug, jotformId, title, route, sections: [{ id, heading?, note?, fields: [field] }] }`.
- Produces in `form-logic.js`:
  - `allFields(form) -> field[]` (flatten, in order)
  - `visibleFields(form, answers) -> field[]` (apply `shouldShow`)
  - `validateForm(form, answers) -> { ok, errors: {key: msg} }` (required + visible only)
  - `buildSubmitFormData({ formType, form, answers, signature }) -> FormData` (text answers as `formData` JSON; fileUpload + artboard + signature appended as files)
- Produces in `form-fields.js`: `idBlock()` returning the shared PATIENT/DOCTOR/contact/date section fields used by ortho+olmos; small builders `radio()`, `checkbox()`, etc. (thin object literals — keep DRY).
- `index.js`: `FORMS = { digital, ortho, olmos }`, `getForm(slug)`.

- [ ] **Step 1:** Write `form-logic.test.js`: validateForm flags a missing required visible field; ignores required fields hidden by showIf; passes when all present. allFields preserves order. buildSubmitFormData puts text answers under `formData` and appends a fileUpload File.
- [ ] **Step 2:** Run test → FAIL (module missing).
- [ ] **Step 3:** Implement `form-logic.js` + `form-fields.js` + empty `index.js` registry skeleton.
- [ ] **Step 4:** Run `node --test apps/web/src/data/forms/form-logic.test.js` → PASS.
- [ ] **Step 5:** Commit `feat(rx): form-definition schema, pure helpers, registry`.

---

### Task 3 / 4 / 5: Port the three form definitions (parallelizable after Task 2)

For each form, port **every meaningful field** from its committed snapshot
(`docs/rx-forms/jotform-api/<file>`), preserving section grouping, order, labels,
options, and conditional logic. Skip pure layout-only `control_divider`/`control_image`
unless they carry instructional copy.

**Task 3 — Digital Rx** — Create `apps/web/src/data/forms/digital-rx.form.js` (from `rx-2025-220598308432154-questions.json`), register `digital`. Test `digital-rx.form.test.js`: parity — meaningful field count ≥ 80; presence of device-selection field + signature + file upload; all keys unique; every field type ∈ supported set.

**Task 4 — Orthodontic Rx** — Create `orthodontic-rx.form.js` (from `orthodontic-213545611846154-questions.json`) using `idBlock()` for the shared block. Test: parity — contains the 29 shared labels + the 11 ortho-only labels (UPPER/Lower Expansion type, Add to Maxillary/Mandibular, Occlusal Options for tandem bow, Digital Study Models, CONTACT/ADDRESS); unique keys.

**Task 5 — OLMOS Rx** — Create `olmos-rx.form.js` (from `olmos-233543911011141-questions.json`) reusing `idBlock()`. Test: parity — contains the 29 shared labels + the 7 OLMOS-only labels (Mx./Md. Expansion type, Add to MX/MD Arch, Dual-Arch Functional Options, Fixed Maxillary Expansion); unique keys; verify MX/MD terminology (not Maxillary/Mandibular) on the OLMOS-specific fields.

Each task: write parity test → run (fail) → author definition → run (pass) → register in `index.js` → commit `feat(rx): port <form> 1:1 form definition`.

---

### Task 6: Generic FormRenderer component

**Files:**
- Create: `apps/web/src/components/rx/FormRenderer.jsx`
- Test: covered by `form-logic.test.js` (pure logic already extracted); component is presentational.

**Interfaces:**
- Consumes: `FormField`, `shouldShow` (Task 1); `allFields`/`visibleFields`/`validateForm`/`buildSubmitFormData` (Task 2).
- Produces: `<FormRenderer form={definition} prefill={{doctorName,practiceName,email,phone}} onSubmit={(formData)=>Promise} submitting={bool} />`.

- [ ] **Step 1:** Build sectioned multi-step renderer: one step per section (or grouped), Back/Next, inline required errors from `validateForm`, final Review step listing answers, Submit calls `onSubmit(buildSubmitFormData(...))`. Match wizard Tailwind + GSAP step transition patterns from `RxWizard.jsx`.
- [ ] **Step 2:** `cd apps/web && pnpm build` compiles.
- [ ] **Step 3:** Commit `feat(rx): generic FormRenderer`.

---

### Task 7: Pages, routes, chooser, nav

**Files:**
- Create: `apps/web/src/pages/app/RxFormPage.jsx`, `apps/web/src/pages/app/RxChooserPage.jsx`
- Modify: `apps/web/src/config/routes.js` (add `RX_CHOOSER`, `RX_DIGITAL`, `RX_ORTHO`, `RX_OLMOS`)
- Modify: `apps/web/src/App.jsx` (mount the 4 routes under `RequireDoctor`)
- Modify: doctor nav/sidebar to link `/app/rx`

**Interfaces:**
- `RxFormPage` reads `:slug` (or per-route prop), `getForm(slug)`, pulls prefill from auth store, renders `FormRenderer` with `onSubmit` → api client (Task 10).
- `RxChooserPage` cards linking the three forms.

- [ ] **Step 1:** Add route constants + mounts + chooser + nav link.
- [ ] **Step 2:** `pnpm build` compiles; routes resolve.
- [ ] **Step 3:** Commit `feat(rx): /app/rx chooser + three form routes`.

---

### Task 8: Backend migration + schema (formType / formData; nullable device cols)

**Files:**
- Modify: `apps/api/src/db/schema/rx-cases.js`
- Create: migration via `cd apps/api && pnpm db:generate` (→ `drizzle/0009_*.sql`)

- [ ] **Step 1:** In `rx-cases.js`: add `formType: varchar('form_type', {length:40}).default('digital')`, `formData: jsonb('form_data')`; change `deviceKey`/`deviceCategory` to nullable (drop `.notNull()`).
- [ ] **Step 2:** `cd apps/api && pnpm db:generate` → review generated SQL (adds cols, alters nullability). 
- [ ] **Step 3:** `pnpm db:migrate` against local DB → succeeds.
- [ ] **Step 4:** Commit `feat(rx): rx_cases form_type/form_data columns + nullable device cols (migration 0009)`.

---

### Task 9: Generic submit schema + endpoint

**Files:**
- Modify: `packages/shared/src/schemas/rx.schema.js` (add `rxFormSubmitSchema`, export)
- Modify: `apps/api/src/routes/rx.routes.js` (add `POST /rx/form-submissions`)
- Test: `apps/api/src/routes/__tests__/rx-form-submit.test.js`

**Interfaces:**
- `rxFormSubmitSchema = z.object({ formType: z.enum(['digital','ortho','olmos']), patientFirst: z.string().min(1).max(120), patientLast: z.string().min(1).max(120), formData: z.record(z.unknown()).default({}), dueDate: z.string().max(30).optional(), signatureUrl: z.string().optional() })`.
- Endpoint mirrors `/rx/cases` multipart parsing + file upload + atomic insert, but writes `formType`, `formData`, `deviceKey=null`, `deviceCategory=null`, `status='pending_approval'`; NO Seazona call. Returns `{ data: { id, caseNumber, status } }`.

- [ ] **Step 1:** Write `rx-form-submit.test.js`: valid payload parses; missing `patientFirst` rejected; `formType` outside enum rejected; `formData` defaults to `{}`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add schema; add endpoint (reuse existing multipart/upload/transaction helpers from `/rx/cases`).
- [ ] **Step 4:** Run `node --test apps/api/src/routes/__tests__/rx-form-submit.test.js` → PASS.
- [ ] **Step 5:** Commit `feat(rx): generic form-submission endpoint + schema`.

---

### Task 10: Wire frontend submit + end-to-end smoke

**Files:**
- Modify: `apps/web/src/pages/app/RxFormPage.jsx` (onSubmit → POST `/api/v1/rx/form-submissions` via existing api client, multipart)

- [ ] **Step 1:** Implement `onSubmit(formData)` → api client multipart POST; success → confirmation screen (caseNumber); error → inline message.
- [ ] **Step 2:** `pnpm build` (web) + start API+web locally; manually submit each of the three forms; confirm a `rx_cases` row with correct `formType`/`formData` and any files in `rx_case_files`.
- [ ] **Step 3:** Commit `feat(rx): wire faithful forms to submission endpoint`.

---

### Task 11: Full verification + PR

- [ ] **Step 1:** Run all tests: `node --test` across `apps/web/src/**/*.test.js` and `apps/api/src/**/*.test.js`; `pnpm build` both apps; lint if configured.
- [ ] **Step 2:** Push branch; open PR with summary + test evidence; watch CI; fix failures; merge.

## Self-Review notes

- Spec coverage: schema (T2), renderer reuse (T1), three forms (T3-5), routes/chooser (T7), backend formType/formData + endpoint (T8-9), tests (each task + T11), no-Seazona / additive constraints (Global + T9). Covered.
- Parallelism: T3/T4/T5 independent after T2; T8/T9 independent of frontend.
