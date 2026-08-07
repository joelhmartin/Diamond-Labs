import { test } from "vitest";
import assert from "node:assert/strict";

import { digitalRxForm } from "./digital-rx.form.js";
import { allFields, visibleFields, disabledOptions } from "./form-logic.js";

// The complete set of field types this porting layer is allowed to emit.
const SUPPORTED_TYPES = new Set([
  "radio",
  "checkbox",
  "select",
  "text",
  "textarea",
  "date",
  "heading",
  "divider",
  "static",
  "fullname",
  "email",
  "phone",
  "address",
  "fileUpload",
  "signature",
  "matrix",
  "image",
  "artboard",
]);

test("form metadata is correct", () => {
  assert.equal(digitalRxForm.slug, "digital");
  assert.equal(digitalRxForm.jotformId, "220598308432154");
  assert.equal(digitalRxForm.title, "Diamond Orthotic Lab Rx. 2025");
  assert.equal(digitalRxForm.route, "/app/rx/digital");
  assert.ok(Array.isArray(digitalRxForm.sections) && digitalRxForm.sections.length > 0);
});

test("ports a sensible number of fields", () => {
  const fields = allFields(digitalRxForm);
  assert.ok(
    fields.length >= 40,
    `expected >= 40 fields, got ${fields.length}`
  );
});

test("has the devicesToOrder multi-select gate with all 9 device values", () => {
  const fields = allFields(digitalRxForm);
  const gate = fields.find((f) => f.key === "devicesToOrder");
  assert.ok(gate, "devicesToOrder field is missing");
  assert.equal(gate.type, "checkbox");
  assert.equal(gate.required, true);
  const values = gate.options.map((o) => (typeof o === "string" ? o : o.value));
  const expected = [
    "olmos",
    "mistry",
    "ddso",
    "dpro",
    "shirazi",
    "nightguards",
    "sportguards",
    "snorehook",
    "ortho",
  ];
  for (const v of expected) {
    assert.ok(values.includes(v), `missing device value: ${v}`);
  }
  assert.equal(values.length, expected.length);
});

test("each per-device section is gated on devicesToOrder via showIf.includes", () => {
  const deviceSections = [
    "olmos",
    "mistry",
    "ddso",
    "dpro",
    "shirazi",
    "nightguards",
    "sport-guards",
    "snorehook",
  ];
  for (const id of deviceSections) {
    const section = digitalRxForm.sections.find((s) => s.id === id);
    assert.ok(section, `section ${id} is missing`);
    assert.ok(section.showIf, `section ${id} has no showIf`);
    assert.equal(section.showIf.key, "devicesToOrder");
    assert.ok(
      typeof section.showIf.includes === "string" && section.showIf.includes.length > 0,
      `section ${id} showIf.includes is not set`
    );
  }
});

test("no doctor / contact / address identity fields remain", () => {
  const fields = allFields(digitalRxForm);
  for (const f of fields) {
    const key = f.key || "";
    assert.ok(
      !/doctorName|^email$|contactPhone|^contact$|address/i.test(key),
      `unexpected identity field survived: ${key}`
    );
  }
});

test("the remake/repair/redesign section is gone", () => {
  const remake = digitalRxForm.sections.find((s) => s.id === "remake");
  assert.equal(remake, undefined, "remake section should be removed");
});

test("at least one records option carries an image", () => {
  const fields = allFields(digitalRxForm);
  const records = fields.find((f) => f.key === "records");
  assert.ok(records, "records field is missing");
  assert.ok(
    records.options.some((o) => o && typeof o === "object" && o.image),
    "no records option has an image"
  );
});

