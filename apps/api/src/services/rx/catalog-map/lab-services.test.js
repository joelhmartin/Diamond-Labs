/**
 * Case-level lab services checked against what the lab actually billed
 * (JotForm prescriptions matched to their Seazona orders, 2025–26).
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  resolveLabServices, LAB_SERVICE_ROWS, SCANNER_RECORDS, PVS_RECORDS, MODEL_RECORDS, BITE_RECORDS,
  isStoneModelDevice, orthoArches,
} from "./lab-services.js";
import { resolveCaseServices } from "./index.js";
import { digitalRxForm } from "@my-app/shared/rx/forms/digital-rx.form.js";

const ONE = [{ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } }];
const OD = (baseMaterial) => ({ deviceKey: "olmos-day", deviceOptions: { baseMaterial } });
const ON = (baseMaterial) => ({ deviceKey: "olmos-night", deviceOptions: { variant: "POSITIONER (ON-P) - Anterior Occlusion", baseMaterial } });
const DDSO = { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } };
const TWO = [OD("OD (PMT)"), ON("NYLON")];

/** "code×arches" per line, sorted — e.g. ["2367 lower", "2367 upper"]. */
const lines = (formData, devices = ONE) =>
  resolveLabServices(formData, devices).map((i) => `${i.code} ${i.arch}`).sort();
const perArch = (...codes) => codes.flatMap((c) => [`${c} lower`, `${c} upper`]).sort();

const RECORDS_EVIDENCE = [
  // [records answer, expected per-arch codes, evidence]
  [["3SHAPE"], ["2367"], "2367 95%, n=1,045"],
  [["ITERO"], ["2367"], "95%, n=796"],
  [["MEDIT"], ["2367"], "95%, n=517"],
  [["ALL OTHER SCANNERS"], ["2367"], "98%, n=262"],
  [["CEREC"], ["2367"], "93%, n=189"],
  [["CARESTREAM"], ["2367"], "97%, n=109"],
  [["SHINING 3D"], ["2367"], "100%, n=33"],
  [["PLANMECA"], ["2367"], "100%, n=11"],
  [["PVS Impressions"], ["2369", "2371"], "2369 90%, 2371 63%, n=71"],
  [["Stone/Resin Models"], ["2371"], "60%, n=48"],
  // A scan is fabricated digitally; physical records are not billed on top.
  [["Physical Bite Registration", "ITERO"], ["2367"], "bite reg is not a model source"],
  [["Physical Bite Registration"], [], "no model source sent"],
];

test("each records answer bills the model services real orders carried", () => {
  for (const [records, codes, why] of RECORDS_EVIDENCE)
    assert.deepEqual(lines({ records, firstDevice: "Yes" }), perArch(...codes), `${records} (${why})`);
});

test("previous records bill a remake model, not fabrication", () => {
  // "No, use PREVIOUS RECORDS": 2393 82%, 2367 only 9% (n=119).
  assert.deepEqual(lines({ records: ["3SHAPE"], firstDevice: "No, use PREVIOUS RECORDS" }), perArch("2393"));
  // "No, use NEW RECORDS" is an ordinary new scan: 2367 93% (n=155).
  assert.deepEqual(lines({ records: ["3SHAPE"], firstDevice: "No, use NEW RECORDS" }), perArch("2367"));
});

