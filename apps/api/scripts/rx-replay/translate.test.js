// Synthetic JotForm answers only — never real prescriptions.
import { test } from "vitest";
import assert from "node:assert/strict";
import { buildFormDevices } from "@my-app/shared";
import { jotformToPortalAnswers, cleanLabel, literals, portalFormType } from "./translate.js";
import { compareLines, archNum } from "./compare.js";

/** A JotForm image-picker widget answer. */
const widget = (...names) => ({ widget_metadata: { type: "imagelinks", value: names.map((name) => ({ name, url: "x" })) } });
const EMPTY_GUARDS = {
  "Nightguard-  <b>Full Occlusion</b>": ["", "", "", "", "", "", ""],
  "Occlusal Guard -  <b>NTI Type</b>": ["", "", "", "", "", "", ""],
  "Michigan Splint <b>Anterior Guidance</b>": ["", "", "", "", "", "", ""],
};

test("cleanLabel decodes entities and drops markup", () => {
  assert.equal(cleanLabel("POSITIONER &lt;br&gt;&lt;b&gt; ON-P &lt;/b&gt; &lt;br&gt; (Anterior Occlusion)"), "POSITIONER ON-P (Anterior Occlusion)");
  assert.equal(cleanLabel("Nightguard-  <b>Full Occlusion</b>"), "Nightguard- Full Occlusion");
});

test("literals reads widgets, arrays, index-keyed objects, and treats {} as empty", () => {
  assert.deepEqual(literals(widget("A", "B")), ["A", "B"]);
  assert.deepEqual(literals(["A"]), ["A"]);
  assert.deepEqual(literals({ 0: "A", 1: "B" }), ["A", "B"]);
  assert.deepEqual(literals({}), []);
  assert.deepEqual(literals(""), []);
});

test("Olmos Day + Night: widget labels land on the portal's option values", () => {
  const out = jotformToPortalAnswers("rx", {
    odOlmos390: widget("OD &lt;b&gt; BIOFLEX&lt;/b&gt;"),
    onOlmos: widget("RAMP &lt;br&gt;&lt;b&gt; ON-R &lt;/b&gt; &lt;br&gt; (Anterior Occlusion)"),
    selectBase270: "PMT (Diamoform)",
    selectModifications414: widget("Vertical Shims (Titration)", "Hooks for Elastics"),
    standardGuardssplints: EMPTY_GUARDS,
  });
  assert.deepEqual(out.devicesToOrder, ["olmos"]);
  assert.equal(out.odMaterial, "OD BIOFLEX");
  assert.equal(out.onDesign, "RAMP (ON-R) - Anterior Occlusion");
  assert.equal(out.onMaterial, "PMT (Diamoform)");
  assert.deepEqual(out.onModifications, ["Vertical Shims", "Hooks for Elastics"]);
  assert.deepEqual(buildFormDevices("digital", out).map((d) => d.deviceKey), ["olmos-day", "olmos-night"]);
});

test("DDSO: picker gates the device; contact, design, both modification widgets and titration translate", () => {
  const out = jotformToPortalAnswers("rx", {
    pleaseSelect219: widget("DDSO"),
    pleaseSelect389: "NYLON",
    pleaseSelect466: widget("TRIPOD &lt;br&gt; Occlusion"),
    designPreference467: widget("Lingual-Free"),
    selectModifications468: widget("VERTICAL SHIMS", "TONGUE POSITIONERS"),
    selectModifications469: widget("BAB LOOP"),
    placeVertical: ["Anterior Only"],
  });
  assert.deepEqual(out.devicesToOrder, ["ddso"]);
  assert.equal(out.ddsoMaterial, "NYLON");
  assert.equal(out.ddsoOcclusalContact, "TRIPOD Occlusion");
  assert.equal(out.ddsoDesignPreference, "Lingual-Free");
  assert.deepEqual(out.ddsoModifications, ["Vertical Shims", "Tongue Positioners", "BAB Loop"]);
  assert.deepEqual(out.ddsoTitrationPlacement, ["Anterior Only"]);
});

test("DDSO material without the DDSO picker does not order a DDSO", () => {
  const out = jotformToPortalAnswers("rx", { pleaseSelect389: "NYLON", odOlmos390: widget("OD (PMT)") });
  assert.deepEqual(out.devicesToOrder, ["olmos"]);
  assert.equal(out.ddsoMaterial, undefined);
});

