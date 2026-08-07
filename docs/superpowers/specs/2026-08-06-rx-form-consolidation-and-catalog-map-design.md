# Rx Form Consolidation + Seazona Catalog Map — Design

**Date:** 2026-08-06
**Status:** Approved (sections 1–3)

## Problem

Three things are wrong at once, and they share a seam.

**1. The map is keyed to the wrong UI.** `apps/api/src/services/rx/device-seazona-map.js`
is keyed to the option strings of the older device wizard (`apps/web/src/data/rx-devices.js`,
served at `/app/cases/new`). The forms doctors actually use — `/app/rx/*` — emit different
strings (`"NYLON"` vs `"Nylon"`). Checked against the live Seazona catalog (392 products,
fetched 2026-08-06): of 60 mappings in the file, **8 resolve and 52 produce nothing** (87%).

Every `// TODO verify` placeholder (`OD_NYLON`, `ON_DEPROG`, `CADCAM_D_PRO`, …) resolves to
no catalog id. Separately, code `2147` (mapped as "DDSO Nylon") **does not exist** in the
live catalog; the real code is `2608`.

Severity note: the doctor-facing push is gated dark behind `RX_LIVE_PUSH`
(`apps/api/src/routes/rx.routes.js:712`; `createOrder` is still a TODO at :716), so no
malformed order has reached Seazona through that path. The admin mapping tester
(`POST /admin/rx-mapping/send-test`, `admin-rx-mapping.routes.js:318`) **does** write real
orders under a test client, so the map is already exercised for real.

**2. Two forms exist for structural reasons that no longer apply.** `digital` and `ortho`
share only 5 field keys — `patientName`, `firstDevice`, `dueDate`, `doctorSignature`,
`rushCase` — the universal wrapper. Everything else is disjoint. But `ortho` is structurally
just *one more device*: digital is already built as "shared header → device multi-select →
one section per device → shared footer", and ortho's three content sections
(`functionalDualArch`, `maxillaryUpper`, `mandibularLower`) fit that pattern exactly.

They are split because the source JotForms were split, and these are faithful ports of that
split. JotForm made heavy conditional logic painful; this app has `showIf` section gating.
The constraint is gone.

Consequence of the split: `form-to-case.js:80-102` (`buildOrthoDevices`) keeps only comments
and checkbox keys matching `/expansion/i`, **discarding every retention, clasp, screw,
material, and arch selection** before mapping.

`olmos` is a near-duplicate of `ortho` — 7 of 8 section ids identical, 21 shared field keys,
and most "olmos-only" keys are renames (`mxExpansionType`↔`upperExpansionType`,
`addMxArch`↔`addToMaxillary`, `olmosArtboard`↔`dualArchArtboard`). It is being retired.

**3. The form is measurably hard to read.** Field labels, matrix headers, help text,
placeholders and captions render as `text-navy` at 20–50% opacity on white. Navy is
`rgb(11 26 46)`; at those opacities it composites to literal gray. Five of the eight
opacity levels in use fail WCAG AA, compounded by 10–11px type.

## Evidence: how a form selection maps to a Seazona product

Seazona product names follow a rigid grammar: `<DEVICE> <MATERIAL> [<MODE>]`.

| Device | PMT | AcrClasp | AcrOnly | DualLam | Milled | Biomed | BioFlex | Nylon |
|---|---|---|---|---|---|---|---|---|
| OD | 2102 | 2103 | 2104 | 2105 | 2106 | 2107 | 2527 | 2108 |
| OND | 2114 | 2115 | 2116 | 2117 | — | 2118 | 2524 | 2119 |
| ONP | 2125 | 2126 | 2127 | 2128 | — | 2129 | 2523 | 2130 |
| ONR | 2137 | 2138 | 2139 | 2140 | — | 2141 | 2522 | 2142 |
| ONT | — | — | — | — | — | — | — | 2144 |
| DDSO | — | — | — | — | — | 2146 | 2532 | 2608 |
| Dorsal Pro | — | — | — | — | — | — | 2540 | 2539 |
| Nightguard | 2164 | — | — | 2167 | — | 2165 | — | 2166 |

The forms were authored *from* this catalog. Verified 1:1 matches against real form strings:

