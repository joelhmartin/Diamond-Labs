/**
 * Ortho resolver rules, table-driven from the order history the rules were
 * read off (JotForm ortho prescriptions matched to the Seazona orders the lab
 * built from them, Jan 2025–Oct 2026). Each case names the evidence it encodes.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveOrtho, ORTHO_ROWS } from "./ortho.js";
import { resolveLineItems } from "../index.js";

const BANDED = "Fixed (Banded)";
const PRINTED = "Fixed [3D Printed] Bands";
const ACRYLIC = "Acrylic w/ clasp retention";
const NYLON = "Printed NYLON w/ composite retention";
const UVC = 'Slim-line "Variety-Click" (Fixed ONLY)';
const LVC = 'Slim-line "Variety-Click"';

/** Codes of the lines for one arch (null = dual-arch / case-level). */
const codes = ({ items }, arch) => items.filter((i) => i.arch === arch).map((i) => i.code);

// [label, upper retention, upper screw, expected upper appliance code | null (held)]
const UPPER = [
  ["fixed + Variety-Click → 2226 (110 Rx, 95%)", BANDED, UVC, "2226"],
  ["3D-printed bands count as fixed → 2226", PRINTED, UVC, "2226"],
  ["fixed + Memory → 2222 (28 Rx, 96%)", BANDED, "Memory Screw (Fixed ONLY)", "2222"],
  ["fixed + Slim-Line Screw → 2225 (17 Rx, 82%)", BANDED, "Slim-Line Screw", "2225"],
  ["fixed + Standard Hyrax → 2225 (17 Rx, 82%)", BANDED, "Standard Hyrax RPE (Fixed ONLY)", "2225"],
  ["fixed + Standard Transverse → held (split 2225/2222/2178)", BANDED, "Standard Transverse Screw", null],
  ["fixed + NiTi → held (no history)", BANDED, "NiTi - Nickel Titanium (Fixed ONLY)", null],
  ["fixed + No Expansion → held", BANDED, "No Expansion", null],
  ["acrylic upper → held (too rare / mixed)", ACRYLIC, "Slim-Line Screw", null],
  ["printed-nylon upper → held", NYLON, "Standard Transverse Screw", null],
];

for (const [label, retention, screw, code] of UPPER)
  test(`upper appliance: ${label}`, () => {
    const out = resolveOrtho({ upperArchRetention: retention, upperExpansionType: screw });
    const appliance = out.items.filter((i) => i.arch === "upper" && !i.mapKey.includes(":bands:"));
    if (code) {
      assert.deepEqual(appliance.map((i) => i.code), [code]);
    } else {
      assert.equal(appliance.length, 0, "a held combination must never emit an appliance line");
      assert.ok(out.unmapped.some((k) => k.startsWith("ortho:upper:")), `expected an upper hold, got ${out.unmapped}`);
    }
  });

// [label, lower retention, lower screw, expected lower appliance code | null]
const LOWER = [
  ["acrylic + Variety-Click → 2192 (62 Rx, 94%)", ACRYLIC, LVC, "2192"],
  ["fixed + Variety-Click → 2190 (43 Rx, 98%)", BANDED, LVC, "2190"],
  ["acrylic + Standard Transverse → 2412 (21 Rx, 95%)", ACRYLIC, "Standard Transverse Screw", "2412"],
  ["acrylic + Slim-Line → 2412 (proposed; 2639 [Slim-line] also exists)", ACRYLIC, "Slim-Line Screw", "2412"],
  ["acrylic + Memory → 2569 (8 Rx, 100%)", ACRYLIC, "Memory Screw (Removable Only)", "2569"],
  ["fixed + No Expansion → 2191 lingual holding arch (3 Rx, 100%)", BANDED, "No Expansion", "2191"],
  ["fixed + Slim-Line → 2189", BANDED, "Slim-Line Screw", "2189"],
  ["printed nylon → held (2203 on only 50%)", NYLON, LVC, null],
  ["fixed + Standard Transverse → held", BANDED, "Standard Transverse Screw", null],
  ["acrylic + No Expansion → held", ACRYLIC, "No Expansion", null],
];

