# Digital Rx → Seazona Order Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the Digital Rx wizard from a UI-only mock to a pipeline that is fully ready to test via **dry runs diffed against real hand-made Seazona orders**, with **zero live writes** to Seazona until sign-off.

**Architecture:** Local-first. An authenticated doctor submits a case → stored in `rx_cases` (+ files in GCS) as `pending_approval` → an `approve` action runs a pure `buildSeazonaOrderPayload()` that turns the case into the exact `createOrder` payload using a versioned device→Seazona-product map → a dry-run harness diffs generated payloads against real orders and reports coverage. Live `createOrder` push is built but gated dark.

**Tech Stack:** Fastify v5 + Drizzle (Postgres), React + Vite wizard, GCS for files, Node built-in `node --test` for tests (no new dep). JotForm HIPAA API is the authoritative source for form defs (committed under `docs/rx-forms/`).

**Canonical forms:** Rx 2025 (`220598308432154`) + Orthodontic Rx (`213545611846154`). Authoritative defs: `docs/rx-forms/jotform-api/*-questions.json`. Option images: `docs/rx-forms/jotform-images/options/`.

---

## File structure

**Frontend (`apps/web/`)**
- `src/data/rx-devices.js` — MODIFY: canonical option-sets + new `ortho` category + MORA/ARA; add `seazonaHints` per option (free-text the payload builder can use).
- `src/data/rx-records.js` — CREATE: records-method, physical-bite, rush-tier, first-device option lists (shared by wizard).
- `src/components/rx/Artboard.jsx` — CREATE: canvas drawing on an arch background → PNG.
- `src/components/rx/DeviceOptionsPanel.jsx` — MODIFY: render `colorPalette`, `matrix`, `artboard` field types already referenced.
- `src/pages/app/NewCasePage.jsx` — CREATE: authenticated wizard host (reuses the existing wizard component).
- `src/pages/marketing/CaseSubmission.jsx` — MODIFY: extract the wizard into a shared component; marketing page becomes a teaser linking to the authed page.
- `src/config/routes.js` — MODIFY: add `/app/cases/new`.
- `public/images/rx/options/` — CREATE: option images copied from `docs/rx-forms/jotform-images/options/`.

**Backend (`apps/api/`)**
- `src/db/schema/rx-cases.js` — CREATE: `rx_cases` + `rx_case_files` tables.
- `src/db/schema/index.js` — MODIFY: export the new tables.
- `src/services/rx/device-seazona-map.js` — CREATE: versioned mapping + `resolveLineItems()`.
- `src/services/rx/build-order-payload.js` — CREATE: pure `buildSeazonaOrderPayload()`.
- `src/services/rx/build-order-payload.test.js` — CREATE: `node --test`.
- `src/services/rx/device-seazona-map.test.js` — CREATE: `node --test`.
- `src/services/storage.service.js` — CREATE: GCS upload (local-disk fallback in dev).
- `src/routes/rx.routes.js` — CREATE: `POST /rx/cases`, `GET /rx/cases`, `GET /rx/cases/:id`, `POST /rx/cases/:id/approve`.
- `src/index.js` — MODIFY: register `rxRoutes`.
- `scripts/rx-dryrun.mjs` — CREATE: dry-run harness (diff vs real orders).
- `src/services/rx/order-diff.js` + `.test.js` — CREATE: pure diff used by the harness.
- `package.json` — MODIFY: add `"rx:dryrun"`, `"test"` scripts.

---

## Phase 1 — Wizard data reconciliation (frontend, pure data)

### Task 1.1: Canonical records/rush/first-device lists

**Files:** Create `apps/web/src/data/rx-records.js`; Test `apps/web/src/data/rx-records.test.js`

- [ ] **Step 1: Write the failing test**
```js
// apps/web/src/data/rx-records.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECORDS_METHODS, PHYSICAL_BITE, FIRST_DEVICE, RUSH_TIERS } from "./rx-records.js";

test("records methods match the canonical 12", () => {
  assert.equal(RECORDS_METHODS.length, 12);
  for (const m of ["Physical Bite Registration", "3SHAPE", "SHINING 3D", "PLANMECA", "ALL OTHER SCANNERS"])
    assert.ok(RECORDS_METHODS.some((r) => r.label === m), `missing ${m}`);
});
test("first-device has 3 options incl previous/new records", () => {
  assert.deepEqual(FIRST_DEVICE, ["Yes", "No, use PREVIOUS RECORDS", "No, use NEW RECORDS"]);
});
test("physical-bite has the 3 canonical handling options", () => {
  assert.equal(PHYSICAL_BITE.length, 3);
});
test("rush tiers carry per-material price + label", () => {
  assert.ok(RUSH_TIERS.nylon.price === 150 && RUSH_TIERS.biomedPmtAcrylic.price === 75);
});
```