test("every image-bearing option group carries an image on each option", () => {
  const fields = allFields(digitalRxForm);
  // field key → expected number of image-bearing options (from the JotForm snapshot).
  const EXPECTED_IMAGE_OPTIONS = {
    records: 12, // qid 86
    odMaterial: 6, // qid 390
    onDesign: 4, // qid 197
    occlusalContact: 4, // qid 131
    designPreference: 4, // qid 182
    modificationsA: 3, // qid 224
    modificationsB: 3, // qid 419
    ddsoOcclusalContact: 4, // qid 466
    ddsoDesignPreference: 4, // qid 467
    ddsoModifications: 6, // qid 468 + 469
    dproOcclusalContact: 4, // qid 485
    dproDesignPreference: 4, // qid 486
    dproModifications: 3, // qid 487
    nightguardDevice: 3, // qid 453
    sportGuardDevice: 3, // qid 235
    mora: 1, // qid 513
    ara: 1, // qid 514
  };
  for (const [key, count] of Object.entries(EXPECTED_IMAGE_OPTIONS)) {
    const field = fields.find((f) => f.key === key);
    assert.ok(field, `field ${key} is missing`);
    const withImage = field.options.filter(
      (o) => o && typeof o === "object" && typeof o.image === "string" && o.image
    );
    assert.equal(
      withImage.length,
      count,
      `field ${key}: expected ${count} options with images, got ${withImage.length}`
    );
    // Canonical value must be preserved as a non-empty string on every option.
    for (const o of field.options) {
      assert.ok(
        o && typeof o === "object" && typeof o.value === "string" && o.value,
        `field ${key}: an option is missing a canonical string value`
      );
    }
  }
});

test("DDSO and D-Pro carry their own occlusal/design/modification fields with unique image keys", () => {
  const fields = allFields(digitalRxForm);
  const ddso = digitalRxForm.sections.find((s) => s.id === "ddso");
  const dpro = digitalRxForm.sections.find((s) => s.id === "dpro");
  assert.ok(ddso && dpro, "ddso/dpro sections missing");

  const ddsoKeys = ddso.fields.map((f) => f.key);
  const dproKeys = dpro.fields.map((f) => f.key);

  // New fields live in the correct sections under the ddso*/dpro* namespace.
  for (const k of ["ddsoOcclusalContact", "ddsoDesignPreference", "ddsoModifications"]) {
    assert.ok(ddsoKeys.includes(k), `ddso section missing ${k}`);
  }
  for (const k of ["dproOcclusalContact", "dproDesignPreference", "dproModifications"]) {
    assert.ok(dproKeys.includes(k), `dpro section missing ${k}`);
  }

  // They must NOT collide with the Shirazi-section keys.
  for (const k of ["occlusalContact", "designPreference", "modificationsA", "modificationsB"]) {
    assert.ok(!ddsoKeys.includes(k), `ddso must not reuse Shirazi key ${k}`);
    assert.ok(!dproKeys.includes(k), `dpro must not reuse Shirazi key ${k}`);
  }

  // Each new group is image-bearing on every option, with canonical string values.
  const imageGroups = {
    ddsoOcclusalContact: 4,
    ddsoDesignPreference: 4,
    ddsoModifications: 6,
    dproOcclusalContact: 4,
    dproDesignPreference: 4,
    dproModifications: 3,
  };
  for (const [key, count] of Object.entries(imageGroups)) {
    const field = fields.find((f) => f.key === key);
    assert.ok(field, `field ${key} is missing`);
    assert.equal(field.options.length, count, `${key}: expected ${count} options`);
    for (const o of field.options) {
      assert.ok(
        o && typeof o === "object" && typeof o.image === "string" && o.image,
        `${key}: an option has no image`
      );
      assert.ok(
        typeof o.value === "string" && o.value,
        `${key}: an option has no canonical string value`
      );
    }
  }
});

test("fileUpload accept includes .stl", () => {
  const fields = allFields(digitalRxForm);
  const upload = fields.find((f) => f.type === "fileUpload" && f.accept);
  assert.ok(upload, "no fileUpload field with an accept list");
  assert.ok(
    upload.accept.toLowerCase().split(",").includes(".stl"),
    `accept does not include .stl: ${upload.accept}`
  );
});

test("all field keys are unique", () => {
  const keys = allFields(digitalRxForm).map((f) => f.key);
  // Every ported field carries a stable key (headings/notes included).
  for (const k of keys) {
    assert.ok(k != null && k !== "", `found a field with no key`);
  }
  const seen = new Set();
  for (const k of keys) {
    assert.ok(!seen.has(k), `duplicate key: ${k}`);
    seen.add(k);
  }
});

test("every field.type is supported", () => {
  for (const f of allFields(digitalRxForm)) {
    assert.ok(
      SUPPORTED_TYPES.has(f.type),
      `unsupported field type: ${f.type} (key ${f.key})`
    );
  }
});

test("has at least one fileUpload and one signature field", () => {
  const fields = allFields(digitalRxForm);
  assert.ok(
    fields.some((f) => f.type === "fileUpload"),
    "no fileUpload field"
  );
  assert.ok(
    fields.some((f) => f.type === "signature"),
    "no signature field"
  );
});