for (const [label, retention, screw, code] of LOWER)
  test(`lower appliance: ${label}`, () => {
    const out = resolveOrtho({ lowerArchRetention: retention, lowerExpansionType: screw });
    const appliance = out.items.filter((i) => i.arch === "lower" && !i.mapKey.includes(":bands:"));
    if (code) assert.deepEqual(appliance.map((i) => i.code), [code]);
    else {
      assert.equal(appliance.length, 0);
      assert.ok(out.unmapped.some((k) => k.startsWith("ortho:lower:")), `expected a lower hold, got ${out.unmapped}`);
    }
  });

test("statuses follow the evidence strength", () => {
  const status = (k) => ORTHO_ROWS.find((r) => r.mapKey === k).status;
  assert.equal(status("ortho:upper:fixed:variety-click"), "confirmed");
  assert.equal(status("ortho:upper:fixed:memory"), "confirmed");
  assert.equal(status("ortho:upper:fixed:hyrax"), "proposed");
  assert.equal(status("ortho:upper:fixed:standard-transverse"), "open");
  assert.equal(status("ortho:lower:acrylic:variety-click"), "confirmed");
  assert.equal(status("ortho:lower:acrylic:slim-line"), "proposed");
  assert.equal(status("ortho:lower:fixed:no-expansion"), "proposed");
  assert.equal(status("ortho:twin-block"), "open");
});

test("fixed mandibular: E-Arch → 2186 (12/12), Williams → 2180 (9/10), Variety Click held", () => {
  assert.deepEqual(codes(resolveOrtho({ fixedMandibularExpansion: ["Mandibular E-Arch"] }), "lower"), ["2186"]);
  assert.deepEqual(codes(resolveOrtho({ fixedMandibularExpansion: ["Mandibular Williams"] }), "lower"), ["2180"]);
  const vc = resolveOrtho({ fixedMandibularExpansion: ["Mandibular Slim-line 'Variety Click' Expander"] });
  assert.deepEqual(vc.items, []);
  assert.deepEqual(vc.unmapped, ["ortho:lower:mandibular:fixed:variety-click"]);
});

test("a mandibular-expansion pick replaces the retention × screw appliance (no E-Arch order also carried 2190)", () => {
  const out = resolveOrtho({
    lowerArchRetention: BANDED,
    lowerExpansionType: LVC,
    fixedMandibularExpansion: ["Mandibular E-Arch"],
  });
  const appliance = out.items.filter((i) => i.arch === "lower" && !i.mapKey.includes(":bands:"));
  assert.deepEqual(appliance.map((i) => i.code), ["2186"]);
});

test("removable mandibular: Memory → 2569 proposed; Schwarz and Slim-line held", () => {
  const mem = resolveOrtho({ removableMandibularExpansion: ["Mandibular Memory Screw"] });
  assert.deepEqual(mem.items.map((i) => [i.code, i.status]), [["2569", "proposed"]]);
  assert.deepEqual(resolveOrtho({ removableMandibularExpansion: ["Mandibular Schwarz"] }).unmapped, ["ortho:lower:mandibular:removable:schwarz"]);
  assert.deepEqual(resolveOrtho({ removableMandibularExpansion: ["Mandibular Slim-line"] }).unmapped, ["ortho:lower:mandibular:removable:slim-line"]);
});

// [label, options, upper band codes, lower band codes]
const BANDS = [
  ["banded upper → 2 × 2198", { upperArchRetention: BANDED }, ["2198", "2198"], []],
  ["3D-printed upper → 2 × 2572 (14/14)", { upperArchRetention: PRINTED }, ["2572", "2572"], []],
  [
    "buccal tubes on a banded upper → 2 × 2199 instead of 2198",
    { upperArchRetention: BANDED, upperAddOns: ["Buccal tubes to bands"] },
    ["2199", "2199"],
    [],
  ],
  ["both arches banded → 4 bands", { upperArchRetention: BANDED, lowerArchRetention: BANDED }, ["2198", "2198"], ["2198", "2198"]],
  [
    "banded lower on a Modified Tandem → 2 × 2199 (90% of 58 banded-lower Rx)",
    { applianceType: "Modified Tandem", lowerArchRetention: BANDED },
    [],
    ["2199", "2199"],
  ],
  [
    "headgear tubes on a banded lower → 2 × 2199",
    { lowerArchRetention: BANDED, lowerAddOns: ["Headgear tubes for tandem to bands"] },
    [],
    ["2199", "2199"],
  ],
  ["3D-printed lower → 2 × 2572", { lowerArchRetention: PRINTED }, [], ["2572", "2572"]],
  ["acrylic arches carry no bands", { upperArchRetention: ACRYLIC, lowerArchRetention: ACRYLIC }, [], []],
];

