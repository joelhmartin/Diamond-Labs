import { test } from "vitest";
import assert from "node:assert/strict";

import { orthodonticRxForm } from "./orthodontic-rx.form.js";
import { allFields } from "./form-logic.js";

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

// Shared core labels (present on Digital, Ortho and OLMOS forms).
// NOTE: doctor-identity ("DOCTOR:", "Email Address") and the entire
// Remake/Repair/Redesign block ("Did you return the original models",
// "Please explain in as much detail as possible", "Date Received …") were
// removed per lab-owner feedback (new-device forms only).
const SHARED_CORE_LABELS = [
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

// Ortho-only labels. (CONTACT / ADDRESS doctor-identity fields removed.)
const ORTHO_ONLY_LABELS = [
  "UPPER Expansion type:",
  "Lower Expansion type:",
  "UPPER arch retention and base material:",
  "Add to Maxillary:",
  "Add to Mandibular:",
  "Mx. Selections",
  "Occlusal Options for tandem bow",
  "Digital 'Study' Models",
  "Required Selection",
];

test("orthodonticRxForm has the expected definition envelope", () => {
  assert.equal(orthodonticRxForm.slug, "ortho");
  assert.equal(orthodonticRxForm.jotformId, "213545611846154");
  assert.equal(orthodonticRxForm.title, "Diamond Orthodontic Rx.");
  assert.equal(orthodonticRxForm.route, "/app/rx/ortho");
  assert.ok(Array.isArray(orthodonticRxForm.sections));
});

test("field count is at least 45", () => {
  const fields = allFields(orthodonticRxForm);
  assert.ok(fields.length >= 45, `expected >= 45 fields, got ${fields.length}`);
});

test("all defined field keys are unique", () => {
  const keys = allFields(orthodonticRxForm)
    .map((f) => f.key)
    .filter(Boolean);
  assert.equal(new Set(keys).size, keys.length, "duplicate field keys present");
});

test("every field type is supported", () => {
  for (const f of allFields(orthodonticRxForm)) {
    assert.ok(SUPPORTED_TYPES.has(f.type), `unsupported field type: ${f.type}`);
  }
});

test("contains every shared-core label", () => {
  const labels = allFields(orthodonticRxForm)
    .map((f) => (f.label || "").trim().toLowerCase())
    .filter(Boolean);
  for (const expected of SHARED_CORE_LABELS) {
    const needle = expected.trim().toLowerCase();
    assert.ok(
      labels.some((l) => l.includes(needle)),
      `missing shared-core label: ${expected}`,
    );
  }
});

test("contains every ortho-only label", () => {
  const labels = allFields(orthodonticRxForm)
    .map((f) => (f.label || "").trim().toLowerCase())
    .filter(Boolean);
  for (const expected of ORTHO_ONLY_LABELS) {
    const needle = expected.trim().toLowerCase();
    assert.ok(
      labels.some((l) => l.includes(needle)),
      `missing ortho-only label: ${expected}`,
    );
  }
});

test("has at least one fileUpload, one signature, and one artboard field", () => {
  const types = allFields(orthodonticRxForm).map((f) => f.type);
  assert.ok(types.includes("fileUpload"), "missing fileUpload field");
  assert.ok(types.includes("signature"), "missing signature field");
  assert.ok(types.includes("artboard"), "missing artboard field");
});

test("no doctor-identity / contact / address field remains", () => {
  // The digital-setup email (key digitalSetupEmail) is allowed to remain.
  const offenders = allFields(orthodonticRxForm)
    .map((f) => f.key)
    .filter(Boolean)
    .filter((k) => /doctorName|^email$|contactPhone|address/i.test(k));
  assert.deepEqual(offenders, [], `unexpected identity field keys: ${offenders}`);
});

test("Remake/Repair/Redesign section is gone", () => {
  const ids = orthodonticRxForm.sections.map((s) => s.id);
  assert.ok(!ids.includes("remakeRequest"), "remakeRequest section still present");
});

test("fileUpload accept is a valid dotted list including .stl", () => {
  const up = allFields(orthodonticRxForm).find((f) => f.type === "fileUpload");
  assert.ok(up, "missing fileUpload field");
  const exts = up.accept.split(",").map((s) => s.trim());
  assert.ok(exts.includes(".stl"), `accept missing .stl: ${up.accept}`);
  for (const ext of exts) {
    assert.ok(/^\.[a-z0-9]+$/.test(ext), `malformed accept token: ${ext}`);
  }
});