test("has a device-selection field", () => {
  const fields = allFields(digitalRxForm);
  assert.ok(
    fields.some(
      (f) =>
        (f.type === "radio" || f.type === "checkbox") &&
        /device/i.test(f.label || "")
    ),
    "no radio/checkbox field whose label matches /device/i"
  );
});

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

test("ortho-only case-submission extras are hidden unless ortho is selected", () => {
  const hidden = visibleFields(digitalRxForm, { devicesToOrder: ["ddso"] }).map((f) => f.key);
  for (const k of ["nuveloDigitalSetup", "digitalStudyModels", "digitalSetupEmail"])
    assert.ok(!hidden.includes(k), `${k} should be hidden without ortho`);
  // digitalSetupEmail additionally requires nuveloDigitalSetup to carry an
  // answer (see the dedicated rule test below) — nuveloDigitalSetup/
  // digitalStudyModels have no such extra gate.
  const shown = visibleFields(digitalRxForm, { devicesToOrder: ["ortho"] }).map((f) => f.key);
  for (const k of ["nuveloDigitalSetup", "digitalStudyModels"])
    assert.ok(shown.includes(k), `${k} should be visible with ortho`);
});

test("a DDSO-only doctor sees the shared rush checkbox but no rush-charge sliders when not rushing", () => {
  const shown = visibleFields(digitalRxForm, { devicesToOrder: ["ddso"] }).map((f) => f.key);
  assert.ok(shown.includes("rushCase"), "the shared rush checkbox must always show");
  for (const k of ["rushChargeBiomed", "rushChargeNylon"])
    assert.ok(!shown.includes(k), `${k} should be hidden until rushCase is ticked`);

  // Ortho alone (no rush requested) no longer surfaces the rush-charge sliders —
  // that gate moved from devicesToOrder:includes("ortho") to rushCase itself.
  const withOrtho = visibleFields(digitalRxForm, { devicesToOrder: ["ortho"] }).map((f) => f.key);
  assert.ok(withOrtho.includes("rushCase"));
  for (const k of ["rushChargeBiomed", "rushChargeNylon"])
    assert.ok(!withOrtho.includes(k), `${k} should stay hidden without a rush request`);
});

/* ═══════════════════════════════════════════════════════════════════════
   Conditional-display rules (lab-owner approved) — each covers both
   directions: hidden when the trigger isn't met, visible when it is.
   All go through visibleFields(digitalRxForm, answers), the real predicate.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Artboards: gated on their own "design (draw)" checkbox ── */

test("dualArchArtboard is gated on dualArchDesignDraw", () => {
  const base = { devicesToOrder: ["ortho"] };
  const hidden = visibleFields(digitalRxForm, base).map((f) => f.key);
  assert.ok(!hidden.includes("dualArchArtboard"));
  const shown = visibleFields(digitalRxForm, {
    ...base,
    dualArchDesignDraw: ["Diamond ORTHO Artboard"],
  }).map((f) => f.key);
  assert.ok(shown.includes("dualArchArtboard"));
});

test("maxillaryArtboard is gated on maxillaryDesignDraw", () => {
  const base = { devicesToOrder: ["ortho"] };
  const hidden = visibleFields(digitalRxForm, base).map((f) => f.key);
  assert.ok(!hidden.includes("maxillaryArtboard"));
  const shown = visibleFields(digitalRxForm, {
    ...base,
    maxillaryDesignDraw: ["Diamond ORTHO Artboard"],
  }).map((f) => f.key);
  assert.ok(shown.includes("maxillaryArtboard"));
});

test("mandibularArtboard is gated on mandibularDesignDraw", () => {
  const base = { devicesToOrder: ["ortho"] };
  const hidden = visibleFields(digitalRxForm, base).map((f) => f.key);
  assert.ok(!hidden.includes("mandibularArtboard"));
  const shown = visibleFields(digitalRxForm, {
    ...base,
    mandibularDesignDraw: ["Diamond ORTHO Artboard"],
  }).map((f) => f.key);
  assert.ok(shown.includes("mandibularArtboard"));
});

/* ── Olmos Day expansion follow-ups ── */