- [ ] **Step 2: Run it, verify it fails**
Run: `node --test apps/web/src/data/rx-records.test.js`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement**
```js
// apps/web/src/data/rx-records.js
// Canonical option lists shared across the wizard. Sourced from the JotForm
// Rx 2025 defs (docs/rx-forms/jotform-api/rx-2025-220598308432154-questions.json).
export const RECORDS_METHODS = [
  { value: "physical_bite", label: "Physical Bite Registration", img: "/images/rx/options/bite_150.png" },
  { value: "pvs", label: "PVS Impressions", img: "/images/rx/options/PVS_150.png" },
  { value: "stone_resin", label: "Stone/Resin Models", img: "/images/rx/options/model_150.png" },
  { value: "3shape", label: "3SHAPE", img: "/images/rx/options/3shape.png" },
  { value: "carestream", label: "CARESTREAM", img: "/images/rx/options/carestream.png" },
  { value: "cerec", label: "CEREC", img: "/images/rx/options/cerec.png" },
  { value: "itero", label: "ITERO", img: "/images/rx/options/itero.png" },
  { value: "medit", label: "MEDIT", img: "/images/rx/options/medit.png" },
  { value: "midmark", label: "MIDMARK", img: "/images/rx/options/midmark.png" },
  { value: "shining3d", label: "SHINING 3D", img: "/images/rx/options/shining.png" },
  { value: "planmeca", label: "PLANMECA", img: "/images/rx/options/planmeca.png" },
  { value: "other_scanner", label: "ALL OTHER SCANNERS", img: "/images/rx/options/all.png" },
];
export const PHYSICAL_BITE = [
  { value: "no_digital", label: "No — start case now with digital bite" },
  { value: "wait_physical", label: "Yes — wait until physical bite is received (production won't start until received)" },
  { value: "start_verify", label: "Yes — start with digital bite; verify with physical bite" },
];
export const FIRST_DEVICE = ["Yes", "No, use PREVIOUS RECORDS", "No, use NEW RECORDS"];
export const RUSH_TIERS = {
  nylon: { label: "Nylon devices", price: 150 },
  biomedPmtAcrylic: { label: "Biomed / PMT / Acrylic", price: 75 },
};
```

- [ ] **Step 4: Run test, verify PASS**
Run: `node --test apps/web/src/data/rx-records.test.js` → PASS

- [ ] **Step 5: Copy option images into public assets**
```bash
mkdir -p apps/web/public/images/rx/options
# copy + normalize filenames (strip jotform hashes) for the assets the lists reference
node scripts/copy-rx-option-images.mjs   # created in Step 6
```

- [ ] **Step 6: Write the image-copy helper** (`scripts/copy-rx-option-images.mjs`)
```js
import { readdirSync, copyFileSync, mkdirSync } from "fs";
const src = "docs/rx-forms/jotform-images/options";
const dst = "apps/web/public/images/rx/options";
mkdirSync(dst, { recursive: true });
// Map hashed jotform filenames → stable names used by rx-records.js / rx-devices.js.
const map = {
  "bite_150": "bite_150.png", "PVS_150": "PVS_150.png", "model_150": "model_150.png",
  "3shape_": "3shape.png", "carestream_": "carestream.png", "cerec_": "cerec.png",
  "itero_": "itero.png", "medit_": "medit.png", "midmark_": "midmark.png",
  "shining": "shining.png", "planmeca": "planmeca.png", "all.": "all.png",
  "ddso_post": "ddso_post.png", "ddso_anterior": "ddso_anterior.png",
  "ddso_full": "ddso_full.png", "ddso_tripod": "ddso_tripod.png",
  "Standard.": "design_standard.png", "buccalfree": "design_buccalfree.png",
  "Full_20Coverage": "design_full.png",
};
for (const f of readdirSync(src)) {
  const key = Object.keys(map).find((k) => f.startsWith(k));
  if (key) copyFileSync(`${src}/${f}`, `${dst}/${map[key]}`);
}
console.log("copied rx option images");
```
Run: `node scripts/copy-rx-option-images.mjs`

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/data/rx-records.js apps/web/src/data/rx-records.test.js scripts/copy-rx-option-images.mjs apps/web/public/images/rx
git commit -m "feat(rx): canonical records/rush/first-device lists + option image assets"
```

### Task 1.2: Reconcile `rx-devices.js` option-sets to canonical

**Files:** Modify `apps/web/src/data/rx-devices.js`; Test `apps/web/src/data/rx-devices.test.js`

- [ ] **Step 1: Write the failing test** (asserts the corrected values from the authoritative defs)
```js
// apps/web/src/data/rx-devices.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { RX_DEVICES } from "./rx-devices.js";
const byKey = Object.fromEntries(RX_DEVICES.map((d) => [d.key, d]));

