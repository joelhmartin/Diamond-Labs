# Digital Rx → Seazona Order Pipeline — Design Spec

**Date:** 2026-06-15
**Status:** Design (pre-plan)
**Goal:** Take the Digital Rx wizard from a UI-only mock to a pipeline that is **fully ready to test via dry runs** — a doctor submits a case, it is stored locally as the authoritative record, files land in GCS, and a dry-run builder produces the exact Seazona `createOrder` payload, which we **diff against real hand-made orders** to prove coverage. **No live writes to Seazona** until explicit sign-off.

---

## 1. Background & authoritative sources

The lab currently receives a JotForm submission per case and **re-enters it into Seazona by hand**. We are replacing the JotForms. The authoritative sources for "what a case must contain" are:

1. **JotForm source exports** (in `~/…/DIAMOND LABS/Forms/`, also a copy of one in repo root):
   - **Orthotic Lab Rx 2025** — form `220598308432154` — TMD/Olmos + Sleep + Guards + Sport.
   - **Orthodontic Rx** — form `213545611846154` — ortho appliances (expanders, tandem, twin block, bands, screws).
   - *(New Client Account `220535354143145` and Shipping Request `252404790475157` exist but are **out of scope** for the order pipeline.)*
2. **`apps/web/public/downloads/Digital-Rx-Instructions-2022.pdf`** — 12-page guide with screenshots of the actual form (canonical option values).
3. **Live Seazona orders** (`GET /v1/orders/:id`) — 16+ studied. The target output shape.

### Real Seazona order shape (the target)
`{ clientId, patient, products[], settings[], files[], notes, due, isRemake, status, department, assignedTo }`
- `products[]`: `{ id, code, name, taxable, price, tooth, arch }` — **appliance + add-on components + lab services** (Digital Model Fabrication ×2 arches, Articulate Models, Model Duplication, Impression Pour Up), each a separate line item.
- `settings[]`: `{ name, value }` — sparse structured options (e.g. `Occlusal Contact: Posterior`, `Design Specifications: Buccal-Free`).
- `files[]`: `{ name, originalName, url, extension, size }` — uploaded PDF(s) on S3.
- `notes`: free-text HTML — carries most fabrication detail.

### Our `createOrder` wrapper sends only
`{ clientId, patientName, due, items:[{id, arch}], notes, userId }` — **no settings, no files, no tooth, no status**. Whether the endpoint accepts more is an open question (see §10), resolvable only by one controlled live write.

---

## 2. Scope

**In scope**
- Reconcile/extend the wizard (`rx-devices.js`) to **both** device Rx forms, with canonical option values.
- New local data model for Rx cases (authoritative, local-first).
- Versioned device→Seazona-product **mapping file**.
- Pure **payload builder** (case → `createOrder` payload).
- **GCS** file upload.
- Authenticated **doctor-portal submit** + **pending-approval** lifecycle.
- Ortho **Artboard** (in-browser drawing canvas).
- **Dry-run harness**: build payloads + diff against real orders → coverage report.

