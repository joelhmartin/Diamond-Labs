/**
 * PR #43 review findings: an accessory-only ortho order must not pass as a
 * complete device; saved overrides must apply to held ortho rulings (per
 * arch); ortho build detail must reach the pushed order's notes.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveOrtho, orthoBuildNotes } from "./ortho.js";
import { resolveLineItems, isDeviceLine } from "../index.js";
import { linesForDevices } from "../../case-lines.service.js";
import { canPush } from "../../case-gates.js";
import { compileNotes, buildSeazonaOrderPayload } from "../../build-order-payload.js";
import { resolveGuard } from "./guard.js";

// ── 1. Accessories alone are not an appliance ──────────────────────────────

const ACCESSORY_ONLY = [
  ["a transfer tray alone", { upperAddOns: ["Transfer tray for composite buttons"] }],
  ["hooks + palatal pads alone", { upperAddOns: ["Buccal hooks for tandem elastics", "Palatal pads"] }],
];

for (const [label, opts] of ACCESSORY_ONLY)
  test(`${label} holds the device as ortho:unspecified`, () => {
    const out = resolveOrtho(opts);
    assert.ok(out.items.length > 0, "the priced add-on still resolves");
    assert.ok(out.unmapped.includes("ortho:unspecified"), `expected ortho:unspecified, got ${out.unmapped}`);
  });

test("an add-on-only ortho case seeds a blocking line and cannot be pushed", () => {
  const lines = linesForDevices([
    { deviceKey: "ortho-expander", deviceOptions: { upperAddOns: ["Transfer tray for composite buttons"] } },
  ]).map((l) => ({ ...l, seazonaCode: l.seazonaCode ?? null }));
  assert.ok(lines.some((l) => l.mapKey === "ortho:unspecified" && l.status === "open"));
  assert.equal(canPush(lines).ok, false);
});

test("the order builder does not count ortho bands / add-ons as a device line", () => {
  for (const k of ["ortho:addon:transfer-tray", "ortho:upper:bands:banded", "ortho:lower:addon:tandem-sheaths", "ortho:typed:upperAddOns"])
    assert.equal(isDeviceLine(k), false, k);
  for (const k of ["ortho:tandem:bow", "ortho:upper:fixed:variety-click", "ortho:lower:mandibular:fixed:e-arch", "guard:essix-tray:any"])
    assert.equal(isDeviceLine(k), true, k);

  const { ok, warnings } = buildSeazonaOrderPayload(
    { deviceKey: "ortho-expander", deviceOptions: { upperAddOns: ["Transfer tray for composite buttons"] } },
    { codeToId: { 2313: "id-2313" } }
  );
  assert.equal(ok, false);
  assert.ok(warnings.some((w) => /no device line resolved/.test(w)));
});

test("canPush refuses a case whose sendable lines are only accessories — even with codes", () => {
  const line = (mapKey, code) => ({ mapKey, seazonaCode: code, status: "confirmed", noteOnly: false });
  assert.equal(canPush([line("ortho:addon:transfer-tray", "2313"), line("service:model-fab", "2367")]).ok, false);
  assert.equal(canPush([line("service:model-fab", "2367")]).ok, false, "the #42 service-only gate still holds");
  assert.equal(canPush([line("ortho:tandem:bow", "2217"), line("ortho:addon:transfer-tray", "2313")]).ok, true);
  assert.equal(canPush([{ mapKey: null, sourceLabel: "staff line", seazonaCode: "2217", status: "confirmed" }]).ok, true, "a staff-added line is an appliance");
});

// ── 2. Overrides on held ortho rulings ──────────────────────────────────────

test("an 'always' override on an open ortho row takes effect", () => {
  const overrides = { "ortho:twin-block": { code: "2220", name: "Twin Block - Biomed" } };
  const { items, unmapped } = resolveLineItems({ deviceKey: "ortho-expander", deviceOptions: { applianceType: "Twin Block" } }, { overrides });
  assert.deepEqual(unmapped, []);
  assert.deepEqual(items.map((i) => [i.code, i.mapKey, i.overridden]), [["2220", "ortho:twin-block", true]]);
});

test("overrides on open ortho rows apply per arch — upper and lower stay separate lines", () => {
  const overrides = {
    "ortho:upper:fixed:standard-transverse": { code: "2225", name: "Upper Fixed Slim-Line Hyrax" },
    "ortho:lower:nylon:variety-click": { code: "2203", name: "Md. Printed Tandem (Nylon) - Std. Expansion Screw" },
  };
  const { items, unmapped } = resolveLineItems(
    {
      deviceKey: "ortho-expander",
      deviceOptions: {
        upperArchRetention: "Fixed [3D Printed] Bands",
        upperExpansionType: "Standard Transverse Screw",
        lowerArchRetention: "Printed NYLON w/ composite retention",
        lowerExpansionType: 'Slim-line "Variety-Click"',
      },
    },
    { overrides }
  );
  assert.deepEqual(unmapped, []);
  const appliance = items.filter((i) => !i.mapKey.includes(":bands:")).map((i) => [i.code, i.arch]);
  assert.deepEqual(appliance, [["2225", "upper"], ["2203", "lower"]]);
});

test("a noteOnly override clears an open ortho add-on; a codeless incoherent one stays held", () => {
  const key = "ortho:upper:addon:occlusal-rest-s";
  const base = { deviceKey: "ortho-expander", deviceOptions: { applianceType: "Modified Tandem", upperAddOns: ["Occlusal Rest(s)"] } };
  const noteOnly = resolveLineItems(base, { overrides: { [key]: { noteOnly: true } } });
  assert.deepEqual(noteOnly.unmapped, []);
  assert.ok(noteOnly.items.some((i) => i.noteOnly && i.mapKey === key && i.arch === "upper"));

  const incoherent = resolveLineItems(base, { overrides: { [key]: { name: "?" } } });
  assert.deepEqual(incoherent.unmapped, [key]);
});

test("ortho:unspecified can never be overridden into a passing order", () => {
  const { unmapped } = resolveLineItems(
    { deviceKey: "ortho-expander", deviceOptions: {} },
    { overrides: { "ortho:unspecified": { code: "2217", name: "Tandem Bow" } } }
  );
  assert.deepEqual(unmapped, ["ortho:unspecified"]);
});

test("guard's arch-less unmapped keys still skip overrides (no two-arch collapse)", () => {
  const opts = { standardGuards: { "Nightguard - Full Occlusion": { "UPPER ARCH": true, "LOWER ARCH": true, "Base Material": "Lab Decision" } } };
  const key = resolveGuard(opts).unmapped[0];
  const { items, unmapped } = resolveLineItems({ deviceKey: "guard", deviceOptions: opts }, { overrides: { [key]: { code: "2176", name: "x" } } });
  assert.deepEqual(items, []);
  assert.deepEqual(unmapped, [key]);
});

// ── 3. Ortho build detail reaches the order notes ───────────────────────────

const DETAIL = {
  mxSelections: "Fixed (Banded)",
  tandemBowSetting: "3",
  requiredSelection: {
    "Maxillary__Place bands on:": "6's",
    "Maxillary__Occlusal rest on:": "",
    "Mandibular__Composite build up on:": "D's and E's",
  },
  occlusalOptionsTandem: { "Mandibular__Occlusal coverage on:": "molars" },
  lowerExpansionSelection: { "E-Arch__FIXED": "x" },
  nuveloDigitalSetup: { "Setup Instructions__Orient to HIP": "yes" },
  digitalSetupEmail: "setup@example.test",
  digitalStudyModels: "Digital Models ONLY - ABO - Full Base",
};

test("orthoBuildNotes renders each answered question as one readable fragment", () => {
  assert.deepEqual(orthoBuildNotes(DETAIL), [
    "Mx. selection: Fixed (Banded)",
    "Tandem bow: 3 mm from incisal edge of lower anteriors",
    "Required selection: Maxillary: Place bands on: 6's / Mandibular: Composite build up on: D's and E's",
    "Tandem occlusal options: Mandibular: Occlusal coverage on: molars",
    "LOWER expansion selection: E-Arch: FIXED: x",
    "NUVELO digital setup: Setup Instructions: Orient to HIP: yes",
    "Send digital setup to: setup@example.test",
    "Digital study models: Digital Models ONLY - ABO - Full Base",
  ]);
  assert.deepEqual(orthoBuildNotes({}), []);
});

test("the pushed order's notes carry the ortho build detail, with no raw JSON", () => {
  const notes = compileNotes({ deviceKey: "ortho-expander", deviceOptions: { applianceType: "Modified Tandem", ...DETAIL } });
  assert.match(notes, /Tandem bow: 3 mm/);
  assert.match(notes, /Required selection: Maxillary: Place bands on: 6's/);
  assert.match(notes, /Digital study models: /);
  assert.doesNotMatch(notes, /[{}"]|__/, "notes must not contain raw JSON or matrix keys");
});