for (const [label, opts, upper, lower] of BANDS)
  test(`bands: ${label}`, () => {
    const out = resolveOrtho(opts);
    const bands = (arch) => out.items.filter((i) => i.arch === arch && i.mapKey.includes(":bands:")).map((i) => i.code);
    assert.deepEqual(bands("upper"), upper);
    assert.deepEqual(bands("lower"), lower);
  });

test("bands: a 'Place bands on:' answer holds that arch's bands for a human count", () => {
  const out = resolveOrtho({
    upperArchRetention: BANDED,
    lowerArchRetention: BANDED,
    requiredSelection: { "Maxillary__Place bands on:": "4's and 6's" },
  });
  assert.ok(out.unmapped.includes("ortho:upper:bands:teeth-specified"));
  assert.deepEqual(out.items.filter((i) => i.arch === "upper").map((i) => i.code), []);
  assert.deepEqual(out.items.filter((i) => i.arch === "lower").map((i) => i.code), ["2198", "2198"]);
});

test("Modified Tandem → 2217 Tandem Bow (189 Rx, 94%), plus 2219 tubes only on an acrylic lower (98% of 103)", () => {
  const banded = resolveOrtho({ applianceType: "Modified Tandem", lowerArchRetention: BANDED });
  assert.ok(banded.items.some((i) => i.code === "2217"));
  assert.ok(!banded.items.some((i) => i.code === "2219"), "a banded lower carries its tubes on 2199 bands");

  const acrylic = resolveOrtho({ applianceType: "Modified Tandem", lowerArchRetention: ACRYLIC });
  assert.deepEqual(acrylic.items.map((i) => i.code).sort(), ["2217", "2219"]);
});

test("Twin Block is held (one order in 21 months)", () => {
  const out = resolveOrtho({ applianceType: "Twin Block" });
  assert.deepEqual(out.items, []);
  assert.deepEqual(out.unmapped, ["ortho:twin-block"]);
});

// [label, upper add-ons, lower add-ons, expected codes, expected unmapped]
const ADDONS = [
  ["buccal hooks for tandem elastics → 2195 (163 Rx, 95–98%)", ["Buccal hooks for tandem elastics"], [], ["2195"], []],
  ["transfer tray → 2313 (74 Rx, 95–96%)", ["Transfer tray for composite buttons"], [], ["2313"], []],
  ["transfer tray ticked on both arches is one tray", ["Transfer tray for composite buttons"], ["Transfer tray for composite buttons"], ["2313"], []],
  ["palatal pads → 2181 (proposed, 86–89%)", ["Palatal pads"], [], ["2181"], []],
  ["tandem-bow sheaths → 2219", [], ["Sheaths for Tandem Bow (Removable)"], ["2219"], []],
  ["lingual guide arm has no product of its own → held", ["Lingual guide arm (distal)"], [], [], ["ortho:upper:addon:lingual-guide-arm-distal"]],
  ["lap springs: count not captured → held", [], ["Anterior lap springs"], [], ["ortho:lower:addon:anterior-lap-springs"]],
  ["buccal tubes on an un-banded arch → held", ["Buccal tubes to bands"], [], [], ["ortho:upper:addon:buccal-tubes-to-bands"]],
  ["an add-on the form never offered → held as typed", ["Extra spur, please"], [], [], ["ortho:typed:upperAddOns"]],
];

for (const [label, upperAddOns, lowerAddOns, expectCodes, expectUnmapped] of ADDONS)
  test(`add-ons: ${label}`, () => {
    // On a Modified Tandem: add-ons ride on an appliance (alone they hold the
    // device as ortho:unspecified — see ortho.review-fixes.test.js).
    const out = resolveOrtho({ applianceType: "Modified Tandem", upperAddOns, lowerAddOns });
    assert.deepEqual(out.items.filter((i) => !i.mapKey.startsWith("ortho:tandem:")).map((i) => i.code), expectCodes);
    assert.deepEqual(out.unmapped, expectUnmapped);
  });