**Out of scope (separate work)**
- New Client Account form, Shipping Request form.
- Actually pushing `createOrder` to production Seazona (gated; dark until sign-off).
- Billing/pricing of the case (Seazona prices it; we don't charge at submit).

---

## 3. Field corrections the wizard needs (from canonical sources)

| Field | Wizard today | Canonical |
|---|---|---|
| Occlusal Contact | Tripod / Full Coverage / Variable | **Posterior / Anterior / Full / Tripod / Tripod+1** |
| Design Preference | Standard / Min Vertical / Max Retention | **Standard / Lingual-Free / Buccal-Free / Full Coverage** |
| DDSO material | "MED-Grade Nylon PA12" only | **Nylon / Biomed** |
| ON design material | (varies) | **Nylon / PMT (Diamoform) / Biomed / Dual-Laminate / Acrylic w/Clasps** |
| Titration | single text field | **band matrix**: Wide/Blue/Orange (stiffness) × 17–21mm × qty |
| Records method | missing | **Physical Bite / PVS / Stone-Resin / 3Shape / Carestream / CEREC / iTero / Medit / Midmark / Other-STL** |
| Physical-bite handling | Yes/No only | **No-start-digital / Wait-for-physical / Start-digital-verify-physical** |
| Ship-to address | missing | **Office name + street/city/state/zip/country** (if different from account) |
| Rush tier | flat | **Nylon +$150 / Biomed-PMT-Acrylic +$75** |

### New category: Orthodontic (`ortho`)
The wizard has **no** ortho appliances; these are common in real orders. Add:
- **Appliance type:** Modified Tandem / Twin Block / other
- **Retention/fab:** Fixed (Banded) / Fixed 3D-Printed Bands / Acrylic w/ clasp / Printed Nylon w/ composite
- **Expansion screw:** No Expansion / Slim-Line / Standard Transverse / Variety-Click / Memory / Hyrax RPE / NiTi
- **Upper & Lower expansion** matrices; **Removable vs Fixed** mandibular expansion
- **Modifications** (large list): buccal tubes to bands, palatal pads, anterior lap springs, buccal hooks for tandem elastics, lingual guide arms (canine/distal), labial bow, transfer tray for composite buttons, occlusal rests, finger springs, sheaths for tandem bow…
- **NUVELO Digital Setup** (digital models only — horseshoe / ABO full base)
- **Artboard** (draw-your-appliance) — full canvas (per decision).

---

## 4. Architecture (units)

1. **`rx-devices.js` reconciliation/extension** — canonical option-sets + `ortho` category. Pure data; the renderer (`DeviceOptionsPanel`) already walks the schema.
2. **Data model** — `rx_cases` (one row per submitted case) + `rx_case_files` (uploaded artifacts). Authoritative locally; `status` lifecycle in §6.
3. **Mapping file** — `apps/api/src/services/rx/device-seazona-map.js` (versioned). Maps device + material + modifications + add-ons + lab-services → `{ seazonaProductCode/id, arch, perTooth? }`. Unmapped → flagged (never guessed).
4. **Payload builder** — `buildSeazonaOrderPayload(rxCase)` pure fn → `{ clientId, patientName, due, items[], notes, userId }`. Compiles occlusal/design/titration/modifications/comments + records-method + physical-bite + rush into `notes` (until/unless Seazona accepts `settings`). Returns `{ payload, unmapped[], warnings[] }`.
5. **File storage** — GCS bucket; upload on submit; persist URLs/metadata on `rx_case_files`. (Attachment INTO Seazona deferred to live-write probe.)
6. **Submit route** — `POST /api/v1/rx/cases` (auth doctor, approved). Validates, stores `pending_approval`, uploads files. `clientId` derived from `request.user.seazonaClientId` — never client-supplied.
7. **Approve action** — `POST /api/v1/rx/cases/:id/approve` → builds payload; **DRY_RUN by default** (logs/returns payload, sets `seazonaPushStatus` accordingly); live push stays gated behind the same production flags as the shop (`AUTHORIZE_NET_ENV`/explicit enable) **plus** an Rx-specific kill switch.
8. **Wizard wiring** — move the wizard into the authenticated doctor portal; prefill doctor from account; replace mock `handleSubmit` with the real call. Marketing page becomes a teaser → login.
9. **Artboard** — in-browser canvas on a tooth-chart/arch background; exports PNG → uploaded as a case file.
10. **Dry-run harness** — `pnpm rx:dryrun` script: take sample/fixture cases → `buildSeazonaOrderPayload` → pull matching real orders (read-only) → diff line items + report coverage, unmapped items, and field gaps.

---

## 5. Data flow

Doctor (portal, authenticated) → fills wizard (both form families) → `POST /rx/cases` →
files to GCS, case row `pending_approval` → doctor/lab reviews → `approve` →
`buildSeazonaOrderPayload` → **DRY_RUN**: payload logged + stored, diffable against real orders.
(Live `createOrder` push: dark until sign-off; when enabled, reuses the shop's gated-push + `[Seazona][...]` alerting pattern.)

---

## 6. Case lifecycle (`rx_cases.status`)

`pending_approval` → `approved` → (`pushed` | `push_failed` | `push_skipped_dryrun`).
Mirrors the shop `orders.seazonaPushStatus` model so reconcile/alerting are consistent. The "pending approval" gate is **local** — it does not depend on Seazona accepting a pending state.

---

## 7. Data model (draft)

**`rx_cases`**: id, userId, seazonaClientId, seazonaAccountNumber, patientFirst, patientLast, dob, gender, firstDevice(bool), contactPhone, shipTo(jsonb), recordsMethod, physicalBite(enum), deviceKey, deviceCategory, deviceOptions(jsonb), dueDate, rush(bool), rushTier, signature(text/url), generalComments(text), status, seazonaPushStatus, seazonaOrderId, seazonaPushError, payloadSnapshot(jsonb), createdAt, updatedAt.

**`rx_case_files`**: id, caseId, kind(enum: scan|photo|prescription|sleep_study|artboard), originalName, gcsUrl, contentType, size, createdAt.

---

## 8. Mapping file design

A device + its chosen material/modifications resolves to **multiple** Seazona line items:
- 1 primary appliance code (depends on device + material).
- N add-on codes (per selected modification: clasps, ramps, pads, screws, bows, hooks, bands…).
- Lab-service codes the lab routinely adds (model fab per arch, articulate, duplication) — **policy decision in plan**: include vs leave for lab intake.

Each entry: `{ code, name, arch?, perTooth?, condition }`. Built from the 392-item catalog + observed real-order line patterns. Unmapped selections produce a flagged warning surfaced by the dry-run; we never guess a code at push time.

---

## 9. Dry-run / matching harness

- `buildSeazonaOrderPayload` is pure and unit-testable.
- Harness pulls real orders (read-only, by date/appliance), picks comparables, and diffs generated `items[]` vs real `products[]` (by code/name), reporting: matched, missing-from-ours, extra-in-ours, unmapped, and notes-field completeness.
- Output: a coverage report the lab can eyeball ("for a DDSO Nylon Anterior, we generate codes X/Y/Z; the lab's hand order had X/Y/Z/W — W is the model-fab line we chose to omit").
- Runs entirely offline of any Seazona write.

---

## 10. Open items requiring ONE controlled live write (held for sign-off)

- Does `POST /v1/orders/` accept `settings[]`, file attachments, `tooth`, and an initial `status`/hold? Test against the "Dr. Patient Orders" client.
- Until answered, structured options are compiled into `notes` and files are GCS-staged (not attached).

---

## 11. Assets

- Reference images pulled from the export live in `docs/rx-forms/jotform-images/` (clasp chart, tandem diagrams). Per-option tooth diagrams are widget-served (not in export) — obtain from live widget config or crop from the PDF (task in plan).

---

## 12. Non-goals / constraints

- **No production Seazona writes** until explicit sign-off (build-cadence rule).
- No charging/billing at submit.
- No mapping guesses at push time — unmapped is a hard flag.
- Reuse existing patterns: gated push + `seazonaPushStatus`, `[Seazona]` alerting, GCS via GCP (we're already all-GCP).
