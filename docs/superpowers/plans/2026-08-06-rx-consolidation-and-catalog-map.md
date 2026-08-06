# Rx Form Consolidation + Seazona Catalog Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the three Rx forms into one, re-key the Seazona product map to the strings that form actually emits, and fix the form's failing text contrast.

**Architecture:** `device-seazona-map.js` becomes a `catalog-map/` folder — data tables for the regular `device × material` cases, resolver modules for the irregular ones (guard matrix, ortho tree), behind an unchanged `resolveLineItems` entry point. The `olmos` form is deleted; `ortho` folds into `digital` as a ninth gated device, collapsing two adapter paths into one.

**Tech Stack:** Node ESM, Vitest + `node:assert/strict`, React 18, Tailwind (CSS-variable colour tokens), Drizzle ORM, pnpm workspaces.

## Global Constraints

- Test runner is **Vitest** (`pnpm test` at root runs turbo; `pnpm --filter @my-app/api test` / `--filter web test` per package). Import style: `import { test } from "vitest"; import assert from "node:assert/strict";`
- **Never invent a Seazona product code.** Every code committed must exist in the live catalog. Codes below were verified against the live catalog on 2026-08-06 (392 products).
- `resolveLineItems` **signature must not change**: `({deviceKey, deviceOptions}, {overrides}) => {items, unmapped}`. `build-order-payload.js` is not to be rewritten except where Task 8 specifies.
- `mapKey` values are **stable slugs**, never derived from form wording.
- Rows with `status: "open"` must never emit a line item.
- No text may render below **4.5:1** contrast. `navy/50` and lower are for borders/decorative icons only.
- Branch: `feat/rx-consolidation-and-catalog-map` (already created, spec committed at `f147cf7`).

---

### Task 1: Retire the Olmos form

**Files:**
- Delete: `apps/web/src/data/forms/olmos-rx.form.js`, `apps/web/src/data/forms/olmos-rx.form.test.js`
- Modify: `apps/web/src/data/forms/index.js`, `apps/web/src/App.jsx:243`, `apps/web/src/config/routes.js:36`, `apps/web/src/pages/app/RxChooserPage.jsx:12-13`, `packages/shared/src/schemas/rx.schema.js:62`, `apps/web/src/data/forms/form-to-case.js:245`
- Test: `apps/web/src/data/forms/form-to-case.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `getForm(slug)` accepts only `"digital" | "ortho"`. `FORM_LIST` has 2 entries. `rxFormSubmitSchema.formType` is `z.enum(["digital","ortho"])`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/data/forms/form-to-case.test.js`:

```js
import { FORM_LIST, getForm } from "./index.js";

test("olmos form is retired", () => {
  assert.equal(FORM_LIST.length, 2);
  assert.deepEqual(FORM_LIST.map((f) => f.slug), ["digital", "ortho"]);
  assert.equal(getForm("olmos"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- form-to-case`
Expected: FAIL — `FORM_LIST.length` is 3.

- [ ] **Step 3: Delete the form and its test**

```bash
rm apps/web/src/data/forms/olmos-rx.form.js apps/web/src/data/forms/olmos-rx.form.test.js
```

- [ ] **Step 4: Remove every reference**

`apps/web/src/data/forms/index.js` — drop the import, the `olmos:` registry key, and the `FORM_LIST` entry so only `digitalRxForm` and `orthodonticRxForm` remain.

`apps/web/src/App.jsx` — delete line 243 (`<Route path="/app/rx/olmos" …>`).

`apps/web/src/config/routes.js` — delete line 36 (`RX_OLMOS: "/app/rx/olmos",`).

`apps/web/src/pages/app/RxChooserPage.jsx` — delete the `olmos:` description entry (lines 12-13).

`packages/shared/src/schemas/rx.schema.js:62` — change to:

```js
  formType: z.enum(["digital", "ortho"]),
```

`apps/web/src/data/forms/form-to-case.js:245` — change to:

```js
  const devices =
    slug === "ortho"
      ? buildOrthoDevices(fields, answers)
      : buildDigitalDevices(answers);
```

- [ ] **Step 5: Verify no references remain**

Run: `grep -rn "olmos" apps/web/src apps/api/src packages --include=*.js --include=*.jsx | grep -vi "olmos-day\|olmos-night\|Dr\. Olmos\|DrOlmos\|dr-olmos\|Olmos Series\|Olmos-Method\|Olmos Protocol\|Olmos Neuromuscular\|OLMOS SERIES\|data-olmos\|John Olmos\|OLMOS_DAY\|OLMOS_NIGHT"`
Expected: no output. (The excluded matches are the *device family* and marketing pages, which stay.)

- [ ] **Step 6: Run tests**

Run: `pnpm --filter web test && pnpm --filter api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(rx): retire the standalone OLMOS form

It was a near-duplicate of the Orthodontic form — 7 of 8 section ids
identical, 21 shared field keys, most 'olmos-only' keys just renames
(mxExpansionType/upperExpansionType, addMxArch/addToMaxillary)."
```

---

### Task 2: Unify section-visibility logic

**Files:**
- Modify: `apps/web/src/data/forms/form-logic.js:24-47`, `apps/web/src/components/rx/FormRenderer.jsx:171-185`
- Test: `apps/web/src/data/forms/form-logic.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `sectionVisible(section, answers) => boolean` exported from `form-logic.js`, handling `{key,equals}`, `{key,prefix}`, and `{key,includes}`. `visibleFields(form, answers)` now excludes fields in hidden sections.

**Why:** `FormRenderer.jsx:171-184` handles `includes`; `form-logic.js:24-31` does not, and `allFields` never checks section gating. Harmless today (no gated section has a required field), but Task 9 gates ortho's sections — after which `validateForm` would block submission on fields the doctor cannot see.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/data/forms/form-logic.test.js`:

```js
import { sectionVisible, visibleFields, validateForm } from "./form-logic.js";

const form = {
  sections: [
    { id: "always", fields: [{ type: "text", key: "a" }] },
    {
      id: "gated",
      showIf: { key: "devices", includes: "ddso" },
      fields: [{ type: "text", key: "b", required: true, label: "B" }],
    },
  ],
};

test("sectionVisible handles includes against an array answer", () => {
  assert.equal(sectionVisible(form.sections[1], { devices: ["ddso"] }), true);
  assert.equal(sectionVisible(form.sections[1], { devices: ["guard"] }), false);
  assert.equal(sectionVisible(form.sections[1], {}), false);
});

test("visibleFields excludes fields in hidden sections", () => {
  const keys = visibleFields(form, { devices: ["guard"] }).map((f) => f.key);
  assert.deepEqual(keys, ["a"]);
});

test("validateForm does not require fields the doctor cannot see", () => {
  const { ok, errors } = validateForm(form, { devices: ["guard"] });
  assert.equal(ok, true);
  assert.equal(errors.b, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- form-logic`
Expected: FAIL — `sectionVisible is not a function`.

- [ ] **Step 3: Implement in `form-logic.js`**

Add after `shouldShow` (line 31), and rewrite `allFields`/`visibleFields`:

```js
/**
 * Section-level conditional visibility. Superset of shouldShow's semantics,
 * adding { key, includes }: matches when answers[key] is an array containing
 * the value, or equals it outright.
 */
export function sectionVisible(section, answers) {
  const cond = section && section.showIf;
  if (!cond) return true;
  const other = (answers || {})[cond.key];
  if (cond.includes != null)
    return Array.isArray(other) ? other.includes(cond.includes) : other === cond.includes;
  if (cond.equals != null) return other === cond.equals;
  if (cond.prefix != null)
    return typeof other === "string" && other.startsWith(cond.prefix);
  return true;
}

/** Flatten every field across all sections, preserving declaration order. */
export function allFields(form) {
  const out = [];
  for (const section of (form && form.sections) || [])
    for (const field of (section && section.fields) || []) out.push(field);
  return out;
}

/** allFields filtered to those in a visible section AND individually visible. */
export function visibleFields(form, answers) {
  const out = [];
  for (const section of (form && form.sections) || []) {
    if (!sectionVisible(section, answers)) continue;
    for (const field of (section && section.fields) || [])
      if (shouldShow(field, answers)) out.push(field);
  }
  return out;
}
```