test("occlusal contact uses canonical 4 (no Tripod+1/Variable)", () => {
  const ddso = byKey["ddso"];
  assert.deepEqual(ddso.options.occlusalContact.options, ["Posterior", "Anterior", "Full", "Tripod"]);
});
test("design preference is the canonical 4", () => {
  assert.deepEqual(byKey["ddso"].options.designPreference.options,
    ["Standard", "Lingual-Free", "Buccal-Free", "Full Coverage"]);
});
test("DDSO base material is Nylon/Biomed", () => {
  assert.deepEqual(byKey["ddso"].options.baseMaterial.options, ["Nylon", "Biomed"]);
});
test("OD base material is the canonical 6", () => {
  assert.deepEqual(byKey["olmos-day"].options.baseMaterial.options,
    ["OD (PMT)", "OD BIOFLEX", "Printed Nylon", "Acrylic w/clasps", "Dual-Laminate", "Milled"]);
});
test("MORA and ARA exist in tmd category", () => {
  assert.ok(byKey["mora"] && byKey["mora"].category === "tmd");
  assert.ok(byKey["ara"] && byKey["ara"].category === "tmd");
});
```

- [ ] **Step 2: Run, verify FAIL**
Run: `node --test apps/web/src/data/rx-devices.test.js` → FAIL.

- [ ] **Step 3: Edit `rx-devices.js`** — apply the corrections (replace the constants):
```js
const OCCLUSAL_CONTACT = ["Posterior", "Anterior", "Full", "Tripod"];
const DESIGN_PREFERENCES = ["Standard", "Lingual-Free", "Buccal-Free", "Full Coverage"];
```
Update `OLMOS_DAY_OPTIONS.baseMaterial.options` →
`["OD (PMT)", "OD BIOFLEX", "Printed Nylon", "Acrylic w/clasps", "Dual-Laminate", "Milled"]`.
Update `OLMOS_NIGHT_OPTIONS.variant.options` →
`["Deprogrammer ON-D (Anterior)", "Positioner ON-P (Anterior)", "Titration ON-T (Nylon only)", "Ramp ON-R (Anterior)"]`.
Update `DDSO_OPTIONS.baseMaterial.options` → `["Nylon", "Biomed"]`.
Update titration field to a matrix:
```js
titration: { type: "matrix", label: "Additional titration (bands)",
  rows: ["Wide (Rigid)", "Blue (Medium)", "Orange (Soft)"], columns: ["17", "18", "19", "20", "21", "Qty"] },
```
Add MORA/ARA device entries to `RX_DEVICES` (category `tmd`) with a minimal options schema (occlusalContact, designPreference, comments).

- [ ] **Step 4: Run test → PASS**
Run: `node --test apps/web/src/data/rx-devices.test.js`

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/data/rx-devices.js apps/web/src/data/rx-devices.test.js
git commit -m "feat(rx): reconcile device option-sets to canonical JotForm defs + MORA/ARA"
```

### Task 1.3: Add the `ortho` category (Orthodontic Rx)

**Files:** Modify `apps/web/src/data/rx-devices.js`; extend `rx-devices.test.js`