// Articulation (2368) follows a device pressed on a stone model; duplication
// (2372) adds a second device to that. [label, devices, expected, evidence]
const STONE_EVIDENCE = [
  ["OD PMT alone is articulated", [OD("OD (PMT)")], ["2367", "2368"], "OD PMT 2368 97% (n=1,143); OD alone 17 of 19 in replay"],
  ["OD acrylic alone is articulated", [OD("Acrylic w/clasps")], ["2367", "2368"], "83% (n=53)"],
  ["OD dual-laminate alone is articulated", [OD("Dual-Laminate")], ["2367", "2368"], "89% (n=27)"],
  ["ON PMT alone is articulated", [ON("PMT (Diamoform)")], ["2367", "2368"], "ON PMT 2368 98% (n=147)"],
  ["ON acrylic alone is articulated", [ON("ACRYLIC W/CLASPS")], ["2367", "2368"], "87% (n=23)"],
  ["ON Nylon alone is not", [ON("NYLON")], ["2367"], "ON Nylon 49%, tracking OD PMT 47% on the same orders"],
  ["a DDSO alone is not", [DDSO], ["2367"], "DDSO 2368 38%, tracking OD PMT 35%"],
  ["OD BioFlex alone is not", [OD("OD BIOFLEX")], ["2367"], "BioFlex 2368 < 17% (n=42)"],
  ["OD PMT + DDSO: duplicated and articulated", [OD("OD (PMT)"), DDSO], ["2367", "2368", "2372"], "replay 81 of 83"],
  ["OD PMT + ON Nylon: duplicated and articulated", TWO, ["2367", "2368", "2372"], "OD PMT 2372 89% (n=1,143)"],
  ["OD BioFlex + DDSO: neither", [OD("OD BIOFLEX"), DDSO], ["2367"], "digital OD + second device: 5 of 6 without (replay)"],
  ["OD Milled + ON Nylon: neither", [OD("Milled (↑ wear)"), ON("NYLON")], ["2367"], "Milled 2368 < 10% (n=30)"],
  ["OD Printed Nylon + ON Nylon: neither", [OD("Printed NYLON"), ON("NYLON")], ["2367"], "Printed Nylon 2368 15% (n=39)"],
  [
    "PMT nightguard is articulated",
    [{ deviceKey: "guard", deviceOptions: { standardGuards: { "Nightguard - Full Occlusion__UPPER ARCH": "x", "Nightguard - Full Occlusion__Base Material": "PMT (Diamoform)" } } }],
    ["2367", "2368"],
    "88% (n=25)",
  ],
  [
    "Nylon nightguard is not",
    [{ deviceKey: "guard", deviceOptions: { standardGuards: { "Nightguard - Full Occlusion": { "UPPER ARCH": true, "Base Material": "Nylon (Printed)" } } } }],
    ["2367"],
    "Nylon row 2368 < 8% (n=62)",
  ],
  ["PRO sport-guard is articulated", [{ deviceKey: "sport-guard", deviceOptions: { variant: "PRO - Light to Heavy Contact [Mx. or Md. Arch]" } }], ["2367", "2368"], "100% (n=11)"],
  ["Trainer sport-guard is articulated", [{ deviceKey: "sport-guard", deviceOptions: { variant: "Trainer - Non-Contact [Md. Arch Only]" } }], ["2367", "2368"], "91% (n=22)"],
  ["CAD/CAM sport-guard is not", [{ deviceKey: "sport-guard", deviceOptions: { variant: "CAD/CAM - Light to Heavy Contact [Mx or Md Arch]" } }], ["2367"], "< 8% (n=12)"],
  [
    "ortho on an acrylic lower is articulated",
    [{ deviceKey: "ortho-expander", deviceOptions: { applianceType: "Modified Tandem", lowerArchRetention: "Acrylic w/ clasp retention" } }],
    ["2367", "2368"],
    "acrylic lower 2368 96% (n=103)",
  ],
  [
    "a banded tandem is not",
    [{ deviceKey: "ortho-expander", deviceOptions: { applianceType: "Modified Tandem", upperArchRetention: "Fixed (Banded)", lowerArchRetention: "Fixed (Banded)" } }],
    ["2367"],
    "banded lower 2368 < 57% (n=58); replay 0 of 3",
  ],
];

for (const [label, devices, codes, why] of STONE_EVIDENCE)
  test(`stone-model services: ${label} (${why})`, () => {
    assert.deepEqual(lines({ records: ["MEDIT"], firstDevice: "Yes" }, devices), perArch(...codes));
  });

// Physical records: pour up PVS; scan the model only when a printed device
// needs it, and then the scan stands in for duplication.
const PHYSICAL_EVIDENCE = [
  ["PVS, DDSO + OD acrylic", ["PVS Impressions"], [DDSO, OD("Acrylic w/clasps")], ["2368", "2369", "2371"], "2371 and no 2372 on 8 of 8 two-device PVS orders (replay)"],
  ["PVS, OD acrylic alone", ["PVS Impressions"], [OD("Acrylic w/clasps")], ["2368", "2369"], "single stone device: 2369 + 2368, no 2371 (2 of 2)"],
  ["PVS, ON PMT alone", ["PVS Impressions"], [ON("PMT (Diamoform)")], ["2368", "2369"], "2 of 2"],
  ["PVS, DDSO alone", ["PVS Impressions"], [DDSO], ["2369", "2371"], "printed device: scanned (1 of 1)"],
  ["Stone models, OD PMT + ON PMT", ["Stone/Resin Models"], [OD("OD (PMT)"), ON("PMT (Diamoform)")], ["2368", "2372"], "nothing printed to scan for: duplicate the stone model"],
];

for (const [label, records, devices, codes, why] of PHYSICAL_EVIDENCE)
  test(`physical records: ${label} (${why})`, () => {
    assert.deepEqual(lines({ records, firstDevice: "Yes" }, devices), perArch(...codes));
  });