test("sheath add-ons don't double the 2219 a tandem with an acrylic lower already carries", () => {
  const out = resolveOrtho({
    applianceType: "Modified Tandem",
    lowerArchRetention: ACRYLIC,
    lowerAddOns: ["Sheaths for Tandem Bow (Removable)", "Add buccal sheath for tandem bow"],
  });
  assert.equal(out.items.filter((i) => i.code === "2219").length, 1);
});

test("typed / unknown answers in core fields are held with a mapKey that says so", () => {
  const out = resolveOrtho({
    applianceType: "Herbst",
    upperArchRetention: "Bonded to 6s",
    upperExpansionType: UVC,
    lowerArchRetention: ACRYLIC,
    lowerExpansionType: "Sagittal",
  });
  for (const k of ["ortho:typed:applianceType", "ortho:typed:upperArchRetention", "ortho:typed:lowerExpansionType"])
    assert.ok(out.unmapped.includes(k), `expected ${k} in ${out.unmapped}`);
  assert.ok(!out.items.some((i) => i.arch === "upper" || i.arch === "lower"), "nothing per-arch is guessed around a typed answer");
});

test("half an arch answer is held, not guessed", () => {
  assert.deepEqual(resolveOrtho({ upperArchRetention: ACRYLIC }).unmapped, ["ortho:upper:acrylic:no-expansion-type"]);
  assert.deepEqual(resolveOrtho({ lowerExpansionType: LVC }).unmapped, ["ortho:lower:no-retention:variety-click"]);
});

test("arch-only expansion tables: typed cells, so only E-Arch / Williams resolve (proposed); the rest are held", () => {
  const out = resolveOrtho({
    upperExpansionSelection: { "Hyrax RPE__FIXED": "x" },
    lowerExpansionSelection: { "E-Arch__FIXED": "yes", "Williams Expander__Other": "" },
  });
  assert.deepEqual(out.items.map((i) => [i.code, i.arch, i.status]), [["2186", "lower", "proposed"]]);
  assert.deepEqual(out.unmapped, ["ortho:upper-selection:hyrax-rpe"]);
});

test("an ortho device with no answers is flagged, never silently empty", () => {
  assert.deepEqual(resolveOrtho({}), { items: [], unmapped: ["ortho:unspecified"] });
});

test("the typical tandem order resolves end to end through resolveLineItems", () => {
  // The single most common history pattern: Modified Tandem, banded upper with
  // a Variety-Click, acrylic lower with a Variety-Click, hooks + transfer tray.
  const { items, unmapped } = resolveLineItems({
    deviceKey: "ortho-expander",
    deviceOptions: {
      applianceType: "Modified Tandem",
      upperArchRetention: BANDED,
      upperExpansionType: UVC,
      lowerArchRetention: ACRYLIC,
      lowerExpansionType: LVC,
      upperAddOns: ["Buccal hooks for tandem elastics", "Transfer tray for composite buttons"],
    },
  });
  assert.deepEqual(unmapped, []);
  assert.deepEqual(
    items.map((i) => i.code).sort(),
    ["2192", "2195", "2198", "2198", "2217", "2219", "2226", "2313"]
  );
  for (const i of items) assert.equal(i.overridden, false);
});

test("an rx_code_overrides ruling on an ortho mapKey applies per line", () => {
  const { items } = resolveLineItems(
    { deviceKey: "ortho-expander", deviceOptions: { upperArchRetention: BANDED } },
    { overrides: { "ortho:upper:bands:banded": { code: "2418", name: "Ortho Band with brackets" } } }
  );
  assert.deepEqual(items.map((i) => [i.code, i.overridden]), [["2418", true], ["2418", true]]);
});

test("rows: stable mapKeys, unique, valid status, codes only where not open", () => {
  const seen = new Set();
  for (const r of ORTHO_ROWS) {
    assert.match(r.mapKey, /^ortho:[a-z0-9:-]+$/, `bad mapKey ${r.mapKey}`);
    assert.ok(!seen.has(r.mapKey), `duplicate mapKey ${r.mapKey}`);
    seen.add(r.mapKey);
    assert.ok(["confirmed", "proposed", "open"].includes(r.status), `bad status on ${r.mapKey}`);
    if (r.status === "open") assert.equal(r.code, null, `${r.mapKey} is open but carries ${r.code}`);
    else assert.ok(r.code && r.evidence, `${r.mapKey} is ${r.status} without a code and evidence`);
  }
});
