import { test } from "vitest";
import assert from "node:assert/strict";

import { digitalRxForm } from "./digital-rx.form.js";
import { allFields } from "./form-logic.js";

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
