import { test } from "vitest";
import assert from "node:assert/strict";

import {
  allFields,
  visibleFields,
  validateForm,
  shouldShow,
  buildSubmitFormData,
} from "./form-logic.js";

function makeForm() {
  return {
    slug: "test",
    jotformId: "0",
    title: "Test",
    route: "/test",
    sections: [
      {
        id: "s1",
        fields: [
          { type: "text", key: "a", label: "A", required: true },
          { type: "radio", key: "trigger", label: "Trigger", options: ["yes", "no"] },
        ],
      },
      {
        id: "s2",
        fields: [
          {
            type: "text",
            key: "b",
            label: "B",
            required: true,
            showIf: { key: "trigger", equals: "yes" },
          },
          { type: "heading", label: "Section head" },
        ],
      },
    ],
  };
}

test("validateForm flags a missing required visible field", () => {
  const form = makeForm();
  const { ok, errors } = validateForm(form, { trigger: "no" });
  assert.equal(ok, false);
  assert.ok(errors.a, "field `a` should have an error");
});

test("validateForm ignores a required field hidden by showIf", () => {
  const form = makeForm();
  // `a` is filled; `b` is required but hidden because trigger !== 'yes'.
  const { ok, errors } = validateForm(form, { a: "filled", trigger: "no" });
  assert.equal(ok, true);
  assert.equal(errors.b, undefined);
});

test("validateForm passes when all required present", () => {
  const form = makeForm();
  const { ok } = validateForm(form, { a: "filled", trigger: "yes", b: "also" });
  assert.equal(ok, true);
});

test("allFields preserves declaration order across sections", () => {
  const form = makeForm();
  const keys = allFields(form).map((f) => f.key);
  assert.deepEqual(keys, ["a", "trigger", "b", undefined]);
});

test("shouldShow honors equals and prefix", () => {
  const eqField = { showIf: { key: "x", equals: "yes" } };
  assert.equal(shouldShow(eqField, { x: "yes" }), true);
  assert.equal(shouldShow(eqField, { x: "no" }), false);
  const pfxField = { showIf: { key: "x", prefix: "Device:" } };
  assert.equal(shouldShow(pfxField, { x: "Device:Foo" }), true);
  assert.equal(shouldShow(pfxField, { x: "Other" }), false);
  assert.equal(shouldShow({}, {}), true);
});

test("visibleFields filters hidden fields", () => {
  const form = makeForm();
  const keys = visibleFields(form, { trigger: "no" }).map((f) => f.key);
  assert.ok(!keys.includes("b"));
});

test("buildSubmitFormData: text answers land in formData JSON; fileUpload appended as file", () => {
  const form = {
    slug: "t",
    sections: [
      {
        id: "s",
        fields: [
          { type: "fullname", key: "patientName", label: "Patient" },
          { type: "text", key: "doctorName", label: "Doctor" },
          { type: "fileUpload", key: "scans", label: "Scans" },
        ],
      },
    ],
  };
  let file;
  if (typeof File !== "undefined") {
    file = new File(["x"], "a.png", { type: "image/png" });
  } else {
    file = new Blob(["x"], { type: "image/png" });
  }
  const answers = {
    patientName: { first: "Jane", last: "Doe" },
    doctorName: "Dr. Who",
    scans: [file],
  };

  const fd = buildSubmitFormData({ formType: "digital", form, answers });

  assert.equal(fd.get("formType"), "digital");
  assert.equal(fd.get("patientFirst"), "Jane");
  assert.equal(fd.get("patientLast"), "Doe");

  const parsed = JSON.parse(fd.get("formData"));
  assert.equal(parsed.doctorName, "Dr. Who");
  // file answer must NOT be serialized into the JSON blob
  assert.equal(parsed.scans, undefined);

  // the File must be appended under `file`
  const appended = fd.getAll("file");
  assert.equal(appended.length, 1);
});