test("isStoneModelDevice reads the material each device carries", () => {
  assert.equal(isStoneModelDevice(OD("OD (PMT)")), true);
  assert.equal(isStoneModelDevice(ON("DUAL-LAMINATE")), true);
  assert.equal(isStoneModelDevice(OD("OD BIOFLEX")), false);
  assert.equal(isStoneModelDevice({ deviceKey: "ddso", deviceOptions: { baseMaterial: "BIOMED" } }), false);
  assert.equal(isStoneModelDevice({ deviceKey: "snorehook" }), false);
});

// Ortho on one arch: the model work follows the appliance's arch.
const ORTHO_ARCHES = [
  ["upper expander only", { upperExpansionSelection: { "Hyrax RPE__FIXED": "FIXED" } }, ["upper"]],
  ["lower Williams only", { fixedMandibularExpansion: ["Mandibular Williams"] }, ["lower"]],
  ["lower retention + screw only", { lowerArchRetention: "Fixed (Banded)", lowerExpansionType: "Slim-Line Screw" }, ["lower"]],
  ["upper add-ons only", { upperAddOns: ["Palatal pads"] }, ["upper"]],
  ["both arches answered", { upperArchRetention: "Fixed (Banded)", lowerArchRetention: "Fixed (Banded)" }, ["upper", "lower"]],
  ["a Modified Tandem is both", { applianceType: "Modified Tandem", upperArchRetention: "Fixed (Banded)" }, ["upper", "lower"]],
  ["nothing answered is both (held anyway)", {}, ["upper", "lower"]],
];

for (const [label, o, arches] of ORTHO_ARCHES)
  test(`ortho arches: ${label}`, () => {
    assert.deepEqual(orthoArches(o), arches);
    const fab = resolveLabServices({ records: ["CEREC"] }, [{ deviceKey: "ortho-expander", deviceOptions: o }])
      .filter((i) => i.code === "2367")
      .map((i) => i.arch);
    assert.deepEqual(fab, arches, "replay: 11 of 26 non-tandem ortho orders billed 2367 on the appliance's arch only");
  });

test("every lab-service line is per arch, upper then lower", () => {
  // 2367 sat on 3,071 orders as two lines (arch 1 + arch 2); 2372 on 1,103.
  const items = resolveLabServices({ records: ["3SHAPE"] }, TWO);
  assert.ok(items.length > 0);
  for (const code of ["2367", "2368", "2372"])
    assert.deepEqual(items.filter((i) => i.code === code).map((i) => i.arch), ["upper", "lower"]);
});

test("no form answers, no lab services — never invented", () => {
  assert.deepEqual(resolveLabServices({}, ONE), []);
  assert.deepEqual(resolveLabServices(undefined, []), []);
});

test("every row's code and name matches the live Seazona catalog", () => {
  const catalog = {
    2367: "Digital Model Fabrication (Per Arch)",
    2368: "Articulate Models",
    2369: "Impression Pour Up (Per Arch)",
    2371: "Scan/Digitize Models (Per Arch)",
    2372: "Model Duplication (Per Arch)",
    2393: "Remake Model Fabrication",
  };
  for (const r of LAB_SERVICE_ROWS) assert.equal(r.name, catalog[r.code], r.mapKey);
});

test("an override on a lab service applies to each arch's line", () => {
  const overrides = { "service:model-fab": { noteOnly: true, code: null, name: "Model fab (included)" } };
  const { items } = resolveCaseServices({ records: ["3SHAPE"] }, ONE, { overrides });
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.noteOnly && i.overridden));
  assert.deepEqual(items.map((i) => i.arch), ["upper", "lower"]);
});

test("every records option on the live form is classified", () => {
  // Cross-package: adding a scanner to the form without telling this module
  // would silently stop billing model fabrication for it.
  const field = digitalRxForm.sections.flatMap((s) => s.fields || []).find((f) => f.key === "records");
  assert.ok(field, "the records field left the digital Rx form — update lab-services.js");
  const known = [...SCANNER_RECORDS, PVS_RECORDS, MODEL_RECORDS, BITE_RECORDS];
  for (const o of field.options) {
    const value = typeof o === "string" ? o : o.value;
    assert.ok(known.includes(value), `records option "${value}" is not classified in lab-services.js`);
  }
});

test("the first-device answer this module keys on is still on the live form", () => {
  const field = digitalRxForm.sections.flatMap((s) => s.fields || []).find((f) => f.key === "firstDevice");
  assert.ok(field, "firstDevice left the digital Rx form — update lab-services.js");
  assert.ok(field.options.map((o) => (typeof o === "string" ? o : o.value)).includes("No, use PREVIOUS RECORDS"));
});