test("D-Pro, SnoreHook, MISTRY and sport-guard pickers become gated devices", () => {
  const out = jotformToPortalAnswers("rx", {
    pleaseSelect454: widget("D-Pro"),
    pleaseSelect485: widget("Posterior &lt;br&gt; Contact"),
    selectModifications487: widget("HOOKS FOR ELASTICS"),
    pleaseSelect408: widget("SnoreHook"),
    ara: widget("ARA"),
    diamondEnhanced: widget("&lt;b&gt; PRO&lt;/b&gt;- Light to Heavy Contact [Mx. or Md. Arch]"),
  });
  assert.deepEqual(out.devicesToOrder, ["mistry", "dpro", "sportguards", "snorehook"]);
  assert.equal(out.dproDevice, "D-Pro");
  assert.equal(out.dproOcclusalContact, "Posterior Contact");
  assert.deepEqual(out.dproModifications, ["Hooks for Elastics"]);
  assert.equal(out.ara.length, 1);
  assert.deepEqual(out.sportGuardDevice, ["PRO - Light to Heavy Contact [Mx. or Md. Arch]"]);
  assert.deepEqual(
    buildFormDevices("digital", out).map((d) => d.deviceKey),
    ["ara", "cadcam-d-pro", "sport-guard", "snorehook"]
  );
});

test("guard matrix: HTML row labels → portal rows, positional cells → portal columns", () => {
  const out = jotformToPortalAnswers("rx", {
    selectDevice: widget("Dual Arch- &lt;b&gt;FLATPLANE&lt;/b&gt;"),
    standardGuardssplints: {
      ...EMPTY_GUARDS,
      "Nightguard-  <b>Full Occlusion</b>": ["UPPER ARCH", "LOWER ARCH", "Nylon (Printed)", "", "2-15", "", ""],
    },
  });
  assert.deepEqual(out.devicesToOrder, ["nightguards"]);
  assert.deepEqual(out.nightguardDevice, ["Dual Arch - FLATPLANE"]);
  assert.deepEqual(out.standardGuards, {
    "Nightguard - Full Occlusion__UPPER ARCH": "UPPER ARCH",
    "Nightguard - Full Occlusion__LOWER ARCH": "LOWER ARCH",
    "Nightguard - Full Occlusion__Base Material": "Nylon (Printed)",
    "Nightguard - Full Occlusion__Only Cover teeth #'s:": "2-15",
  });
});

test("an all-empty guard matrix orders nothing", () => {
  const out = jotformToPortalAnswers("rx", { standardGuardssplints: EMPTY_GUARDS, odOlmos390: widget("OD (PMT)") });
  assert.equal(out.standardGuards, undefined);
  assert.deepEqual(out.devicesToOrder, ["olmos"]);
});

test("records, first device, physical bite and rush tiers", () => {
  const out = jotformToPortalAnswers("rx", {
    physicalAndor: widget("Physical Bite Registration", "ITERO"),
    isThis309: "No, use PREVIOUS RECORDS",
    willYou: "No - Start case now with digital bite",
    rushCase: "#1 NYLON DEVICES: Max Rush (200)\n\nThe additinal rush charge is 200 USD",
    rushCase337: "#1 BIOMED - PMT - ACRYLIC: No Rush (0)\n\nThe additional rush charge is 0 USD",
  });
  assert.deepEqual(out.records, ["Physical Bite Registration", "ITERO"]);
  assert.equal(out.firstDevice, "No, use PREVIOUS RECORDS");
  assert.equal(out.physicalBite, "No - Start case now with digital bite");
  assert.equal(out.rushChargeNylon, "Max Rush");
  assert.equal(out.rushChargeBiomed, "No Rush");
  assert.deepEqual(out.rushCase, ["Yes"]);
});

