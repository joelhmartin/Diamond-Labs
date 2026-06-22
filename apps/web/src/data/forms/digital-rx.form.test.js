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

test("ports at least 80 meaningful fields", () => {
  const fields = allFields(digitalRxForm);
  assert.ok(
    fields.length >= 80,
    `expected >= 80 fields, got ${fields.length}`
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