- [ ] **Step 1: Failing test**
```js
test("ortho category exists with appliance type + expansion screw + retention", () => {
  const o = byKey["ortho-expander"];
  assert.equal(o.category, "ortho");
  assert.deepEqual(o.options.applianceType.options, ["Modified Tandem", "Twin Block", "Other"]);
  assert.ok(o.options.expansionScrew.options.includes("Slim-Line Variety-Click"));
  assert.ok(o.options.retention.options.includes("Fixed (Banded)"));
});
```

- [ ] **Step 2: Run → FAIL.** `node --test apps/web/src/data/rx-devices.test.js`

- [ ] **Step 3: Implement** — add an `ORTHO_OPTIONS` schema and `ortho-expander` device (category `ortho`) from the Orthodontic Rx def (`docs/rx-forms/jotform-api/orthodontic-213545611846154-questions.json`): applianceType, retention, expansionScrew, upperExpansion/lowerExpansion, mandibularType (removable/fixed), modifications (the full checkbox list), nuveloSetup, artboard (type `artboard`), comments. Add `ortho` to `CATEGORY_LABELS` and `CATEGORY_ORDER`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**
```bash
git commit -am "feat(rx): add orthodontic appliance category to the wizard"
```

---

## Phase 2 — Data model (`rx_cases`, `rx_case_files`)

### Task 2.1: Schema

**Files:** Create `apps/api/src/db/schema/rx-cases.js`; Modify `apps/api/src/db/schema/index.js`

- [ ] **Step 1: Write schema**
```js
// apps/api/src/db/schema/rx-cases.js
import { pgTable, varchar, text, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";

// A submitted Digital Rx case. Local-first authoritative record; status gates the
// (later) Seazona push. seazonaClientId is captured from the doctor's account at
// submit — never client-supplied.
export const rxCases = pgTable("rx_cases", {
  id: varchar("id", { length: 128 }).primaryKey(),
  caseNumber: varchar("case_number", { length: 32 }).notNull(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  seazonaClientId: varchar("seazona_client_id", { length: 100 }),
  seazonaAccountNumber: varchar("seazona_account_number", { length: 50 }),
  patientFirst: varchar("patient_first", { length: 120 }).notNull(),
  patientLast: varchar("patient_last", { length: 120 }).notNull(),
  dob: varchar("dob", { length: 20 }),
  gender: varchar("gender", { length: 20 }),
  firstDevice: varchar("first_device", { length: 40 }),
  contactPhone: varchar("contact_phone", { length: 30 }),
  shipTo: jsonb("ship_to"),
  recordsMethod: varchar("records_method", { length: 40 }),
  physicalBite: varchar("physical_bite", { length: 40 }),
  deviceKey: varchar("device_key", { length: 60 }).notNull(),
  deviceCategory: varchar("device_category", { length: 30 }).notNull(),
  deviceOptions: jsonb("device_options").notNull().default({}),
  dueDate: varchar("due_date", { length: 30 }),
  rush: boolean("rush").notNull().default(false),
  rushTier: varchar("rush_tier", { length: 40 }),
  signatureUrl: text("signature_url"),
  generalComments: text("general_comments"),
  // lifecycle: pending_approval → approved → (pushed|push_failed|push_skipped_dryrun)
  status: varchar("status", { length: 40 }).notNull().default("pending_approval"),
  seazonaPushStatus: varchar("seazona_push_status", { length: 40 }),
  seazonaOrderId: varchar("seazona_order_id", { length: 128 }),
  seazonaPushError: text("seazona_push_error"),
  payloadSnapshot: jsonb("payload_snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("rx_cases_user_id_idx").on(t.userId),
  index("rx_cases_status_idx").on(t.status),
  index("rx_cases_case_number_idx").on(t.caseNumber),
]);

export const rxCaseFiles = pgTable("rx_case_files", {
  id: varchar("id", { length: 128 }).primaryKey(),
  caseId: varchar("case_id", { length: 128 }).notNull(),
  kind: varchar("kind", { length: 30 }).notNull(), // scan|photo|prescription|sleep_study|artboard
  originalName: varchar("original_name", { length: 255 }),
  gcsUrl: text("gcs_url").notNull(),
  contentType: varchar("content_type", { length: 120 }),
  size: varchar("size", { length: 20 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rx_case_files_case_id_idx").on(t.caseId)]);
```

- [ ] **Step 2: Export from index** — add to `apps/api/src/db/schema/index.js`:
```js
export { rxCases, rxCaseFiles } from "./rx-cases.js";
```

