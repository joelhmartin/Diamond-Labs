import { test } from "vitest";
import assert from "node:assert/strict";

import { digitalRxForm } from "./digital-rx.form.js";
import { allFields, visibleFields, disabledOptions, validateForm } from "./form-logic.js";

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

test("has the devicesToOrder multi-select gate with all 8 device values", () => {
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

test("a DDSO-only doctor sees the shared rush checkbox but no rush-charge sliders when not rushing", () => {
  const shown = visibleFields(digitalRxForm, { devicesToOrder: ["ddso"] }).map((f) => f.key);
  assert.ok(shown.includes("rushCase"), "the shared rush checkbox must always show");
  for (const k of ["rushChargeBiomed", "rushChargeNylon"])
    assert.ok(!shown.includes(k), `${k} should be hidden until rushCase is ticked`);
});

/* ── Orthodontics moved to its own form (ortho-rx.form.js) ── */

const ORTHO_ONLY_KEYS = [
  "selectDevice", "upperArchRetention", "upperExpansionType", "lowerArchRetention",
  "lowerExpansionType", "addToMaxillary", "addToMandibular", "upperExpansionSelection",
  "lowerExpansionSelection", "fixedMandibularExpansion", "removableMandibularExpansion",
  "nuveloDigitalSetup", "digitalStudyModels", "digitalSetupEmail",
];

test("the digital form no longer offers orthodontics", () => {
  const gate = allFields(digitalRxForm).find((f) => f.key === "devicesToOrder");
  assert.ok(!gate.options.some((o) => o.value === "ortho"), "ortho must not be a devicesToOrder option");
  const keys = new Set(allFields(digitalRxForm).map((f) => f.key));
  for (const k of ORTHO_ONLY_KEYS) assert.ok(!keys.has(k), `ortho field ${k} is still in the digital form`);
  for (const id of ["functionalDualArch", "maxillaryUpper", "mandibularLower"])
    assert.ok(!digitalRxForm.sections.some((s) => s.id === id), `ortho section ${id} is still in the digital form`);
});

/* ═══════════════════════════════════════════════════════════════════════
   Conditional-display rules (lab-owner approved) — each covers both
   directions: hidden when the trigger isn't met, visible when it is.
   All go through visibleFields(digitalRxForm, answers), the real predicate.
   ═══════════════════════════════════════════════════════════════════════ */

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

test("no two fields in the same section carry the same label", () => {
  // The two rush sliders were both labelled "RUSH case request:" and
  // sat side by side in `submit-form` — indistinguishable to a doctor. The same
  // label under a different section heading (Maxillary vs Mandibular "Add:") is
  // disambiguated by that heading, so duplicates are only checked per section.
  const SKIP = new Set(["heading", "note", "static", "image", "divider"]);
  for (const devices of [["ddso"], ["olmos"], ["ddso", "olmos", "nightguards"]]) {
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

// ── Questions restored from JotForm's conditionally-revealed (hidden) fields ──

const shownKeys = (answers) => visibleFields(digitalRxForm, answers).map((f) => f.key);
const ONP = "POSITIONER (ON-P) - Anterior Occlusion";
const ONT = "TITRATION (ON-T) - NYLON Only";

test("Olmos Night asks for a base material once a D/P/R design is picked, with no default", () => {
  assert.ok(!shownKeys({ devicesToOrder: ["olmos"] }).includes("onMaterial"), "hidden before a design is picked");
  assert.ok(shownKeys({ devicesToOrder: ["olmos"], onDesign: ONP }).includes("onMaterial"));
  const field = allFields(digitalRxForm).find((f) => f.key === "onMaterial");
  assert.equal(field.required, true);
  assert.equal(field.default, undefined);
  assert.deepEqual(field.options, ["NYLON", "PMT (Diamoform)", "BIOMED", "DUAL-LAMINATE", "ACRYLIC W/CLASPS"]);
  const { errors } = validateForm(digitalRxForm, { devicesToOrder: ["olmos"], onDesign: ONP });
  assert.ok(errors.onMaterial, "a Positioner without a material is not submittable");
});

test("Titration (ON-T) is Nylon only, so it never asks for a material", () => {
  assert.ok(!shownKeys({ devicesToOrder: ["olmos"], onDesign: ONT }).includes("onMaterial"));
});

test("Olmos Night offers its modifications once a design is picked", () => {
  assert.ok(shownKeys({ devicesToOrder: ["olmos"], onDesign: ONP }).includes("onModifications"));
  const field = allFields(digitalRxForm).find((f) => f.key === "onModifications");
  assert.deepEqual(field.options.map((o) => o.value), ["Tongue Positioners", "Hooks for Elastics", "Vertical Shims", "BAB Loop"]);
});

test("D-Pro section asks D-Pro or Manta, required", () => {
  const field = allFields(digitalRxForm).find((f) => f.key === "dproDevice");
  assert.deepEqual(field.options, ["D-Pro", "Manta"]);
  assert.equal(field.required, true);
  assert.ok(shownKeys({ devicesToOrder: ["dpro"] }).includes("dproDevice"));
});

test("titration placement appears for Tripod occlusion only, on DDSO and D-Pro", () => {
  assert.ok(!shownKeys({ devicesToOrder: ["ddso"], ddsoOcclusalContact: "Anterior Contact" }).includes("ddsoTitrationPlacement"));
  assert.ok(shownKeys({ devicesToOrder: ["ddso"], ddsoOcclusalContact: "TRIPOD Occlusion" }).includes("ddsoTitrationPlacement"));
  assert.ok(shownKeys({ devicesToOrder: ["dpro"], dproOcclusalContact: "TRIPOD Occlusion" }).includes("dproTitrationPlacement"));
});