- **DDSO modifications — 6/6:** `"Tongue Positioners"`→2330, `"Hooks for Elastics"`→2319,
  `"Vertical Shims"`→2302, `"ON Loop"`→2300, `"BAB Loop"`→2303, `"ON Ramp"`→2301
- **Occlusal contact — 4/4 ($0 items):** Posterior→2293, Anterior→2289, FULL→2292, TRIPOD→2291
- **Design preference — 2/2 ($0 items):** Lingual-Free→2314, Buccal-Free→2308
- **Guard rows — 7/7:** NTI→2175/76, Michigan→2169/70, Essix→2161, Bleaching→2155,
  Neurosensory Stent→2597, Full Occlusion→2164/65/66
- **Guard base material — 5/5:** PMT→2164, BIOMED→2165, Nylon→2166, Dual-Laminate→2167,
  Acrylic→2428

`ONT` exists only in Nylon, and the form label reads "TITRATION (ON-T) - NYLON Only".

**Fabrication mode is NOT an axis.** The catalog has ~90 remake/sample/reprint products, but
no form captures the choice — `digital-rx.form.js:11` records the Remake/Repair/Redesign
section was removed per lab-owner feedback ("new-device forms only"). A `mode` dimension
would be hard-coded to "new" on every lookup. Excluded as YAGNI.

## Section 1 — One form

Add a ninth option to `devicesToOrder`:
`{ value: "ortho", label: "Orthodontic Appliance — Expanders / Tandem / Twin Block" }`.

Move ortho's three content sections into `digital-rx.form.js` gated on
`showIf: { key: "devicesToOrder", includes: "ortho" }` — the mechanism the other eight
devices already use. Fields move **verbatim**; no clinical question is redesigned.

Ortho's duplicate wrapper fields are dropped in favour of digital's equivalents:

| Concept | digital (keep) | ortho (drop) |
|---|---|---|
| Records type | `records` | `recordsType` |
| Physical bite | `physicalBite` | `sendingPhysicalBite` |
| File upload | `recordsUpload` | `uploadFiles` |

Ortho's genuine extras move to the matching shared section: `rushChargeBiomed`,
`rushChargeNylon` and `additionalComments` to the shared submit section; `caseDate` to the
shared case-identification section (where it lives in ortho today).

Delete: `olmos-rx.form.js`, its test, the `/app/rx/olmos` route, `RX_OLMOS` in
`config/routes.js`, its entry in `forms/index.js` and `FORM_LIST`, and the `"olmos"` member
of `rxFormSubmitSchema.formType` (`packages/shared/src/schemas/rx.schema.js:62`).

`form-to-case.js` loses the `slug === "ortho" || slug === "olmos"` branch and
`buildOrthoDevices` entirely. One adapter path. Ortho's selections stop being discarded.

**Section-visibility fix (required, not optional).** There are two divergent implementations:
`FormRenderer.jsx:171-184` handles `{ key, includes }`; `form-logic.js:24-31` does not, and
`allFields` never checks section-level `showIf` at all. Today this is latent — no gated
section has a required field. Once ortho's sections are gated, any required field inside one
would make `validateForm` block submission on a field the doctor cannot see. Consolidate to a
single `sectionVisible` in `form-logic.js`, have `FormRenderer` import it, and make
`visibleFields` respect section gating.

## Section 2 — The map

`device-seazona-map.js` splits into:

```
apps/api/src/services/rx/catalog-map/
  index.js                 resolveLineItems — signature UNCHANGED
  devices.table.js         device × material          (data)
  modifications.table.js   modification → code        (data)
  attributes.table.js      occlusal contact / design preference → $0 codes
  resolvers/guard.js       guard type × arch × material
  resolvers/ortho.js       ortho parameter tree
```

`build-order-payload.js` is untouched — it keeps calling
`resolveLineItems({deviceKey, deviceOptions}, {overrides})` and receiving `{items, unmapped}`.

**Row shape:**

```js
{ mapKey: "primary:ddso:nylon",   // stable slug — NEVER derived from form wording
  device: "ddso",
  match:  ["NYLON", "Nylon"],     // accepted form literals
  code:   "2608",
  name:   "DDSO Nylon",
  status: "confirmed" }
```

Decoupling `mapKey` from the label means re-wording a form option cannot orphan a confirmed
override. `match` holding multiple literals lets the old wizard's `"Nylon"` and the form's
`"NYLON"` resolve to the same row, so the wizard's fate does not gate this work.