- [ ] **Step 3: Generate + apply migration**
Run: `cd apps/api && pnpm db:generate && pnpm db:migrate`
Expected: a new migration file created and applied locally; `\d rx_cases` shows the table.

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/db/schema/rx-cases.js apps/api/src/db/schema/index.js apps/api/src/db/migrations
git commit -m "feat(rx): rx_cases + rx_case_files schema and migration"
```

---

## Phase 3 — Device→Seazona-product mapping

### Task 3.1: Mapping file + `resolveLineItems()`

**Files:** Create `apps/api/src/services/rx/device-seazona-map.js`, `device-seazona-map.test.js`

The Seazona catalog (`seazonaService.listProducts()`) gives `{id, code, name}`. The map keys on stable Seazona **codes** (resolved to ids at build time); unmapped selections return flags, never guesses.

- [ ] **Step 1: Write the failing test**
```js
// apps/api/src/services/rx/device-seazona-map.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLineItems } from "./device-seazona-map.js";

test("DDSO Nylon resolves to the DDSO Nylon primary line", () => {
  const { items, unmapped } = resolveLineItems({
    deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } });
  assert.ok(items.some((i) => /DDSO Nylon/i.test(i.name)));
  assert.equal(unmapped.length, 0);
});
test("an unmapped modification is flagged, never guessed", () => {
  const { unmapped } = resolveLineItems({
    deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon", modifications: ["__nope__"] } });
  assert.ok(unmapped.includes("modifications:__nope__"));
});
```

- [ ] **Step 2: Run → FAIL.** `node --test apps/api/src/services/rx/device-seazona-map.test.js`

- [ ] **Step 3: Implement** the map + resolver. Structure:
```js
// apps/api/src/services/rx/device-seazona-map.js
// Maps wizard device + option selections → Seazona product CODES. Codes are
// resolved to ids against the live catalog by the payload builder. UNMAPPED
// selections are returned as flags; we NEVER guess a code.
//
// Seed values below are best-guess from the 392-item catalog + observed real
// orders; the lab verifies via the dry-run coverage report before any live push.
export const DEVICE_MAP = {
  ddso: {
    primary: { Nylon: "DDSO_NYLON_CODE", Biomed: "DDSO_BIOMED_CODE" }, // TODO codes filled from catalog in Task 3.2
    arch: null,
  },
  // … one entry per device key in rx-devices.js
};
export const MODIFICATION_MAP = { /* "Tongue Positioners": "CODE", … */ };
export const LAB_SERVICE_CODES = { modelFabPerArch: "MODEL_FAB_CODE", articulate: "ARTICULATE_CODE" };

export function resolveLineItems({ deviceKey, deviceOptions = {} }) {
  const items = []; const unmapped = [];
  const dev = DEVICE_MAP[deviceKey];
  if (!dev) { unmapped.push(`device:${deviceKey}`); return { items, unmapped }; }
  const material = deviceOptions.baseMaterial || deviceOptions.variant;
  const primaryCode = dev.primary?.[material] || dev.primary?.default;
  if (primaryCode) items.push({ code: primaryCode, arch: dev.arch ?? null, source: "primary" });
  else unmapped.push(`primary:${deviceKey}:${material || "?"}`);
  for (const mod of deviceOptions.modifications || []) {
    const code = MODIFICATION_MAP[mod];
    if (code) items.push({ code, arch: null, source: `mod:${mod}` });
    else unmapped.push(`modifications:${mod}`);
  }
  return { items, unmapped };
}
```

- [ ] **Step 4: Make the test pass** by seeding the two DDSO codes + a couple of modification codes used by the test (use placeholder strings; real codes wired in 3.2).

- [ ] **Step 5: Run → PASS.** Commit.
```bash
git commit -am "feat(rx): device→Seazona product mapping + resolveLineItems (flags unmapped)"
```

### Task 3.2: Seed real Seazona codes via a catalog-assisted draft

**Files:** Create `scripts/rx-map-draft.mjs` (read-only; prints suggested code matches for the lab to confirm)

- [ ] **Step 1: Implement** a script that calls `seazonaService.listProducts()` and, for each device/material/modification label in `rx-devices.js`, prints the best fuzzy catalog matches (by name) so a human fills `DEVICE_MAP`/`MODIFICATION_MAP`. (Read-only; no writes.)
- [ ] **Step 2: Run** `node --env-file=.env scripts/rx-map-draft.mjs` and paste the confirmed codes into `device-seazona-map.js`.
- [ ] **Step 3: Commit** the seeded map.
```bash
git commit -am "feat(rx): seed Seazona product codes from catalog (draft for lab verification)"
```

---

## Phase 4 — Payload builder (pure)

### Task 4.1: `buildSeazonaOrderPayload()`

**Files:** Create `apps/api/src/services/rx/build-order-payload.js`, `build-order-payload.test.js`

- [ ] **Step 1: Failing test**
```js
// apps/api/src/services/rx/build-order-payload.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeazonaOrderPayload } from "./build-order-payload.js";

const baseCase = {
  seazonaClientId: "client-1", patientFirst: "Jane", patientLast: "Doe",
  dueDate: "2026-07-01", deviceKey: "ddso",
  deviceOptions: { baseMaterial: "Nylon", occlusalContact: "Posterior", designPreference: "Buccal-Free" },
  generalComments: "cover 1st molar to 1st molar", rush: false,
};
const codeToId = { DDSO_NYLON_CODE: "sz-prod-1" };

test("payload has patient name, due, clientId, items with resolved ids", () => {
  const { payload } = buildSeazonaOrderPayload(baseCase, { codeToId, userId: "lab-staff-1" });
  assert.equal(payload.clientId, "client-1");
  assert.equal(payload.patientName, "Jane Doe");
  assert.equal(payload.due, "2026-07-01");
  assert.equal(payload.userId, "lab-staff-1");
  assert.ok(payload.items.some((i) => i.id === "sz-prod-1"));
});
test("structured options + comments are compiled into notes", () => {
  const { payload } = buildSeazonaOrderPayload(baseCase, { codeToId, userId: "x" });
  assert.match(payload.notes, /Occlusal Contact: Posterior/);
  assert.match(payload.notes, /Design Preference: Buccal-Free/);
  assert.match(payload.notes, /cover 1st molar to 1st molar/);
});
test("unmapped lines surface as warnings and DO NOT enter items", () => {
  const c = { ...baseCase, deviceOptions: { ...baseCase.deviceOptions, modifications: ["__nope__"] } };
  const { payload, warnings } = buildSeazonaOrderPayload(c, { codeToId, userId: "x" });
  assert.ok(warnings.some((w) => w.includes("__nope__")));
  assert.ok(payload.items.every((i) => i.id)); // only resolved ids
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**
```js
// apps/api/src/services/rx/build-order-payload.js
import { resolveLineItems } from "./device-seazona-map.js";

// Pure: rxCase + { codeToId, userId } → { payload, warnings, unmapped }.
// codeToId maps Seazona product code → id (resolved from listProducts() by the caller).
export function buildSeazonaOrderPayload(rxCase, { codeToId, userId }) {
  const { items: lineCodes, unmapped } = resolveLineItems(rxCase);
  const items = [];
  const warnings = [...unmapped.map((u) => `unmapped ${u}`)];
  for (const lc of lineCodes) {
    const id = codeToId[lc.code];
    if (!id) { warnings.push(`no catalog id for code ${lc.code}`); continue; }
    items.push({ id, arch: lc.arch ?? null });
  }
  const notes = compileNotes(rxCase);
  const payload = {
    clientId: rxCase.seazonaClientId,
    patientName: `${rxCase.patientFirst} ${rxCase.patientLast}`.trim(),
    due: rxCase.dueDate || null,
    items, notes, userId,
  };
  return { payload, warnings, unmapped };
}

function compileNotes(c) {
  const o = c.deviceOptions || {};
  const lines = [];
  if (o.occlusalContact) lines.push(`Occlusal Contact: ${o.occlusalContact}`);
  if (o.designPreference) lines.push(`Design Preference: ${o.designPreference}`);
  if (o.baseMaterial) lines.push(`Material: ${o.baseMaterial}`);
  if (Array.isArray(o.modifications) && o.modifications.length) lines.push(`Modifications: ${o.modifications.join(", ")}`);
  if (o.titration) lines.push(`Titration: ${JSON.stringify(o.titration)}`);
  if (c.physicalBite) lines.push(`Physical bite: ${c.physicalBite}`);
  if (c.recordsMethod) lines.push(`Records: ${c.recordsMethod}`);
  if (c.rush) lines.push(`RUSH (${c.rushTier || "?"})`);
  if (c.firstDevice) lines.push(`First device: ${c.firstDevice}`);
  if (o.comments) lines.push(`Device notes: ${o.comments}`);
  if (c.generalComments) lines.push(`General: ${c.generalComments}`);
  return lines.join(" | ").slice(0, 2000);
}
```

- [ ] **Step 4: Run → PASS.** Commit.
```bash
git commit -am "feat(rx): pure buildSeazonaOrderPayload (notes compilation + unmapped warnings)"
```

---

## Phase 5 — File storage (GCS)

### Task 5.1: Storage service with dev fallback

**Files:** Create `apps/api/src/services/storage.service.js`

- [ ] **Step 1: Implement** `uploadCaseFile({ caseId, kind, buffer, originalName, contentType })` → `{ gcsUrl, size }`.
  - Prod: `@google-cloud/storage` to bucket `env.RX_GCS_BUCKET` (uses ADC / runtime SA already on Cloud Run). Object path `rx-cases/<caseId>/<kind>/<uuid>-<originalName>`.
  - Dev (no bucket configured): write to `apps/api/.localfiles/...` and return a `file://`/local URL so the flow is testable offline.
  - Add `@google-cloud/storage` to `apps/api/package.json` deps and `RX_GCS_BUCKET` to `env.js` (optional string).
- [ ] **Step 2: Smoke test** (manual): a `node --test` that calls the dev fallback path with a small Buffer and asserts a file is written and a URL returned.
- [ ] **Step 3: Commit**
```bash
git commit -am "feat(rx): GCS storage service with local-disk dev fallback"
```

---

## Phase 6 — Submit + approve routes (authenticated doctor)

### Task 6.1: `rx.routes.js`

**Files:** Create `apps/api/src/routes/rx.routes.js`; Modify `apps/api/src/index.js`

Routes (all `/api/v1`, `preHandler: [authenticate, requireApprovedDoctor]` except where noted):
- `POST /rx/cases` (multipart): validate body (zod in `packages/shared`), derive `seazonaClientId`/`seazonaAccountNumber` from `request.user`, upload files via storage service, insert `rx_cases` (`pending_approval`) + `rx_case_files`. Generate `caseNumber` = `RX-<cuid2 12>`. Return the case.
- `GET /rx/cases` (doctor's own) / `GET /rx/cases/:id` (ownership-checked).
- `POST /rx/cases/:id/approve`: load case → resolve `codeToId` from `seazonaService.listProducts()` → `buildSeazonaOrderPayload()` → store `payloadSnapshot` + `warnings`. **DRY_RUN by default** (`env.RX_LIVE_PUSH !== "true"`): set `seazonaPushStatus = "push_skipped_dryrun"`, do NOT call `createOrder`. When live-enabled later: call `seazonaService.createOrder(payload)`, reuse the gated-push + `[Seazona]` alert pattern.

- [ ] **Step 1:** Implement zod schema in `packages/shared` (`rxCaseSubmitSchema`).
- [ ] **Step 2:** Implement the routes per above.
- [ ] **Step 3:** Register in `index.js`: `await fastify.register(rxRoutes, { prefix: "/api/v1" });`
- [ ] **Step 4: Integration check** — start API, `POST /rx/cases` with a small fixture (curl, authed cookie), assert 201 + row created; `POST /approve` returns a payload with `push_skipped_dryrun`.
- [ ] **Step 5: Commit**
```bash
git commit -am "feat(rx): authenticated submit + dry-run approve routes"
```

---

## Phase 7 — Wizard wiring + Artboard

### Task 7.1: Extract wizard into a shared component + authed host

**Files:** Modify `CaseSubmission.jsx` (extract `<RxWizard/>`), create `NewCasePage.jsx`, modify `routes.js`.

- [ ] **Step 1:** Extract the wizard body into `src/components/rx/RxWizard.jsx` (props: `prefill`, `onSubmit`).
- [ ] **Step 2:** `NewCasePage.jsx` (under authed `/app/cases/new`) renders `<RxWizard prefill={fromAuthStore} onSubmit={postCase}/>` where `postCase` builds `FormData` (fields + files) and `POST /rx/cases`.
- [ ] **Step 3:** Replace the marketing mock `handleSubmit`: marketing page shows a teaser + "Sign in to submit a case" link.
- [ ] **Step 4:** Wire records-method / physical-bite / first-device / rush-tier from `rx-records.js` into Step 0/Step 3.
- [ ] **Step 5: Commit**
```bash
git commit -am "feat(rx): authenticated case wizard wired to POST /rx/cases"
```

### Task 7.2: Artboard drawing canvas

**Files:** Create `src/components/rx/Artboard.jsx`; render in `DeviceOptionsPanel` for `type:"artboard"`.

- [ ] **Step 1:** Implement a `<canvas>` with pointer drawing over an arch background image (`/images/rx/artboard-arch.png`), pen/eraser/clear, `toDataURL("image/png")` on change → stored as the `artboard` device option (data URL), uploaded as an `artboard` file on submit.
- [ ] **Step 2:** `DeviceOptionsPanel` renders `<Artboard/>` for `type:"artboard"` fields.
- [ ] **Step 3: Manual check** — draw, confirm PNG is captured and included in submit FormData.
- [ ] **Step 4: Commit**
```bash
git commit -am "feat(rx): ortho artboard drawing canvas"
```

---

## Phase 8 — Dry-run harness (match against hand-made orders)

### Task 8.1: Pure order-diff

**Files:** Create `apps/api/src/services/rx/order-diff.js`, `order-diff.test.js`

- [ ] **Step 1: Failing test**
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffOrderLines } from "./order-diff.js";
test("diff reports matched, missing, and extra by product name", () => {
  const generated = [{ name: "DDSO Nylon" }, { name: "Digital Model Fabrication (Per Arch)" }];
  const real = [{ name: "DDSO Nylon" }, { name: "Articulate Models (Per Arch)" }];
  const d = diffOrderLines(generated, real);
  assert.deepEqual(d.matched, ["DDSO Nylon"]);
  assert.deepEqual(d.missingFromOurs, ["Articulate Models (Per Arch)"]);
  assert.deepEqual(d.extraInOurs, ["Digital Model Fabrication (Per Arch)"]);
});
```
- [ ] **Step 2: Run → FAIL → implement** a normalize-and-compare (case/space-insensitive, by name) returning `{ matched, missingFromOurs, extraInOurs }`. **Run → PASS.**
- [ ] **Step 3: Commit** `git commit -am "feat(rx): pure order-line diff"`

### Task 8.2: Harness script

**Files:** Create `scripts/rx-dryrun.mjs`; add `"rx:dryrun"` to `package.json`.

- [ ] **Step 1: Implement** — load fixture cases from `apps/api/test-fixtures/rx-cases/*.json` (hand-authored representative cases: a DDSO, an OD Olmos Day, an ortho expander), build payloads (`codeToId` from live `listProducts()`, read-only), pull real comparable orders read-only (by device keyword/date), `diffOrderLines`, and print a per-case coverage report incl. `warnings`/`unmapped`. **Never writes to Seazona.**
- [ ] **Step 2: Author 3 fixtures** covering DDSO, OD Olmos, ortho expander.
- [ ] **Step 3: Run** `pnpm rx:dryrun` and capture the coverage report; iterate the mapping (Task 3.2) until coverage is acceptable for the lab to review.
- [ ] **Step 4: Commit**
```bash
git commit -am "feat(rx): dry-run harness diffing generated payloads vs real orders"
```

---

## Self-review notes (spec coverage)
- Field corrections + ortho category → Phase 1. Data model → Phase 2. Mapping → Phase 3. Payload builder (notes compile, unmapped flags) → Phase 4. GCS files → Phase 5. Auth submit + pending-approval + dry-run approve → Phase 6. Wizard wiring + artboard → Phase 7. Dry-run/matching harness → Phase 8.
- **No live Seazona writes** anywhere: approve is DRY_RUN-gated (`RX_LIVE_PUSH`), harness is read-only. The one controlled live-write probe (spec §10) remains a separate, explicitly-approved step — NOT in this plan.
- Mapping codes are seeded as a draft (Task 3.2) and **verified by the dry-run coverage report**, never guessed at push time.

## Open follow-ups (not blocking "ready to test")
- Controlled live `createOrder` probe (settings/files/status acceptance) — needs sign-off.
- Lab verification of the seeded product-code map via the coverage report.
- Per-option diagram images for the remaining widgets (we have 43; fill gaps from API as needed).