test("odScrewType shows only when odExpansionOptions includes 'Add expansion screw:'", () => {
  const base = { devicesToOrder: ["olmos"] };
  const hidden = visibleFields(digitalRxForm, base).map((f) => f.key);
  assert.ok(!hidden.includes("odScrewType"));
  const withOther = visibleFields(digitalRxForm, {
    ...base,
    odExpansionOptions: ["Other"],
  }).map((f) => f.key);
  assert.ok(!withOther.includes("odScrewType"));
  const shown = visibleFields(digitalRxForm, {
    ...base,
    odExpansionOptions: ["Add expansion screw:"],
  }).map((f) => f.key);
  assert.ok(shown.includes("odScrewType"));
});

test("odPonticTooth shows only when odExpansionOptions includes 'Add pontic(s):'", () => {
  const base = { devicesToOrder: ["olmos"] };
  const hidden = visibleFields(digitalRxForm, base).map((f) => f.key);
  assert.ok(!hidden.includes("odPonticTooth"));
  const shown = visibleFields(digitalRxForm, {
    ...base,
    odExpansionOptions: ["Add pontic(s):"],
  }).map((f) => f.key);
  assert.ok(shown.includes("odPonticTooth"));
});

/* ── Tandem-only fields ── */

test("tandemBowSetting shows only for Modified Tandem, not Twin Block", () => {
  const twinBlock = visibleFields(digitalRxForm, {
    devicesToOrder: ["ortho"],
    selectDevice: "Twin Block",
  }).map((f) => f.key);
  assert.ok(!twinBlock.includes("tandemBowSetting"));
  const tandem = visibleFields(digitalRxForm, {
    devicesToOrder: ["ortho"],
    selectDevice: "Modified Tandem",
  }).map((f) => f.key);
  assert.ok(tandem.includes("tandemBowSetting"));
});

test("occlusalOptionsTandem shows only for Modified Tandem, not Twin Block", () => {
  const twinBlock = visibleFields(digitalRxForm, {
    devicesToOrder: ["ortho"],
    selectDevice: "Twin Block",
  }).map((f) => f.key);
  assert.ok(!twinBlock.includes("occlusalOptionsTandem"));
  const tandem = visibleFields(digitalRxForm, {
    devicesToOrder: ["ortho"],
    selectDevice: "Modified Tandem",
  }).map((f) => f.key);
  assert.ok(tandem.includes("occlusalOptionsTandem"));
});

/* ── Rush charges: gated on rushCase, for any device ── */

test("rushChargeBiomed/rushChargeNylon show for any device once rushCase is ticked", () => {
  const noRush = visibleFields(digitalRxForm, {
    devicesToOrder: ["nightguards"],
  }).map((f) => f.key);
  for (const k of ["rushChargeBiomed", "rushChargeNylon"])
    assert.ok(!noRush.includes(k), `${k} should be hidden without a rush request`);

  const rushed = visibleFields(digitalRxForm, {
    devicesToOrder: ["nightguards"],
    rushCase: ["Yes"],
  }).map((f) => f.key);
  for (const k of ["rushChargeBiomed", "rushChargeNylon"])
    assert.ok(rushed.includes(k), `${k} should show once rushCase is ticked, for ANY device`);
});

/* ── Sports-guard logo upload: gated on the "Add logo" matrix cell ── */

test("sportGuardLogoUpload is gated on the sportGuardSpecs 'Add logo' cell", () => {
  const base = { devicesToOrder: ["sportguards"] };
  const hidden = visibleFields(digitalRxForm, base).map((f) => f.key);
  assert.ok(!hidden.includes("sportGuardLogoUpload"));
  const shown = visibleFields(digitalRxForm, {
    ...base,
    sportGuardSpecs: { "Please Select:__Add logo": "Yes" },
  }).map((f) => f.key);
  assert.ok(shown.includes("sportGuardLogoUpload"));
});

/* ── Digital setup email: ortho AND nuveloDigitalSetup answered ── */

test("digitalSetupEmail requires BOTH ortho selected AND nuveloDigitalSetup answered", () => {
  // ortho alone, no nuveloDigitalSetup answer → hidden.
  const orthoOnly = visibleFields(digitalRxForm, {
    devicesToOrder: ["ortho"],
  }).map((f) => f.key);
  assert.ok(!orthoOnly.includes("digitalSetupEmail"));

  // nuveloDigitalSetup answered but ortho not selected → hidden (field is
  // unreachable in this state anyway, but the gate must not degrade to OR).
  const noOrtho = visibleFields(digitalRxForm, {
    devicesToOrder: ["ddso"],
    nuveloDigitalSetup: { "__Orient to HIP": "yes" },
  }).map((f) => f.key);
  assert.ok(!noOrtho.includes("digitalSetupEmail"));

  // Both hold → shown.
  const both = visibleFields(digitalRxForm, {
    devicesToOrder: ["ortho"],
    nuveloDigitalSetup: { "__Orient to HIP": "yes" },
  }).map((f) => f.key);
  assert.ok(both.includes("digitalSetupEmail"));
});