- [ ] **Step 4: Make `validateForm` respect section gating**

In `validateForm`, replace `for (const field of allFields(form))` with `for (const field of visibleFields(form, answers))`, and delete the now-redundant `if (!shouldShow(field, answers)) continue;` line.

- [ ] **Step 5: Point FormRenderer at the shared helper**

In `apps/web/src/components/rx/FormRenderer.jsx`, delete the local section-visibility function (lines ~171-185) and import the shared one:

```js
import { sectionVisible } from "../../data/forms/form-logic.js";
```

Update its call sites to use `sectionVisible(section, answers)`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(rx): one section-visibility implementation, honoured by validation

form-logic.js did not handle { includes } and allFields never checked
section gating, so validateForm could block submission on a field inside
an unselected device section."
```

---

### Task 3: Readability tokens

**Files:**
- Modify: `apps/web/src/index.css`, `apps/web/tailwind.config.js`, `apps/web/src/components/rx/fields.jsx`, `apps/web/src/components/rx/FormRenderer.jsx`
- Test: `apps/web/src/components/rx/contrast.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: Tailwind classes `text-primary`, `text-secondary`, `text-muted`.

**Measured against white, navy = `rgb(11 26 46)`:** `/70` = 6.49 (pass) · `/60` = 4.60 (pass) · `/50` = 3.36 (fail) · `/45` = 2.91 · `/40` = 2.54 · `/30` = 1.95 · `/25` = 1.72 · `/20` = 1.53.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/rx/contrast.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAVY = [11, 26, 46];
const WHITE = [255, 255, 255];
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = (a) => NAVY.map((c, i) => Math.round(a * c + (1 - a) * WHITE[i]));
const ratio = (a, b) => { const l1 = L(a), l2 = L(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

test("every semantic text token clears WCAG AA (4.5:1) on white", () => {
  for (const [name, alpha] of [["text-primary", 1], ["text-secondary", 0.7], ["text-muted", 0.6]])
    assert.ok(ratio(over(alpha), WHITE) >= 4.5, `${name} is ${ratio(over(alpha), WHITE).toFixed(2)}:1`);
});

test("no rx form component renders text below the muted floor", () => {
  // fileURLToPath, not URL.pathname — this repo's path contains a space and
  // pathname would hand back a percent-encoded string that fs cannot read.
  const dir = path.dirname(fileURLToPath(import.meta.url));
  // `text-icon` is the decorative-icon token (3.36:1, clears the 3:1 bar for
  // UI components) and is deliberately not matched here.
  const banned = /text-navy\/(20|25|30|40|45|50)\b/g;
  const offenders = [];
  for (const file of ["fields.jsx", "FormRenderer.jsx"]) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(banned)) offenders.push(`${file}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- contrast`
Expected: FAIL — second test lists ~22 offenders.

- [ ] **Step 3: Add the tokens**

In `apps/web/tailwind.config.js`, inside `theme.extend.colors`, alongside the existing `navy` entry:

```js
        primary:   "rgb(var(--navy) / 1)",
        secondary: "rgb(var(--navy) / 0.7)",
        muted:     "rgb(var(--navy) / 0.6)",
        icon:      "rgb(var(--navy) / 0.5)",
```

`text-icon` is for decorative icons only — 3.36:1 clears WCAG's 3:1 bar for
non-text UI components, but it must never carry text.

- [ ] **Step 4: Replace every failing usage**

In `apps/web/src/components/rx/fields.jsx` and `FormRenderer.jsx`, apply this mapping to `text-*` classes only (leave `border-*` and decorative icon classes alone):

| Was | Becomes |
|---|---|
| `text-navy/70` | `text-secondary` |
| `text-navy/50`, `/45`, `/40` | `text-secondary` |
| `text-navy/30`, `/25`, `/20` | `text-muted` |
| `placeholder:text-navy/25` | `placeholder:text-muted` |

Specific sites: `fields.jsx:18` (placeholder), `:22` (label), `:188` (help text), `:281`, `:317`, `:323` (matrix headers), `:401`, `:412`, `:475`, `:478`, `:484`, `:515`, `:522`, `:532`, `:723`; `FormRenderer.jsx:81`, `:89`, `:142`, `:335`, `:368`, `:421`.

For `fields.jsx:475`, `:515` and `:532` the class is on a decorative icon, not text — change those to `text-icon` rather than a text token.

- [ ] **Step 5: Raise minimum type size and de-shout labels**

In `fields.jsx`, replace `text-[10px]` and `text-[11px]` with `text-xs` (12px) at every site.

Change the label at `fields.jsx:22` from tiny letterspaced uppercase to:

```jsx
    <label className="block text-[13px] font-semibold text-secondary mb-2">
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter web test -- contrast`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(rx): form text contrast — 5 of 8 navy opacities failed WCAG AA

Field labels rendered at navy/40 (2.54:1), matrix headers at navy/40 on
10px, placeholders at navy/25 (1.72:1). Collapsed to three semantic
tokens, all >= 4.5:1, with a test that fails on regression."
```

---

### Task 4: catalog-map scaffolding + devices table

**Files:**
- Create: `apps/api/src/services/rx/catalog-map/devices.table.js`, `apps/api/src/services/rx/catalog-map/devices.table.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEVICE_ROWS` — array of `{ mapKey, device, match: string[], code, name, status }`. `status` is `"confirmed" | "proposed" | "open"`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/rx/catalog-map/devices.table.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { DEVICE_ROWS } from "./devices.table.js";

test("every row has a stable slug mapKey and at least one match literal", () => {
  for (const r of DEVICE_ROWS) {
    assert.match(r.mapKey, /^primary:[a-z-]+:[a-z0-9-]+$/, `bad mapKey: ${r.mapKey}`);
    assert.ok(Array.isArray(r.match) && r.match.length > 0, `no match[] on ${r.mapKey}`);
    assert.ok(["confirmed", "proposed", "open"].includes(r.status), `bad status on ${r.mapKey}`);
  }
});

test("mapKeys are unique", () => {
  const seen = new Set();
  for (const r of DEVICE_ROWS) {
    assert.ok(!seen.has(r.mapKey), `duplicate mapKey: ${r.mapKey}`);
    seen.add(r.mapKey);
  }
});

test("DDSO Nylon resolves to 2608, not the retired 2147", () => {
  const row = DEVICE_ROWS.find((r) => r.mapKey === "primary:ddso:nylon");
  assert.equal(row.code, "2608");
  assert.ok(row.match.includes("NYLON"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- devices.table`
Expected: FAIL — cannot resolve `./devices.table.js`.

- [ ] **Step 3: Create the table**

Create `apps/api/src/services/rx/catalog-map/devices.table.js`. All codes verified against the live catalog 2026-08-06.

```js
/**
 * device × material → Seazona product code.
 *
 * `mapKey` is a STABLE SLUG — never derive it from form wording, or re-wording
 * a form option orphans the lab's confirmed override in rx_code_overrides.
 * `match` holds every form literal that resolves to this row (the newer Rx form
 * and the older wizard word some options differently).
 *
 * status: confirmed = lab signed off or unambiguous 1:1 catalog name match
 *         proposed  = strong catalog match, wants lab confirmation
 *         open      = ambiguous/absent; NEVER emits a line item
 */
export const DEVICE_ROWS = [
  // ── Olmos Day (OD) — odMaterial ──────────────────────────────────────────
  { mapKey: "primary:olmos-day:pmt",            device: "olmos-day", match: ["OD (PMT)"],                       code: "2102", name: "OD PMT",               status: "confirmed" },
  { mapKey: "primary:olmos-day:bioflex",        device: "olmos-day", match: ["OD BIOFLEX"],                     code: "2527", name: "OD Bio Flex",          status: "confirmed" },
  { mapKey: "primary:olmos-day:nylon",          device: "olmos-day", match: ["Printed NYLON", "Printed Nylon"], code: "2108", name: "OD Nylon",             status: "confirmed" },
  { mapKey: "primary:olmos-day:acrylic-clasps", device: "olmos-day", match: ["Acrylic w/clasps"],               code: "2103", name: "OD Acrylic W/Clasps",  status: "confirmed" },
  { mapKey: "primary:olmos-day:dual-laminate",  device: "olmos-day", match: ["Dual-Laminate"],                  code: "2105", name: "OD Dual Laminate",     status: "confirmed" },
  { mapKey: "primary:olmos-day:milled",         device: "olmos-day", match: ["Milled (↑ wear)", "Milled"], code: "2106", name: "OD MILLED",            status: "confirmed" },

  // ── Olmos Night — onDesign picks the family; MATERIAL IS NOT CAPTURED.
  // ONT exists only in Nylon, so it alone resolves. OND/ONP/ONR need the
  // base-material question restored (JotForm qid 270) — see Task 12.
  { mapKey: "primary:olmos-night:ont-nylon", device: "olmos-night", match: ["TITRATION (ON-T) - NYLON Only"],           code: "2144", name: "ONT Nylon", status: "confirmed" },
  { mapKey: "primary:olmos-night:ond",       device: "olmos-night", match: ["DEPROGRAMMER (ON-D) - Anterior Occlusion"], code: null,   name: "OND (material not captured)", status: "open" },
  { mapKey: "primary:olmos-night:onp",       device: "olmos-night", match: ["POSITIONER (ON-P) - Anterior Occlusion"],   code: null,   name: "ONP (material not captured)", status: "open" },
  { mapKey: "primary:olmos-night:onr",       device: "olmos-night", match: ["RAMP (ON-R) - Anterior Occlusion"],         code: null,   name: "ONR (material not captured)", status: "open" },

  // ── DDSO — ddsoMaterial. Catalog also has BioFlex (2532); form omits it.
  { mapKey: "primary:ddso:nylon",  device: "ddso", match: ["NYLON", "Nylon"],   code: "2608", name: "DDSO Nylon",  status: "confirmed" },
  { mapKey: "primary:ddso:biomed", device: "ddso", match: ["BIOMED", "Biomed"], code: "2146", name: "DDSO BIOMED", status: "confirmed" },

  // ── Single-product devices ───────────────────────────────────────────────
  { mapKey: "primary:ara:default",       device: "ara",       match: ["default"],               code: "2592", name: "ARA- Nylon", status: "confirmed" },
  { mapKey: "primary:snorehook:default", device: "snorehook", match: ["default", "SnoreHook"],  code: "2154", name: "Snorehook",  status: "confirmed" },

  // ── Sport-Guard — sportGuardDevice tier ──────────────────────────────────
  { mapKey: "primary:sport-guard:trainer", device: "sport-guard", match: ["Trainer - Non-Contact [Md. Arch Only]"],           code: "2173", name: "Sportsguard: Trainer (Md Only)", status: "confirmed" },
  { mapKey: "primary:sport-guard:pro",     device: "sport-guard", match: ["PRO - Light to Heavy Contact [Mx. or Md. Arch]"],  code: "2172", name: "Sportsguard Professional",       status: "confirmed" },
  { mapKey: "primary:sport-guard:cadcam",  device: "sport-guard", match: ["CAD/CAM - Light to Heavy Contact [Mx or Md Arch]"], code: "2174", name: "Sportsguard: CAD/CAM",          status: "confirmed" },

  // ── Material not captured by the form; single most-likely SKU proposed ───
  { mapKey: "primary:shirazi-hybrid:nylon", device: "shirazi-hybrid", match: ["default"], code: "2152", name: "Shirazi Hybrid Nylon", status: "proposed" },
  { mapKey: "primary:cadcam-d-pro:nylon",   device: "cadcam-d-pro",   match: ["default"], code: "2539", name: "Dorsal Pro Nylon",     status: "proposed" },
  { mapKey: "primary:mora:pmt",             device: "mora",           match: ["default"], code: "2593", name: "MORA - PMT",           status: "proposed" },
];
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api test -- devices.table`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(rx): device x material table keyed to real form strings

Replaces flat primary[material] lookups. mapKey is a stable slug so
re-wording a form option cannot orphan a confirmed override; match[]
accepts both the Rx form and older wizard wording."
```

---

### Task 5: Modifications and attributes tables

**Files:**
- Create: `apps/api/src/services/rx/catalog-map/modifications.table.js`, `apps/api/src/services/rx/catalog-map/attributes.table.js`, `apps/api/src/services/rx/catalog-map/tables.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `MODIFICATION_ROWS`, `ATTRIBUTE_ROWS` — same row shape as `DEVICE_ROWS` but with `mapKey` prefixes `mod:` and `attr:` and no `device` field.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/rx/catalog-map/tables.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { MODIFICATION_ROWS } from "./modifications.table.js";
import { ATTRIBUTE_ROWS } from "./attributes.table.js";

test("DDSO's six form modifications all resolve", () => {
  const expected = {
    "Tongue Positioners": "2330",
    "Hooks for Elastics": "2319",
    "Vertical Shims": "2302",
    "ON Loop": "2300",
    "BAB Loop": "2303",
    "ON Ramp": "2301",
  };
  for (const [literal, code] of Object.entries(expected)) {
    const row = MODIFICATION_ROWS.find((r) => r.match.includes(literal));
    assert.ok(row, `no row matches ${literal}`);
    assert.equal(row.code, code);
    assert.equal(row.status, "confirmed");
  }
});

test("occlusal contact and design preference map to the $0 catalog items", () => {
  const expected = {
    "Posterior Contact": "2293",
    "Anterior Contact": "2289",
    "FULL Occlusal Contact": "2292",
    "TRIPOD Occlusion": "2291",
    "Lingual-Free": "2314",
    "Buccal-Free": "2308",
  };
  for (const [literal, code] of Object.entries(expected)) {
    const row = ATTRIBUTE_ROWS.find((r) => r.match.includes(literal));
    assert.ok(row, `no row matches ${literal}`);
    assert.equal(row.code, code);
  }
});

test("open rows carry no code", () => {
  for (const r of [...MODIFICATION_ROWS, ...ATTRIBUTE_ROWS])
    if (r.status === "open") assert.equal(r.code, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- tables`
Expected: FAIL — cannot resolve `./modifications.table.js`.

- [ ] **Step 3: Create `modifications.table.js`**

```js
/** Modification / attachment selections → Seazona product codes. */
export const MODIFICATION_ROWS = [
  { mapKey: "mod:tongue-positioners", match: ["Tongue Positioners"],                          code: "2330", name: "Removable Tongue Positioners (Nylon)", status: "confirmed" },
  { mapKey: "mod:hooks-elastics",     match: ["Hooks for Elastics"],                          code: "2319", name: "Hooks For Elastic Retention",          status: "confirmed" },
  { mapKey: "mod:vertical-shims",     match: ["Vertical Shims", "Vertical Shims (Printed Only)"], code: "2302", name: "Vertical Shims (Nylon)",          status: "confirmed" },
  { mapKey: "mod:on-loop",            match: ["ON Loop"],                                     code: "2300", name: "ON LOOP",                              status: "confirmed" },
  { mapKey: "mod:bab-loop",           match: ["BAB Loop"],                                    code: "2303", name: "BAB-LOOP",                             status: "confirmed" },
  { mapKey: "mod:on-ramp",            match: ["ON Ramp"],                                     code: "2301", name: "ON-Ramp ONLY (ON-LOOP W/ Closed Hole)", status: "confirmed" },
  { mapKey: "mod:labial-bow",         match: ["Labial bow"],                                  code: "2184", name: "Labial Bow",                           status: "confirmed" },
  { mapKey: "mod:hooks-lip-seal",     match: ["Hooks for lip-seal"],                          code: "2319", name: "Hooks For Elastic Retention",          status: "proposed" },

  // No catalog product corresponds to these. They are design instructions and
  // must reach the lab as notes, never as a guessed line item.
  { mapKey: "mod:wrap-distal",          match: ["Wrap distal of last molars", "Wrap Distal"],           code: null, name: "Wrap distal of last molars",  status: "open" },
  { mapKey: "mod:molars-uncovered",     match: ["Keep last molars uncovered", "Do not cover last molars"], code: null, name: "Keep last molars uncovered", status: "open" },
  { mapKey: "mod:holes-for-cusps",      match: ["Create holes for cusps (minimum vertical)"],           code: null, name: "Create holes for cusps",      status: "open" },
  { mapKey: "mod:anterior-pad",         match: ["Anterior Pad"],                                        code: null, name: "Anterior Pad",                status: "open" },
  { mapKey: "mod:no-anterior-buildup",  match: ["No anterior buildup on trutaine/essix"],               code: null, name: "No anterior buildup",         status: "open" },
];
```

- [ ] **Step 4: Create `attributes.table.js`**

```js
/**
 * Occlusal-contact and design-preference selections → $0 Seazona products.
 * These exist in the catalog precisely so design intent lands on the order as
 * structured lines rather than prose in the notes field.
 */
export const ATTRIBUTE_ROWS = [
  { mapKey: "attr:occlusal:posterior", match: ["Posterior Contact"],     code: "2293", name: "Posterior Contact",   status: "confirmed" },
  { mapKey: "attr:occlusal:anterior",  match: ["Anterior Contact"],      code: "2289", name: "Anterior Contact",    status: "confirmed" },
  { mapKey: "attr:occlusal:full",      match: ["FULL Occlusal Contact"], code: "2292", name: "Full Contact",        status: "confirmed" },
  { mapKey: "attr:occlusal:tripod",    match: ["TRIPOD Occlusion"],      code: "2291", name: "TRIPOD Contact",      status: "confirmed" },
  { mapKey: "attr:design:lingual-free", match: ["Lingual-Free"],         code: "2314", name: "Lingual-Free Design", status: "confirmed" },
  { mapKey: "attr:design:buccal-free",  match: ["Buccal-Free"],          code: "2308", name: "Buccal-Free Design",  status: "confirmed" },

  // "Standard" means no special design; it correctly emits nothing.
  { mapKey: "attr:design:standard",      match: ["Standard"],      code: null, name: "Standard (no line item)", status: "open" },
  // Ambiguous against attr:occlusal:full (2292) — lab must disambiguate.
  { mapKey: "attr:design:full-coverage", match: ["Full Coverage"], code: null, name: "Full Coverage",           status: "open" },
];
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter api test -- tables`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(rx): modification + design-attribute tables

Occlusal contact and design preference map 1:1 onto the \$0 catalog
products that exist for them (2289/2291/2292/2293, 2308/2314) instead of
being flattened into the notes string."
```

---

### Task 6: Guard resolver

**Files:**
- Create: `apps/api/src/services/rx/catalog-map/resolvers/guard.js`, `apps/api/src/services/rx/catalog-map/resolvers/guard.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveGuard(deviceOptions) => { items: Array<{mapKey, code, name, arch, status}>, unmapped: string[] }`.

**Input contract.** `deviceOptions` for `guard` carries:
- `variant` — one of `"Dual Arch - SLIDER"`, `"Dual Arch - FLATPLANE"`, `"Single Arch - NIGHTGUARD"` (from `nightguardDevice[0]`)
- `standardGuards` — matrix `{ [rowLabel]: { "UPPER ARCH": bool, "LOWER ARCH": bool, "Base Material": string, … } }`
- `modifications` — array from `attachmentsModifications`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/rx/catalog-map/resolvers/guard.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveGuard } from "./guard.js";

test("a full-occlusion nightguard in Nylon on the upper arch resolves to 2166", () => {
  const { items, unmapped } = resolveGuard({
    standardGuards: {
      "Nightguard - Full Occlusion": { "UPPER ARCH": true, "Base Material": "Nylon (Printed)" },
    },
  });
  assert.equal(unmapped.length, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].code, "2166");
  assert.equal(items[0].arch, "upper");
});

test("upper and lower selected on one row emit two lines", () => {
  const { items } = resolveGuard({
    standardGuards: {
      "Michigan Splint - Anterior Guidance": { "UPPER ARCH": true, "LOWER ARCH": true, "Base Material": "BIOMED (Printed)" },
    },
  });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.arch).sort(), ["lower", "upper"]);
  assert.ok(items.every((i) => i.code === "2169"));
});

test("Essix and Bleaching ignore base material", () => {
  const { items } = resolveGuard({
    standardGuards: { "Essix Tray": { "UPPER ARCH": true }, "Bleaching Trays": { "LOWER ARCH": true } },
  });
  assert.deepEqual(items.map((i) => i.code).sort(), ["2155", "2161"]);
});

test("a row with no base material where one is required is flagged, never guessed", () => {
  const { items, unmapped } = resolveGuard({
    standardGuards: { "Nightguard - Full Occlusion": { "UPPER ARCH": true } },
  });
  assert.equal(items.length, 0);
  assert.ok(unmapped.some((u) => u.includes("nightguard-full-occlusion")));
});

test("Slider Type is ambiguous and never guesses between NTI and FLATPLANE", () => {
  const { items, unmapped } = resolveGuard({
    standardGuards: { "Occlusal Guard - Slider Type": { "UPPER ARCH": true, "Base Material": "Nylon (Printed)" } },
  });
  assert.equal(items.length, 0);
  assert.ok(unmapped.some((u) => u.includes("slider-type")));
});

test("unmapped entries are bare mapKeys the override layer can key on", () => {
  const { unmapped } = resolveGuard({
    standardGuards: { "Occlusal Guard - Slider Type": { "UPPER ARCH": true, "Base Material": "Nylon (Printed)" } },
  });
  assert.deepEqual(unmapped, ["guard:occlusal-guard-slider-type"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- guard`
Expected: FAIL — cannot resolve `./guard.js`.

- [ ] **Step 3: Implement**

```js
/**
 * Nightguard resolver. The guard section is a matrix, not a single choice:
 * each row is an appliance, each row carries its own arch checkboxes and a
 * Base Material dropdown, and one submission may order several rows at once.
 */

// row label → { material literal → code }, or { "*": code } when the appliance
// exists in exactly one form regardless of material.
const GUARD_MATRIX = {
  "Nightguard - Full Occlusion": {
    "PMT (Diamoform)": { code: "2164", name: "Nightguard-Single Arch PMT",    status: "confirmed" },
    "BIOMED (Printed)": { code: "2165", name: "Nightguard-Single Arch Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2166", name: "Nightguard-Single Arch Nylon",  status: "confirmed" },
    "Dual-Laminate":    { code: "2167", name: "Nightguard Dual Laminate",      status: "confirmed" },
    "Acrylic w/clasps": { code: "2428", name: "Nightguard (All-Acrylic)",      status: "proposed"  },
  },
  "Occlusal Guard - NTI Type": {
    "BIOMED (Printed)": { code: "2175", name: "NTI Slider-Type (Dual Arch) Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2176", name: "NTI Slider-Type (Dual Arch) Nylon",  status: "confirmed" },
  },
  "Michigan Splint - Anterior Guidance": {
    "BIOMED (Printed)": { code: "2169", name: "Michigan Splint Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2170", name: "Michigan Splint Nylon",  status: "confirmed" },
  },
  "Dual Arch - FLATPLANE": {
    "BIOMED (Printed)": { code: "2162", name: "FLATPLANE (Dual Arch) Biomed",  status: "confirmed" },
    "Nylon (Printed)":  { code: "2163", name: "FLATPLANE (Dual Arch) Nylon",   status: "confirmed" },
    "BioFlex":          { code: "2531", name: "FLATPLANE (Dual Arch) BioFlex", status: "confirmed" },
  },
  "Essix Tray":          { "*": { code: "2161", name: "Essix Tray Non Printed (per arch)", status: "confirmed" } },
  "Bleaching Trays":     { "*": { code: "2155", name: "Bleaching Tray (per arch)",         status: "confirmed" } },
  "Neurosensory Stent":  { "*": { code: "2597", name: "Neurostent BioFlex",                status: "proposed"  } },
  // Ambiguous: the catalog has both NTI Slider-Type (2175/2176) and FLATPLANE
  // (2162/2163/2531). Never guess — the lab must disambiguate.
  "Occlusal Guard - Slider Type": {},
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function resolveGuard(deviceOptions = {}) {
  const items = [];
  const unmapped = [];
  const matrix = deviceOptions.standardGuards || {};

  for (const [rowLabel, cells] of Object.entries(matrix)) {
    if (!cells) continue;
    const arches = [];
    if (cells["UPPER ARCH"]) arches.push("upper");
    if (cells["LOWER ARCH"]) arches.push("lower");
    if (arches.length === 0) continue; // row not ordered

    const options = GUARD_MATRIX[rowLabel];
    if (!options || Object.keys(options).length === 0) {
      unmapped.push(`guard:${slug(rowLabel)}`);
      continue;
    }

    const chosen = options["*"] || options[cells["Base Material"]];
    if (!chosen) {
      unmapped.push(`guard:${slug(rowLabel)}:${slug(cells["Base Material"] || "no-material")}`);
      continue;
    }

    for (const arch of arches)
      items.push({
        mapKey: `guard:${slug(rowLabel)}:${slug(cells["Base Material"] || "any")}`,
        code: chosen.code,
        name: chosen.name,
        arch,
        status: chosen.status,
      });
  }

  return { items, unmapped };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api test -- guard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(rx): guard matrix resolver

The nightguard section is a matrix — appliance row x arch x base material,
several orderable at once. The Base Material column maps 1:1 onto the
catalog's nightguard SKUs (2164/2165/2166/2167/2428)."
```

---

### Task 7: resolveLineItems entry point

**Files:**
- Create: `apps/api/src/services/rx/catalog-map/index.js`, `apps/api/src/services/rx/catalog-map/index.test.js`
- Modify: `apps/api/src/services/rx/build-order-payload.js:1`
- Delete: `apps/api/src/services/rx/device-seazona-map.js`, `apps/api/src/services/rx/device-seazona-map.test.js`

**Interfaces:**
- Consumes: `DEVICE_ROWS`, `MODIFICATION_ROWS`, `ATTRIBUTE_ROWS`, `resolveGuard`.
- Produces: `resolveLineItems({deviceKey, deviceOptions}, {overrides}) => {items, unmapped}`; also re-exports `DEVICE_LABELS` and `LAB_SERVICE_CODES` (consumed by `admin-rx-mapping.routes.js:9`).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/rx/catalog-map/index.test.js`:

```js
import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveLineItems } from "./index.js";

test("DDSO NYLON from the Rx form resolves to 2608", () => {
  const { items, unmapped } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } });
  assert.equal(unmapped.length, 0);
  assert.equal(items[0].code, "2608");
  assert.equal(items[0].mapKey, "primary:ddso:nylon");
});

test("the older wizard's 'Nylon' resolves to the same row", () => {
  const { items } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } });
  assert.equal(items[0].code, "2608");
});

test("modifications and design attributes both become line items", () => {
  const { items } = resolveLineItems({
    deviceKey: "ddso",
    deviceOptions: { baseMaterial: "NYLON", modifications: ["Tongue Positioners"], occlusalContact: "Anterior Contact", designPreference: "Lingual-Free" },
  });
  const codes = items.map((i) => i.code).sort();
  assert.deepEqual(codes, ["2289", "2314", "2330", "2608"]);
});

test("an open row never emits and is always flagged", () => {
  const { items, unmapped } = resolveLineItems({
    deviceKey: "olmos-night",
    deviceOptions: { variant: "DEPROGRAMMER (ON-D) - Anterior Occlusion" },
  });
  assert.equal(items.length, 0);
  assert.ok(unmapped.includes("primary:olmos-night:ond"));
});

test("a DB override wins over the table", () => {
  const overrides = { "primary:ddso:nylon": { code: "9999", name: "Custom" } };
  const { items } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } }, { overrides });
  assert.equal(items[0].code, "9999");
  assert.equal(items[0].overridden, true);
});

test("an unknown modification is flagged, never guessed", () => {
  const { unmapped } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON", modifications: ["__nope__"] } });
  assert.ok(unmapped.some((u) => u.includes("__nope__")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- catalog-map/index`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 3: Implement**

```js
import { DEVICE_ROWS } from "./devices.table.js";
import { MODIFICATION_ROWS } from "./modifications.table.js";
import { ATTRIBUTE_ROWS } from "./attributes.table.js";
import { resolveGuard } from "./resolvers/guard.js";
import { resolveOrtho } from "./resolvers/ortho.js";

/** Human-readable device names for admin tooling that cannot import the frontend. */
export const DEVICE_LABELS = {
  ddso: "DDSO",
  "olmos-day": "Olmos Day (OD)",
  "olmos-night": "Olmos Night",
  "cadcam-d-pro": "CAD/CAM D-Pro (Dorsal Pro)",
  "shirazi-hybrid": "Shirazi Hybrid",
  snorehook: "SnoreHook",
  guard: "Nightguard",
  "sport-guard": "Sport-Guard",
  mora: "MORA",
  ara: "ARA",
  "ortho-expander": "Orthodontic Appliance",
};

export const LAB_SERVICE_CODES = {
  modelFabPerArch: { code: "2367", name: "Digital Model Fabrication (Per Arch)" },
  articulate:      { code: "2368", name: "Articulate Models" },
};

const RESOLVERS = { guard: resolveGuard, "ortho-expander": resolveOrtho };

/** First row whose match[] contains `literal`. */
function findRow(rows, literal, device) {
  return rows.find(
    (r) => (device === undefined || r.device === device) && r.match.includes(literal)
  );
}

/** Push a row as a line item, honouring an override and skipping `open`. */
function emit(row, { items, unmapped }, overrides, arch = null) {
  const override = overrides[row.mapKey];
  if (override) {
    items.push({ ...override, mapKey: row.mapKey, arch, status: "confirmed", overridden: true });
    return;
  }
  if (row.status === "open" || !row.code) {
    unmapped.push(row.mapKey);
    return;
  }
  items.push({ code: row.code, name: row.name, mapKey: row.mapKey, arch, status: row.status, overridden: false });
}

export function resolveLineItems({ deviceKey, deviceOptions = {} } = {}, { overrides = {} } = {}) {
  const acc = { items: [], unmapped: [] };

  const custom = RESOLVERS[deviceKey];
  if (custom) {
    const { items, unmapped } = custom(deviceOptions);
    for (const it of items) {
      const override = overrides[it.mapKey];
      acc.items.push(override ? { ...override, mapKey: it.mapKey, arch: it.arch, status: "confirmed", overridden: true } : { ...it, overridden: false });
    }
    acc.unmapped.push(...unmapped);
  } else {
    // Primary line: keyed by baseMaterial, variant, or the literal "default".
    const literal = deviceOptions.baseMaterial || deviceOptions.variant || "default";
    const row = findRow(DEVICE_ROWS, literal, deviceKey);
    if (row) emit(row, acc, overrides, deviceOptions.arch ?? null);
    else acc.unmapped.push(`primary:${deviceKey}:${literal}`);
  }

  // Modifications — shared across devices.
  for (const mod of deviceOptions.modifications || []) {
    const row = findRow(MODIFICATION_ROWS, mod);
    if (row) emit(row, acc, overrides);
    else acc.unmapped.push(`mod:${mod}`);
  }

  // Design attributes → $0 line items.
  for (const literal of [deviceOptions.occlusalContact, deviceOptions.designPreference]) {
    if (!literal) continue;
    const row = findRow(ATTRIBUTE_ROWS, literal);
    if (row) emit(row, acc, overrides);
    else acc.unmapped.push(`attr:${literal}`);
  }

  return acc;
}
```

- [ ] **Step 4: Create the ortho resolver stub**

The ortho appliance taxonomy is a genuine lab decision (~36 catalog products against one form device). Until the lab rules on it, ortho selections must be surfaced as unmapped rather than silently dropped. Create `apps/api/src/services/rx/catalog-map/resolvers/ortho.js`:

```js
/**
 * Orthodontic appliance resolver.
 *
 * The catalog carries ~36 distinct ortho products (expanders, tandems, twin
 * blocks) selected by retention, screw type, clasp and base material. The form
 * captures those selections but the lab has not yet ruled on which combination
 * maps to which SKU — see the sign-off document (Task 12).
 *
 * Until then every selection is reported as UNMAPPED so it reaches the lab as a
 * flagged item and a note, rather than being dropped or guessed.
 */
export function resolveOrtho(deviceOptions = {}) {
  const unmapped = [];
  for (const key of ["applianceType", "upperArchRetention", "lowerArchRetention", "upperExpansionType", "lowerExpansionType"]) {
    const v = deviceOptions[key];
    if (v) unmapped.push(`ortho:${key}:${v}`);
  }
  if (unmapped.length === 0) unmapped.push("ortho:unspecified");
  return { items: [], unmapped };
}
```

- [ ] **Step 5: Swap the import and delete the old map**

`apps/api/src/services/rx/build-order-payload.js:1` becomes:

```js
import { resolveLineItems } from "./catalog-map/index.js";
```

`apps/api/src/routes/admin-rx-mapping.routes.js:9` becomes:

```js
import { DEVICE_LABELS, resolveLineItems } from "../services/rx/catalog-map/index.js";
```

That route also imports `DEVICE_MAP` — it uses it to enumerate mapping slots for the admin UI. Replace those usages with `DEVICE_ROWS` imported from `../services/rx/catalog-map/devices.table.js`, reading `.mapKey` / `.name` / `.status` per row.

```bash
rm apps/api/src/services/rx/device-seazona-map.js apps/api/src/services/rx/device-seazona-map.test.js
```

- [ ] **Step 6: Run the full API suite**

Run: `pnpm --filter api test`
Expected: PASS. If `admin-rx-mapping.routes.js` still references `DEVICE_MAP`, fix it now.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(rx): catalog-map entry point replaces device-seazona-map

Same resolveLineItems signature, now backed by data tables plus resolvers
for the irregular devices. Open rows never emit; overrides still win."
```

---

### Task 8: Stop silently dropping unresolvable codes

**Files:**
- Modify: `apps/api/src/services/rx/build-order-payload.js:20-27`, `:153-163`
- Test: `apps/api/src/services/rx/build-order-payload.test.js`

**Interfaces:**
- Consumes: `resolveLineItems`.
- Produces: `buildSeazonaOrderPayload` / `…Multi` return an added `ok: boolean`. `ok` is `false` when a device contributed no primary line.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/services/rx/build-order-payload.test.js`:

```js
test("a device whose primary line cannot resolve marks the payload not-ok", () => {
  const { ok, warnings } = buildSeazonaOrderPayload(
    { deviceKey: "olmos-night", deviceOptions: { variant: "DEPROGRAMMER (ON-D) - Anterior Occlusion" }, seazonaClientId: "c1" },
    { codeToId: {}, userId: "u1" }
  );
  assert.equal(ok, false);
  assert.ok(warnings.some((w) => /unmapped/.test(w)));
});

test("a fully resolvable device is ok", () => {
  const { ok } = buildSeazonaOrderPayload(
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" }, seazonaClientId: "c1" },
    { codeToId: { 2608: "id-2608" }, userId: "u1" }
  );
  assert.equal(ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- build-order-payload`
Expected: FAIL — `ok` is undefined.

- [ ] **Step 3: Implement**

In `buildSeazonaOrderPayload`, track whether a primary line survived and return it:

```js
  let primaryEmitted = false;
  for (const li of lineItems) {
    const id = codeToId[li.code];
    if (!id) {
      warnings.push(`no catalog id for code ${li.code} (${li.name})`);
      continue;
    }
    if (li.mapKey && li.mapKey.startsWith("primary:")) primaryEmitted = true;
    items.push({ id, arch: normalizeArch(li.arch) });
  }

  const ok = primaryEmitted && unmapped.length === 0;
```

Add `ok` to the returned object.

In `buildSeazonaOrderPayloadMulti`, apply the same per device — a device is ok when it emitted at least one line and contributed no `unmapped` entries — and return `ok` as `perDevice.every((d) => d.ok)`. Add `ok` to each `perDevice` entry.

- [ ] **Step 4: Guard the live push**

In `apps/api/src/routes/rx.routes.js:702` the current destructure is
`const { payload, warnings: buildWarnings } = buildSeazonaOrderPayload(caseRow, {…});`.
Add `ok` to it:

```js
    const { payload, warnings: buildWarnings, ok } = buildSeazonaOrderPayload(caseRow, {
```

Then, before the `RX_LIVE_PUSH` branch at :712, refuse to proceed when `ok` is false:

```js
    if (!ok) {
      req.log.error({ warnings: buildWarnings }, "[Seazona][RX_PAYLOAD_INCOMPLETE] refusing to push an order with unresolved lines");
      return reply.code(422).send({
        error: { code: "RX_PAYLOAD_INCOMPLETE", status: 422, message: "This prescription has selections that are not yet mapped to lab products. It has been saved but not sent.", details: buildWarnings },
      });
    }
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(rx): refuse to build an order that lost its device line

build-order-payload skipped unresolvable codes with only a warning, so an
order could reach the lab with no product on it. It now reports ok=false
and the push path returns 422 instead of sending a partial order."
```

---

### Task 9: Fold ortho into the digital form

**Files:**
- Modify: `apps/web/src/data/forms/digital-rx.form.js`
- Delete: `apps/web/src/data/forms/orthodontic-rx.form.js`, `orthodontic-rx.form.test.js`
- Modify: `apps/web/src/data/forms/index.js`, `apps/web/src/App.jsx:242`, `apps/web/src/config/routes.js`, `apps/web/src/pages/app/RxChooserPage.jsx`, `packages/shared/src/schemas/rx.schema.js:62`
- Test: `apps/web/src/data/forms/digital-rx.form.test.js`

**Interfaces:**
- Consumes: `sectionVisible` from Task 2.
- Produces: `digitalRxForm` contains a `devicesToOrder` option `"ortho"` and three sections gated on it. `FORM_LIST` has 1 entry. `rxFormSubmitSchema.formType` is `z.enum(["digital"])`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/data/forms/digital-rx.form.test.js`:

```js
const ORTHO_KEYS = [
  "selectDevice", "upperArchRetention", "upperExpansionType", "lowerArchRetention",
  "mxSelections", "lowerExpansionType", "requiredSelection", "tandemBowSetting",
  "addToMaxillary", "addToMandibular", "occlusalOptionsTandem", "dualArchComments",
  "dualArchDesignDraw", "dualArchArtboard", "upperExpansionSelection", "maxillaryAdd",
  "maxillaryDesignDraw", "maxillaryArtboard", "maxillaryComments", "lowerExpansionSelection",
  "removableMandibularExpansion", "fixedMandibularExpansion", "mandibularAdd",
  "mandibularDesignDraw", "mandibularArtboard", "orthoDesignComments",
];

test("ortho is a selectable device", () => {
  const gate = digitalRxForm.sections.find((s) => s.id === "select-device").fields[0];
  assert.equal(gate.options.length, 9);
  assert.ok(gate.options.some((o) => o.value === "ortho"));
});

test("every ortho field survived the merge", () => {
  const keys = new Set(digitalRxForm.sections.flatMap((s) => (s.fields || []).map((f) => f.key)));
  for (const k of ORTHO_KEYS) assert.ok(keys.has(k), `lost ortho field: ${k}`);
});

test("ortho sections are gated on the ortho device", () => {
  for (const id of ["functionalDualArch", "maxillaryUpper", "mandibularLower"]) {
    const s = digitalRxForm.sections.find((x) => x.id === id);
    assert.ok(s, `missing section ${id}`);
    assert.deepEqual(s.showIf, { key: "devicesToOrder", includes: "ortho" });
  }
});

test("ortho's duplicate wrapper fields are gone", () => {
  const keys = new Set(digitalRxForm.sections.flatMap((s) => (s.fields || []).map((f) => f.key)));
  for (const dup of ["recordsType", "sendingPhysicalBite", "uploadFiles"]) assert.ok(!keys.has(dup), `duplicate wrapper field survived: ${dup}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- digital-rx.form`
Expected: FAIL — gate has 8 options.

- [ ] **Step 3: Add the ortho device option**

In `digital-rx.form.js`, append to the `devicesToOrder` options array (after `snorehook`):

```js
            { value: "ortho", label: "Orthodontic Appliance — Expanders / Tandem / Twin Block" },
```

- [ ] **Step 4: Move the three ortho sections in verbatim**

Copy the `functionalDualArch`, `maxillaryUpper`, and `mandibularLower` section objects from `orthodontic-rx.form.js` into `digital-rx.form.js`, inserted after the `snorehook` section and before `submit-form`. Add to each:

```js
      showIf: { key: "devicesToOrder", includes: "ortho" },
```

Do not rename, reorder, or reword any field. Do not copy `caseIdentification`, `pleaseNote`, `caseSubmission`, `orthoRecords`, or `submitForm` — digital already has equivalents.

- [ ] **Step 5: Move ortho's genuine extras into the shared sections**

Add to digital's `submit-form` section: `rushChargeBiomed`, `rushChargeNylon`, `additionalComments` (copied verbatim from ortho's `submitForm`).
Add to digital's `case-id` section: `caseDate` (copied verbatim from ortho's `caseIdentification`).
Add to digital's `case-submission` section: `nuveloDigitalSetup`, `digitalStudyModels`, `digitalSetupEmail` from ortho's `orthoRecords`, each gated `showIf: { key: "devicesToOrder", includes: "ortho" }`.

- [ ] **Step 6: Delete the ortho form and its references**

```bash
rm apps/web/src/data/forms/orthodontic-rx.form.js apps/web/src/data/forms/orthodontic-rx.form.test.js
```

`index.js` — drop the ortho import, registry key and `FORM_LIST` entry; `FORM_LIST` is now `[digitalRxForm]`.
`App.jsx` — delete line 242 (`/app/rx/ortho`).
`config/routes.js` — delete `RX_ORTHO`.
`RxChooserPage.jsx` — delete the `ortho` description.
`packages/shared/src/schemas/rx.schema.js:62` — `formType: z.enum(["digital"]),`

- [ ] **Step 7: Run tests**

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(rx): one Rx form — ortho folds in as a gated device

digital and ortho shared only the 5 wrapper fields (patientName,
firstDevice, dueDate, doctorSignature, rushCase). Ortho is structurally
just one more device, and the forms were only split because the source
JotForms were."
```

---

### Task 10: Single adapter path

**Files:**
- Modify: `apps/web/src/data/forms/form-to-case.js:76-102`, `:113-217`, `:244-247`
- Test: `apps/web/src/data/forms/form-to-case.test.js`

**Interfaces:**
- Consumes: consolidated `digitalRxForm`.
- Produces: `formAnswersToCaseInput(slug, form, answers)` has one code path. Guard devices carry `standardGuards`; ortho devices carry their real selections.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/data/forms/form-to-case.test.js`:

```js
test("ortho selections are carried through, not discarded", () => {
  const { devices } = formAnswersToCaseInput("digital", getForm("digital"), {
    devicesToOrder: ["ortho"],
    upperArchRetention: "Fixed (Banded)",
    upperExpansionType: "Standard Hyrax RPE",
    orthoDesignComments: "note",
  });
  const ortho = devices.find((d) => d.deviceKey === "ortho-expander");
  assert.ok(ortho, "no ortho device emitted");
  assert.equal(ortho.deviceOptions.upperArchRetention, "Fixed (Banded)");
  assert.equal(ortho.deviceOptions.upperExpansionType, "Standard Hyrax RPE");
});

test("guard carries the standardGuards matrix through to the resolver", () => {
  const matrix = { "Essix Tray": { "UPPER ARCH": true } };
  const { devices } = formAnswersToCaseInput("digital", getForm("digital"), {
    devicesToOrder: ["nightguards"],
    standardGuards: matrix,
  });
  const guard = devices.find((d) => d.deviceKey === "guard");
  assert.deepEqual(guard.deviceOptions.standardGuards, matrix);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- form-to-case`
Expected: FAIL — no ortho device; `standardGuards` undefined.

- [ ] **Step 3: Delete `buildOrthoDevices` and the slug branch**

Remove the entire `buildOrthoDevices` function (lines 76-102). Replace lines 244-247 with:

```js
  const devices = buildDigitalDevices(answers);
```

- [ ] **Step 4: Add the ortho case and fix the guard case**

In `buildDigitalDevices`'s switch, replace the `"nightguards"` case and add `"ortho"`:

```js
      case "nightguards":
        devices.push(
          makeDevice("guard", {
            variant: answers.nightguardDevice?.[0],
            standardGuards: answers.standardGuards,
            modifications: answers.attachmentsModifications,
            comments: answers.nightguardComments,
          })
        );
        break;
      case "ortho":
        devices.push(
          makeDevice("ortho-expander", {
            applianceType: answers.selectDevice,
            upperArchRetention: answers.upperArchRetention,
            upperExpansionType: answers.upperExpansionType,
            lowerArchRetention: answers.lowerArchRetention,
            lowerExpansionType: answers.lowerExpansionType,
            upperExpansionSelection: answers.upperExpansionSelection,
            lowerExpansionSelection: answers.lowerExpansionSelection,
            tandemBowSetting: answers.tandemBowSetting,
            modifications: [
              ...(answers.addToMaxillary || []),
              ...(answers.addToMandibular || []),
              ...(answers.maxillaryAdd || []),
              ...(answers.mandibularAdd || []),
            ],
            comments: [answers.dualArchComments, answers.maxillaryComments, answers.orthoDesignComments].filter(Boolean).join(" | "),
          })
        );
        break;
```

`cleanOptions` already drops empty values, so absent answers do not appear.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(rx): one adapter path; ortho selections stop being discarded

buildOrthoDevices kept only comments and checkbox keys matching
/expansion/i, throwing away every retention, clasp, screw and material
selection before mapping. Guard now carries its standardGuards matrix."
```

---

### Task 11: Re-key the override seed

**Files:**
- Modify: `apps/api/src/db/seed-rx-overrides.js:24-33`
- Create: `apps/api/src/db/migrate-rx-override-keys.js`

**Interfaces:**
- Consumes: `DEVICE_ROWS`.
- Produces: `pnpm --filter @my-app/api db:migrate-rx-override-keys` remaps old mapKeys to new slugs.

- [ ] **Step 1: Re-key the seed**

Replace the `MAPPINGS` array in `seed-rx-overrides.js` with the new stable slugs:

```js
const MAPPINGS = [
  { mapKey: "primary:olmos-day:bioflex",        seazonaCode: "2527", seazonaName: "OD Bio Flex" },
  { mapKey: "primary:olmos-day:nylon",          seazonaCode: "2108", seazonaName: "OD Nylon" },
  { mapKey: "primary:olmos-day:acrylic-clasps", seazonaCode: "2103", seazonaName: "OD Acrylic W/Clasps" },
  { mapKey: "primary:olmos-day:dual-laminate",  seazonaCode: "2105", seazonaName: "OD Dual Laminate" },
  { mapKey: "primary:olmos-day:milled",         seazonaCode: "2106", seazonaName: "OD MILLED" },
  { mapKey: "primary:ara:default",              seazonaCode: "2592", seazonaName: "ARA- Nylon" },
  { mapKey: "primary:snorehook:default",        seazonaCode: "2154", seazonaName: "Snorehook" },
  { mapKey: "guard:essix:any",                  seazonaCode: "2161", seazonaName: "Essix Tray Non Printed (per arch)" },
];
```

- [ ] **Step 2: Write the key migration**

Create `apps/api/src/db/migrate-rx-override-keys.js`:

```js
/**
 * One-time remap of rx_code_overrides.map_key from the old label-derived keys
 * to the stable slugs introduced with catalog-map.
 *
 *   node --env-file=.env apps/api/src/db/migrate-rx-override-keys.js
 *   DRY_RUN=1 … to preview
 */
import { eq } from "drizzle-orm";
import { db, queryClient } from "../config/database.js";
import { rxCodeOverrides } from "./schema/rx-code-overrides.js";

const REMAP = {
  "primary:olmos-day:OD BIOFLEX":       "primary:olmos-day:bioflex",
  "primary:olmos-day:Printed Nylon":    "primary:olmos-day:nylon",
  "primary:olmos-day:Acrylic w/clasps": "primary:olmos-day:acrylic-clasps",
  "primary:olmos-day:Dual-Laminate":    "primary:olmos-day:dual-laminate",
  "primary:olmos-day:Milled":           "primary:olmos-day:milled",
  "primary:olmos-day:OD (PMT)":         "primary:olmos-day:pmt",
  "primary:ddso:Nylon":                 "primary:ddso:nylon",
  "primary:ddso:Biomed":                "primary:ddso:biomed",
  "primary:ara:default":                "primary:ara:default",
  "primary:mora:default":               "primary:mora:pmt",
  "primary:snorehook:SnoreHook":        "primary:snorehook:default",
  "primary:shirazi-hybrid:default":     "primary:shirazi-hybrid:nylon",
  "primary:cadcam-d-pro:default":       "primary:cadcam-d-pro:nylon",
  "primary:guard:Essix retainer (tray)": "guard:essix:any",
  "primary:guard:Whitening tray":        "guard:bleaching:any",
  "mod:Labial bow":                      "mod:labial-bow",
};

const DRY_RUN = process.env.DRY_RUN === "1";

async function run() {
  const rows = await db.select().from(rxCodeOverrides);
  let moved = 0;
  for (const row of rows) {
    const next = REMAP[row.mapKey];
    if (!next || next === row.mapKey) continue;
    console.log(`  ${row.mapKey}  →  ${next}  (${row.seazonaCode})`);
    moved++;
    if (DRY_RUN) continue;
    await db.update(rxCodeOverrides).set({ mapKey: next, updatedAt: new Date() }).where(eq(rxCodeOverrides.id, row.id));
  }
  console.log(`[migrate-rx-override-keys] ${rows.length} rows, ${moved} remapped${DRY_RUN ? " (no writes)" : ""}.`);
}

run()
  .catch((err) => { console.error("[migrate-rx-override-keys] FAILED:", err); process.exitCode = 1; })
  .finally(async () => { await queryClient.end({ timeout: 5 }).catch(() => {}); });
```

- [ ] **Step 3: Add the script**

In `apps/api/package.json` scripts:

```json
    "db:migrate-rx-override-keys": "node --env-file=.env src/db/migrate-rx-override-keys.js",
```

- [ ] **Step 4: Dry-run it**

Run: `cd apps/api && DRY_RUN=1 pnpm db:migrate-rx-override-keys`
Expected: completes without error. Local table is empty, so `0 rows, 0 remapped` is the expected local result.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(rx): re-key override seed to stable slugs + migration

rx_code_overrides keys on mapKey; the old keys embedded form wording, so
re-wording an option orphaned the lab's confirmation."
```

---

### Task 12: Generate the lab sign-off document

**Files:**
- Create: `apps/api/src/db/report-rx-mapping-gaps.js`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `DEVICE_ROWS`, `MODIFICATION_ROWS`, `ATTRIBUTE_ROWS`, `seazonaService.listProducts`.
- Produces: `pnpm --filter @my-app/api rx:mapping-report` writes `docs/rx-forms/mapping-status.md`.

- [ ] **Step 1: Write the generator**

Create `apps/api/src/db/report-rx-mapping-gaps.js`:

```js
/**
 * Generates the lab-facing mapping status document from the tables themselves,
 * so the document can never drift from what the system actually does.
 *
 *   node --env-file=.env apps/api/src/db/report-rx-mapping-gaps.js
 */
import fs from "node:fs";
import path from "node:path";
import { DEVICE_ROWS } from "../services/rx/catalog-map/devices.table.js";
import { MODIFICATION_ROWS } from "../services/rx/catalog-map/modifications.table.js";
import { ATTRIBUTE_ROWS } from "../services/rx/catalog-map/attributes.table.js";

const ALL = [...DEVICE_ROWS, ...MODIFICATION_ROWS, ...ATTRIBUTE_ROWS];
const by = (s) => ALL.filter((r) => r.status === s);

const line = (r) => `| ${r.match.join(" / ")} | ${r.code ?? "—"} | ${r.name} |`;

const doc = `# Rx → Seazona mapping status

Generated by \`pnpm rx:mapping-report\`. Do not edit by hand.

## Confirmed (${by("confirmed").length}) — no action needed

| Doctor selects | Seazona code | Product |
|---|---|---|
${by("confirmed").map(line).join("\n")}

## Proposed (${by("proposed").length}) — please confirm or correct

These are strong matches, but the form does not capture enough to be certain.

| Doctor selects | We propose | Product |
|---|---|---|
${by("proposed").map(line).join("\n")}

## Open (${by("open").length}) — we need your decision

Nothing here is sent to Seazona. Orders using these selections are held.

| Doctor selects | Why it's open |
|---|---|
${by("open").map((r) => `| ${r.match.join(" / ")} | ${r.name} |`).join("\n")}
`;

const out = path.resolve(process.cwd(), "../../docs/rx-forms/mapping-status.md");
fs.writeFileSync(out, doc);
console.log(`[rx-mapping-report] wrote ${out} — ${by("confirmed").length} confirmed, ${by("proposed").length} proposed, ${by("open").length} open`);
```

- [ ] **Step 2: Add the script**

In `apps/api/package.json` scripts:

```json
    "rx:mapping-report": "node src/db/report-rx-mapping-gaps.js",
```

- [ ] **Step 3: Run it**

Run: `cd apps/api && pnpm rx:mapping-report`
Expected: writes `docs/rx-forms/mapping-status.md` and prints the three counts.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(rx): generate the lab mapping sign-off document from the tables

The document is derived from the same rows the resolver reads, so it
cannot claim something different from what the system does."
```

---

### Task 13: Full verification

- [ ] **Step 1: Run everything**

Run: `pnpm test`
Expected: PASS across web, api, shared.

- [ ] **Step 2: Confirm every committed code exists in the live catalog**

Run:

```bash
cd apps/api && node --env-file=../../.env -e '
const {DEVICE_ROWS}=await import("./src/services/rx/catalog-map/devices.table.js");
const {MODIFICATION_ROWS}=await import("./src/services/rx/catalog-map/modifications.table.js");
const {ATTRIBUTE_ROWS}=await import("./src/services/rx/catalog-map/attributes.table.js");
const auth="Basic "+Buffer.from(`${process.env.SEAZONA_API_KEY}:${process.env.SEAZONA_SECRET}`).toString("base64");
const r=await fetch(`${process.env.SEAZONA_BASE_URL}v1/products`,{headers:{Authorization:auth,"Content-Type":"application/json"}});
const codes=new Set((await r.json()).map(p=>p.code));
const bad=[...DEVICE_ROWS,...MODIFICATION_ROWS,...ATTRIBUTE_ROWS].filter(x=>x.code&&!codes.has(x.code));
console.log(bad.length?"INVALID: "+bad.map(b=>b.mapKey+"->"+b.code).join(", "):"all codes valid");
process.exit(bad.length?1:0);'
```

Expected: `all codes valid`.

- [ ] **Step 3: Verify no dead references**

Run: `grep -rn "device-seazona-map\|orthodonticRxForm\|olmosRxForm\|buildOrthoDevices" apps packages --include=*.js --include=*.jsx | grep -v node_modules`
Expected: no output.

- [ ] **Step 4: Push**

```bash
git push
```

---

## Deferred — needs a lab decision, not code

Routed into `docs/rx-forms/mapping-status.md` by Task 12:

- **Olmos Night material.** `onDesign` picks OND/ONP/ONR but no base-material question exists, and each family has 6–7 material SKUs. ON-T resolves only because it exists solely in Nylon. The JotForm had this question (qid 270); both UIs dropped it. Restoring it turns 3 `open` rows into ~20 `confirmed` ones.
- **D-Pro, Shirazi, MORA material** — currently `proposed` at the single most likely SKU.
- **"Occlusal Guard - Slider Type"** — ambiguous between NTI Slider-Type (2175/2176) and FLATPLANE (2162/2163/2531). Note `nightguardDevice` asks a near-identical question; the two may want merging.
- **DDSO BioFlex (2532)** exists in the catalog but the form offers only NYLON/BIOMED.
- **DDSO 4-piece (2609 $625 / 2610 $675)** — no form field distinguishes these from the standard $465 build.
- **Ortho appliance taxonomy** — ~36 catalog products against one form device.
- **Rush codes 2320–2324** ($75–$200) are priced products currently written into the notes string.