**Status semantics:**

| Status | Emits? | Meaning |
|---|---|---|
| `confirmed` | yes | Lab signed off, or unambiguous 1:1 catalog name match |
| `proposed` | yes, tagged | Strong catalog match, wants lab confirmation |
| `open` | **never** — always `unmapped` | Genuinely ambiguous or absent |

This preserves "never guess a code" while not treating *evidence* as a guess.

**Behaviour changes:**

1. Occlusal contact and design preference become $0 line items rather than note text.
   Notes carry only doctor free-text.
2. `build-order-payload.js:22-25` and `:156-159` currently `continue` past an unresolvable
   code, emitting only a warning — so an order can reach the lab missing its device line.
   It must refuse to build a payload that lost its primary device line.

**Override compatibility.** `rx_code_overrides` keys on `mapKey` (unique index). Local table
is empty; `seed-rx-overrides.js` is the origin and holds 8 entries keyed to old wizard
wording. Re-key the seed to the new stable slugs and ship a one-time migration mapping old
key → new key so any admin-confirmed production rows survive.

Note: the 8 seeded codes (2527, 2108, 2103, 2105, 2106, 2592, 2154, 2161) independently
corroborate codes derived from the catalog by a separate route.

**Lab sign-off document is generated**, not written: a script reads the tables and emits
every `open` and `proposed` row, so the artifact cannot drift from behaviour. Lab answers
return as row edits plus `status: "confirmed"`.

## Section 3 — Readability layer

Scoped as a readability pass, not a redesign. No new visual direction, no re-layout.

Measured (navy `rgb(11 26 46)` on white):

| Opacity | Composite | Ratio | AA normal |
|---|---|---|---|
| 100% | rgb(11,26,46) | 17.48 | pass |
| 70% | rgb(84,95,109) | 6.49 | pass |
| 60% | rgb(109,118,130) | 4.60 | pass |
| 50% | rgb(133,141,151) | 3.36 | **fail** |
| 45% | rgb(145,152,161) | 2.91 | **fail** |
| 40% | rgb(157,163,171) | 2.54 | **fail** |
| 30% | rgb(182,186,192) | 1.95 | **fail** |
| 25% | rgb(194,198,203) | 1.72 | **fail** |
| 20% | rgb(206,209,213) | 1.53 | **fail** |

Worst offenders: every field label (`fields.jsx:22`, `/40` @ `text-xs` uppercase); matrix
column headers (`:317,323`, `/40` @ 10px); help text (`:188`, `/45` @ 11px); placeholders
(`:18`, `/25`); upload hints (`:484,522`, `/30`,`/25` @ 10px).

**Changes:**

1. Collapse eight ad-hoc opacities to three semantic tokens: `text-primary` (navy, 17.5),
   `text-secondary` (navy/70, 6.5), `text-muted` (navy/60, 4.6). Nothing below `/60` carries
   text; `/50` and below remain legal for borders and decorative icons only (3:1 bar).
2. Minimum 12px type — `text-[10px]` / `text-[11px]` labels and headers go to 12px.
3. Field labels: sentence case, 13px, `text-secondary`, semibold — replacing tiny letterspaced
   uppercase at 40%.

## Testing

- **Table integrity:** every `code` in every table exists in the live Seazona catalog. This
  is the test that would have caught `2147`.
- **Resolution:** table-driven cases per device asserting form literal → expected code;
  `open` rows never emit; DB override beats table.
- **Payload:** unresolvable primary device fails loudly rather than silently dropping.
- **Form:** consolidated form contains every ortho field key; no `olmos` references remain;
  gated sections invisible and non-validating when their device is unselected.
- **Contrast:** every text token computes ≥4.5:1 against its background.

## Out of scope

- Fate of the `/app/cases/new` wizard — deferred; `match` lists make it a non-blocker.
- Fabrication mode (remake/sample/reprint) — no form captures it.
- Rush codes 2320–2324 as line items — currently a note string; worth revisiting, not here.
- DDSO 4-piece variants (2609/2610), "Slider Type" NTI-vs-FLATPLANE ambiguity, and the ortho
  appliance taxonomy — genuine lab decisions, routed to the sign-off document.