/* ── Mandibular expansion split: removable vs fixed lowerArchRetention ── */

test("removableMandibularExpansion shows only for removable lowerArchRetention", () => {
  const base = { devicesToOrder: ["ortho"] };
  const fixed = visibleFields(digitalRxForm, {
    ...base,
    lowerArchRetention: "Fixed (Banded)",
  }).map((f) => f.key);
  assert.ok(!fixed.includes("removableMandibularExpansion"));
  const removable = visibleFields(digitalRxForm, {
    ...base,
    lowerArchRetention: "Acrylic w/ clasp retention",
  }).map((f) => f.key);
  assert.ok(removable.includes("removableMandibularExpansion"));
  const removable2 = visibleFields(digitalRxForm, {
    ...base,
    lowerArchRetention: "Printed NYLON w/ composite retention",
  }).map((f) => f.key);
  assert.ok(removable2.includes("removableMandibularExpansion"));
});

test("fixedMandibularExpansion shows only for fixed lowerArchRetention", () => {
  const base = { devicesToOrder: ["ortho"] };
  const removable = visibleFields(digitalRxForm, {
    ...base,
    lowerArchRetention: "Acrylic w/ clasp retention",
  }).map((f) => f.key);
  assert.ok(!removable.includes("fixedMandibularExpansion"));
  const fixed = visibleFields(digitalRxForm, {
    ...base,
    lowerArchRetention: "Fixed (Banded)",
  }).map((f) => f.key);
  assert.ok(fixed.includes("fixedMandibularExpansion"));
  const fixed2 = visibleFields(digitalRxForm, {
    ...base,
    lowerArchRetention: "Fixed [3D Printed] Bands",
  }).map((f) => f.key);
  assert.ok(fixed2.includes("fixedMandibularExpansion"));
});

/* ── Contradictory expansion options: disableOptionsIf ── */

test("upperExpansionType's Fixed ONLY options are disabled once upperArchRetention is removable", () => {
  const fields = allFields(digitalRxForm);
  const field = fields.find((f) => f.key === "upperExpansionType");
  assert.ok(field, "upperExpansionType field missing");
  const fixedOnlyOptions = field.options.filter((o) => /\(Fixed ONLY\)/.test(o));
  assert.equal(fixedOnlyOptions.length, 4, "expected 4 Fixed ONLY options on upperExpansionType");

  const withFixed = disabledOptions(field, { upperArchRetention: "Fixed (Banded)" });
  assert.equal(withFixed.size, 0, "no options disabled while retention is fixed");

  const withRemovable = disabledOptions(field, {
    upperArchRetention: "Acrylic w/ clasp retention",
  });
  for (const o of fixedOnlyOptions) assert.ok(withRemovable.has(o), `${o} should be disabled`);

  const withRemovable2 = disabledOptions(field, {
    upperArchRetention: "Printed NYLON w/ composite retention",
  });
  for (const o of fixedOnlyOptions) assert.ok(withRemovable2.has(o), `${o} should be disabled`);
});

test("lowerExpansionType's Memory Screw (Removable Only) is disabled once lowerArchRetention is fixed", () => {
  const fields = allFields(digitalRxForm);
  const field = fields.find((f) => f.key === "lowerExpansionType");
  assert.ok(field, "lowerExpansionType field missing");
  assert.ok(
    field.options.includes("Memory Screw (Removable Only)"),
    "lowerExpansionType is missing its Removable Only option"
  );

  const withRemovable = disabledOptions(field, {
    lowerArchRetention: "Acrylic w/ clasp retention",
  });
  assert.equal(withRemovable.size, 0, "no options disabled while retention is removable");

  const withFixed = disabledOptions(field, { lowerArchRetention: "Fixed (Banded)" });
  assert.ok(withFixed.has("Memory Screw (Removable Only)"));

  const withFixed2 = disabledOptions(field, {
    lowerArchRetention: "Fixed [3D Printed] Bands",
  });
  assert.ok(withFixed2.has("Memory Screw (Removable Only)"));
});

