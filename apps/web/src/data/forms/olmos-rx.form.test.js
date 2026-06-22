import { test } from "vitest";
import assert from "node:assert/strict";

import { olmosRxForm } from "./olmos-rx.form.js";
import { allFields } from "./form-logic.js";

// Supported field types (mirrors the RENDERERS map in components/rx/fields.jsx).
const SUPPORTED_TYPES = new Set([
  "radio",
  "checkbox",
  "select",
  "text",
  "textarea",
  "matrix",
  "colorPalette",
  "fileUpload",
  "artboard",
  "fullname",
  "email",
  "phone",
  "address",
  "date",
  "signature",
  "heading",
  "divider",
  "image",
  "static",
]);

// Labels shared with the Orthodontic Rx (SHARED core).
// NOTE: doctor-identity ("DOCTOR:", "Email Address") and the entire
// Remake/Repair/Redesign block were removed per lab-owner feedback.
const SHARED_LABELS = [
  "PATIENT:",
  "Date",
  "Due Date Requested",
  "Select Device",
  "Is this the patients first device?",
  "RUSH case request:",
  "Would you like to rush this case?",
  "Will you be sending a physical bite?",
  "PHYSICAL AND/OR DIGITAL RECORDS",
  "Upload your files",
  "UPPER- Expansion Option Selection:",
  "LOWER- Expansion Option Selection",
  "Lower arch retention and base material:",
  "Fixed Mandibular Expansion (Only)",
  "Removable Mandibular Expansion (Only)",
  "NUVELO Digital Setup ONLY",
  "Email to submit digital setup once completed:",
  "Check this box if you would like to design (draw) your appliance",
  "Please use the artboard below to illustrate",
  "Additional Comments for ORTHO Design",
  "Additional Comments/Instructions",
  "Doctor Signature",
  "Add:",
];

// OLMOS-only labels — note MX/MD terminology must be verbatim.
const OLMOS_ONLY_LABELS = [
  "Add to MD Arch",
  "Add to MX Arch:",
  "Dual-Arch Functional Options",
  "Fixed Maxillary Expansion (Only):",
  "Md. Expansion type:",
  "Mx. Expansion type:",
  "Upper arch retention and base material:",
];

const fields = allFields(olmosRxForm);
const labels = fields.map((f) => (f.label || "").trim().toLowerCase());

function hasLabel(needle) {
  const n = needle.trim().toLowerCase();
  return labels.some((l) => l.includes(n));
}

test("definition metadata is correct", () => {
  assert.equal(olmosRxForm.slug, "olmos");
  assert.equal(olmosRxForm.jotformId, "233543911011141");
  assert.equal(olmosRxForm.title, "OLMOS - Orthodontic Rx.");
  assert.equal(olmosRxForm.route, "/app/rx/olmos");
});

test("has at least 42 fields", () => {
  assert.ok(
    fields.length >= 42,
    `expected >= 42 fields, got ${fields.length}`,
  );
});

test("all keyed fields have unique camelCase keys", () => {
  const keys = fields.map((f) => f.key).filter((k) => k != null);
  const seen = new Set();
  for (const k of keys) {
    assert.ok(/^[a-z][a-zA-Z0-9]*$/.test(k), `key not camelCase: ${k}`);
    assert.ok(!seen.has(k), `duplicate key: ${k}`);
    seen.add(k);
  }
});

test("every field type is supported", () => {
  for (const f of fields) {
    assert.ok(SUPPORTED_TYPES.has(f.type), `unsupported field type: ${f.type}`);
  }
});

test("includes every SHARED core label", () => {
  for (const label of SHARED_LABELS) {
    assert.ok(hasLabel(label), `missing SHARED label: ${label}`);
  }
});

test("includes every OLMOS-only label", () => {
  for (const label of OLMOS_ONLY_LABELS) {
    assert.ok(hasLabel(label), `missing OLMOS-only label: ${label}`);
  }
});

test("locks OLMOS MX/MD terminology (not Maxillary/Mandibular)", () => {
  assert.ok(hasLabel("MX Arch"), "expected a label containing 'MX Arch'");
  assert.ok(hasLabel("MD Arch"), "expected a label containing 'MD Arch'");
  assert.ok(hasLabel("Mx. Expansion"), "expected a label containing 'Mx. Expansion'");
  assert.ok(hasLabel("Md. Expansion"), "expected a label containing 'Md. Expansion'");
});

test("has at least one fileUpload, one signature, one artboard", () => {
  assert.ok(fields.some((f) => f.type === "fileUpload"), "no fileUpload field");
  assert.ok(fields.some((f) => f.type === "signature"), "no signature field");
  assert.ok(fields.some((f) => f.type === "artboard"), "no artboard field");
});

test("no doctor-identity / contact / address field remains", () => {
  // The digital-setup email (key digitalSetupEmail) is allowed to remain.
  const offenders = fields
    .map((f) => f.key)
    .filter(Boolean)
    .filter((k) => /doctorName|^email$|contactPhone|address/i.test(k));
  assert.deepEqual(offenders, [], `unexpected identity field keys: ${offenders}`);
});

test("Remake/Repair/Redesign section is gone", () => {
  const ids = olmosRxForm.sections.map((s) => s.id);
  assert.ok(!ids.includes("remakeRequest"), "remakeRequest section still present");
});

test("opening image-only intro section is gone", () => {
  const ids = olmosRxForm.sections.map((s) => s.id);
  assert.ok(!ids.includes("intro"), "intro image-only section still present");
  // No section should consist solely of decorative image(s).
  for (const s of olmosRxForm.sections) {
    const inputish = (s.fields || []).filter((f) => f.type !== "image");
    assert.ok(inputish.length > 0, `section ${s.id} is image-only`);
  }
});

test("image-bearing option groups carry an image on each option", () => {
  // field key → expected number of image-bearing options (from JotForm snapshot).
  const EXPECTED_IMAGE_OPTIONS = {
    physicalDigitalRecords: 10, // qid 86 (OLMOS snapshot has 10 records)
    fixedMaxillaryExpansion: 2, // qid 484
    fixedMandibularExpansion: 3, // qid 487
    removableMandibularExpansion: 3, // qid 496
  };
  for (const [key, count] of Object.entries(EXPECTED_IMAGE_OPTIONS)) {
    const field = fields.find((f) => f.key === key);
    assert.ok(field, `field ${key} is missing`);
    const withImage = field.options.filter(
      (o) => o && typeof o === "object" && typeof o.image === "string" && o.image,
    );
    assert.equal(
      withImage.length,
      count,
      `field ${key}: expected ${count} options with images, got ${withImage.length}`,
    );
  }
});

test("fileUpload accept is a valid dotted list including .stl", () => {
  const up = fields.find((f) => f.type === "fileUpload");
  assert.ok(up, "missing fileUpload field");
  const exts = up.accept.split(",").map((s) => s.trim());
  assert.ok(exts.includes(".stl"), `accept missing .stl: ${up.accept}`);
  for (const ext of exts) {
    assert.ok(/^\.[a-z0-9]+$/.test(ext), `malformed accept token: ${ext}`);
  }
});
