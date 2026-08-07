import { test } from "vitest";
import assert from "node:assert/strict";

import { digitalRxForm } from "./digital-rx.form.js";
import { allFields, visibleFields } from "./form-logic.js";

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
  const shown = visibleFields(digitalRxForm, { devicesToOrder: ["ortho"] }).map((f) => f.key);
  for (const k of ["nuveloDigitalSetup", "digitalStudyModels", "digitalSetupEmail"])
    assert.ok(shown.includes(k), `${k} should be visible with ortho`);
});