/* ── Trutaine contradiction: onSpecifications moved before opposingTrutaine,
      which hides once the contradictory option is selected ── */

test("onSpecifications is declared before opposingTrutaine in the olmos section", () => {
  const olmos = digitalRxForm.sections.find((s) => s.id === "olmos");
  const keys = olmos.fields.map((f) => f.key);
  const onIdx = keys.indexOf("onSpecifications");
  const opposingIdx = keys.indexOf("opposingTrutaine");
  assert.ok(onIdx >= 0 && opposingIdx >= 0, "both fields must survive the reorder");
  assert.ok(onIdx < opposingIdx, "onSpecifications must be declared before opposingTrutaine");
});

test("opposingTrutaine hides once 'Upper arch ONLY (No opposing trutaine)' is selected", () => {
  const base = { devicesToOrder: ["olmos"] };
  const noOnSpec = visibleFields(digitalRxForm, base).map((f) => f.key);
  assert.ok(noOnSpec.includes("opposingTrutaine"), "visible by default");

  const otherOnSpec = visibleFields(digitalRxForm, {
    ...base,
    onSpecifications: ["No anterior build-up on lower"],
  }).map((f) => f.key);
  assert.ok(otherOnSpec.includes("opposingTrutaine"), "unrelated onSpecifications answers don't hide it");

  const contradictory = visibleFields(digitalRxForm, {
    ...base,
    onSpecifications: ["Upper arch ONLY (No opposing trutaine)"],
  }).map((f) => f.key);
  assert.ok(!contradictory.includes("opposingTrutaine"), "hidden once the contradictory option is picked");
});

/* ── Tandem reference image: only relevant for Modified Tandem ── */

test("imgModifiedTandem is gated on selectDevice === 'Modified Tandem'", () => {
  const twinBlock = visibleFields(digitalRxForm, {
    devicesToOrder: ["ortho"],
    selectDevice: "Twin Block",
  }).map((f) => f.key);
  assert.ok(!twinBlock.includes("imgModifiedTandem"));
  const noSelection = visibleFields(digitalRxForm, {
    devicesToOrder: ["ortho"],
  }).map((f) => f.key);
  assert.ok(!noSelection.includes("imgModifiedTandem"));
  const tandem = visibleFields(digitalRxForm, {
    devicesToOrder: ["ortho"],
    selectDevice: "Modified Tandem",
  }).map((f) => f.key);
  assert.ok(tandem.includes("imgModifiedTandem"));
});

/* ── Rescued images no longer point at the retiring JotForm CDN ── */

test("no ortho static image points at jotform.com any more", () => {
  const keys = ["imgModifiedTandem", "imgTandemLength", "imgMaxillaryReference", "imgMandibularReference"];
  const fields = allFields(digitalRxForm);
  for (const k of keys) {
    const field = fields.find((f) => f.key === k);
    assert.ok(field, `${k} field missing`);
    assert.ok(!/jotform\.com/i.test(field.src), `${k}.src still points at jotform.com: ${field.src}`);
    assert.ok(field.src.startsWith("/images/rx/ortho/"), `${k}.src should be a local asset path, got ${field.src}`);
  }
});

test("no two fields in the same section carry the same label", () => {
  // The two ex-ortho rush sliders were both labelled "RUSH case request:" and
  // sat side by side in `submit-form` — indistinguishable to a doctor. The same
  // label under a different section heading (Maxillary vs Mandibular "Add:") is
  // disambiguated by that heading, so duplicates are only checked per section.
  const SKIP = new Set(["heading", "note", "static", "image", "divider"]);
  for (const devices of [["ddso"], ["ortho"], ["ddso", "ortho", "nightguards"]]) {
    const answers = { devicesToOrder: devices };
    const visible = new Set(visibleFields(digitalRxForm, answers).map((f) => f.key));
    for (const section of digitalRxForm.sections) {
      const seen = new Map();
      for (const f of section.fields || []) {
        if (!f.label || SKIP.has(f.type) || !visible.has(f.key)) continue;
        const prev = seen.get(f.label);
        assert.ok(!prev, `section ${section.id}: "${f.label}" is on both ${prev} and ${f.key}`);
        seen.set(f.label, f.key);
      }
    }
  }
});