test("ortho: retention, screws, device, per-arch add-ons and matrices", () => {
  const out = jotformToPortalAnswers("ortho", {
    selectDevice: "Modified Tandem",
    typeA489: "Fixed (Banded)",
    upperExpansion: 'Slim-line "Variety-Click" (Fixed ONLY)',
    lowerArch: "Acrylic w/ clasp retention",
    lowerExpansion: "Slim-Line Screw",
    addTo: { 0: "Buccal tubes to bands", 1: "Buccal hooks for tandem elastics" },
    addTo509: ["Sheaths for Tandem Bow (Removable)"],
    add: {},
    add465: ["Transfer tray for composite buttons"],
    removableMandibular: "Mandibular Schwarz",
    requiredSelection: { Maxillary: ["", "", "", "6s"], "Mandibular ": ["", "", "", ""] },
    lowerrFunctional: {
      '<span style="font-size: 11.004px;">Transverse  </span><span>Schwarz</span>': ["", "REMOVABLE", "", "", "", "", "", "", "", ""],
    },
    nuveloDigital: [["", "", "", ""]],
    physicalAndor: widget("MEDIT"),
    willYou: "Yes - Wait until physical bite is recieved",
  });
  assert.equal(out.selectDevice, "Modified Tandem");
  assert.equal(out.upperArchRetention, "Fixed (Banded)");
  assert.equal(out.upperExpansionType, 'Slim-line "Variety-Click" (Fixed ONLY)');
  assert.equal(out.lowerArchRetention, "Acrylic w/ clasp retention");
  assert.equal(out.lowerExpansionType, "Slim-Line Screw");
  assert.deepEqual(out.addToMaxillary, ["Buccal tubes to bands", "Buccal hooks for tandem elastics"]);
  assert.deepEqual(out.addToMandibular, ["Sheaths for Tandem Bow (Removable)"]);
  assert.equal(out.maxillaryAdd, undefined);
  assert.deepEqual(out.mandibularAdd, ["Transfer tray for composite buttons"]);
  assert.deepEqual(out.removableMandibularExpansion, ["Mandibular Schwarz"]);
  assert.deepEqual(out.requiredSelection, { "Maxillary__Place bands on:": "6s" });
  assert.deepEqual(out.lowerExpansionSelection, { "Transverse Schwarz__REMOVABLE": "REMOVABLE" });
  assert.equal(out.nuveloDigitalSetup, undefined);
  assert.match(out.physicalBite, /^Yes - Wait/);
  assert.equal(portalFormType("ortho"), "ortho");
  const [device] = buildFormDevices("ortho", out);
  assert.equal(device.deviceKey, "ortho-expander");
  assert.deepEqual(device.deviceOptions.upperAddOns, ["Buccal tubes to bands", "Buccal hooks for tandem elastics"]);
});

test("a literal with no portal option passes through cleaned and is reported", () => {
  const warnings = [];
  const out = jotformToPortalAnswers("rx", { odOlmos390: widget("OD &lt;b&gt;TITANIUM&lt;/b&gt;") }, { onWarning: (w) => warnings.push(w) });
  assert.equal(out.odMaterial, "OD TITANIUM");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /odMaterial/);
});

test("an unknown form is an error, not a silent empty translation", () => {
  assert.throws(() => jotformToPortalAnswers("olmos", {}), /unknown JotForm form/);
});

test("compareLines: multiset by code; arch must agree only where both sides carry one", () => {
  const gen = [
    { seazonaCode: "2367", arch: "upper" },
    { seazonaCode: "2367", arch: "lower" },
    { seazonaCode: "2198", arch: "upper" },
    { seazonaCode: null, mapKey: "ortho:x", status: "open" },
    { seazonaCode: null, noteOnly: true },
  ];
  const act = [
    { code: "2367", arch: 1 },
    { code: "2367", arch: 1 },
    { code: "2198", arch: null },
    { code: "2217", arch: null },
  ];
  const r = compareLines(gen, act);
  assert.deepEqual(r.open, ["ortho:x"]);
  assert.deepEqual(r.extra.map((l) => [l.code, l.arch]), [["2367", 2]]);
  assert.deepEqual(r.missing.map((l) => [l.code, l.arch]), [["2367", 1], ["2217", null]]);
  assert.equal(r.archLoose, 1);
  assert.equal(r.exact, false);
  assert.equal(r.subset, false);
  assert.equal(archNum("Upper"), 1);
  assert.equal(archNum(undefined), null);
});

test("compareLines: identical orders are exact", () => {
  const r = compareLines([{ seazonaCode: "2608", arch: null }], [{ code: "2608", arch: null }]);
  assert.equal(r.exact, true);
  assert.equal(r.exactStrictArch, true);
  assert.equal(r.subset, true);
});
