import { test } from "vitest";
import assert from "node:assert/strict";

import {
  allFields,
  visibleFields,
  validateForm,
  shouldShow,
  buildSubmitFormData,
  sectionVisible,
  disabledOptions,
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

test("shouldShow handles includes against an array answer", () => {
  const field = { type: "text", key: "x", showIf: { key: "devices", includes: "ortho" } };
  assert.equal(shouldShow(field, { devices: ["ortho", "ddso"] }), true);
  assert.equal(shouldShow(field, { devices: ["ddso"] }), false);
  assert.equal(shouldShow(field, {}), false);
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

const gatedForm = {
  sections: [
    { id: "always", fields: [{ type: "text", key: "a" }] },
    {
      id: "gated",
      showIf: { key: "devices", includes: "ddso" },
      fields: [{ type: "text", key: "b", required: true, label: "B" }],
    },
  ],
};

test("sectionVisible handles includes against an array answer", () => {
  assert.equal(sectionVisible(gatedForm.sections[1], { devices: ["ddso"] }), true);
  assert.equal(sectionVisible(gatedForm.sections[1], { devices: ["guard"] }), false);
  assert.equal(sectionVisible(gatedForm.sections[1], {}), false);
});

test("visibleFields excludes fields in hidden sections", () => {
  const keys = visibleFields(gatedForm, { devices: ["guard"] }).map((f) => f.key);
  assert.deepEqual(keys, ["a"]);
});

test("validateForm does not require fields the doctor cannot see", () => {
  const { ok, errors } = validateForm(gatedForm, { devices: ["guard"] });
  assert.equal(ok, true);
  assert.equal(errors.b, undefined);
});

/* ── new showIf shape: { key, answered: true } ────────────────────────── */

test("shouldShow: answered — plain string", () => {
  const field = { key: "b", showIf: { key: "a", answered: true } };
  assert.equal(shouldShow(field, { a: "filled" }), true);
  assert.equal(shouldShow(field, { a: "" }), false);
  assert.equal(shouldShow(field, {}), false);
});

test("shouldShow: answered — checkbox array", () => {
  const field = { key: "b", showIf: { key: "a", answered: true } };
  assert.equal(shouldShow(field, { a: ["x"] }), true);
  assert.equal(shouldShow(field, { a: [] }), false);
});

test("shouldShow: answered — fullname/address/matrix object (any sub-value counts)", () => {
  const field = { key: "b", showIf: { key: "a", answered: true } };
  assert.equal(shouldShow(field, { a: { first: "Jane", last: "" } }), true);
  assert.equal(shouldShow(field, { a: { first: "", last: "" } }), false);
  assert.equal(shouldShow(field, { a: {} }), false);
});

test("shouldShow: answered — signature/artboard data URL", () => {
  const field = { key: "b", showIf: { key: "a", answered: true } };
  assert.equal(shouldShow(field, { a: "data:image/png;base64,AAAA" }), true);
  assert.equal(shouldShow(field, { a: "" }), false);
});

/* ── new showIf shape: { key, oneOf: [...] } ──────────────────────────── */

test("shouldShow: oneOf — scalar answer", () => {
  const field = { key: "b", showIf: { key: "a", oneOf: ["x", "y"] } };
  assert.equal(shouldShow(field, { a: "x" }), true);
  assert.equal(shouldShow(field, { a: "z" }), false);
  assert.equal(shouldShow(field, {}), false);
});

test("shouldShow: oneOf — array answer matches if ANY selected value is in the list", () => {
  const field = { key: "b", showIf: { key: "a", oneOf: ["x", "y"] } };
  assert.equal(shouldShow(field, { a: ["z", "y"] }), true);
  assert.equal(shouldShow(field, { a: ["z"] }), false);
  assert.equal(shouldShow(field, { a: [] }), false);
});

/* ── new showIf shape: { key, cell: "<row>__<col>" } ──────────────────── */

test("shouldShow: cell — matrix flat-keyed answer", () => {
  const field = {
    key: "b",
    showIf: { key: "sportGuardSpecs", cell: "Please Select:__Add logo" },
  };
  assert.equal(
    shouldShow(field, { sportGuardSpecs: { "Please Select:__Add logo": "Yes" } }),
    true
  );
  assert.equal(
    shouldShow(field, { sportGuardSpecs: { "Please Select:__Add logo": "" } }),
    false
  );
  assert.equal(shouldShow(field, { sportGuardSpecs: {} }), false);
  assert.equal(shouldShow(field, {}), false);
});

/* ── sectionVisible must agree with shouldShow for every new shape ────── */

test("sectionVisible agrees with shouldShow on answered/oneOf/cell", () => {
  const answeredSection = { showIf: { key: "a", answered: true } };
  assert.equal(sectionVisible(answeredSection, { a: "x" }), true);
  assert.equal(sectionVisible(answeredSection, {}), false);

  const oneOfSection = { showIf: { key: "a", oneOf: ["x"] } };
  assert.equal(sectionVisible(oneOfSection, { a: "x" }), true);
  assert.equal(sectionVisible(oneOfSection, { a: "z" }), false);

  const cellSection = { showIf: { key: "m", cell: "r__c" } };
  assert.equal(sectionVisible(cellSection, { m: { r__c: "v" } }), true);
  assert.equal(sectionVisible(cellSection, { m: { r__c: "" } }), false);
});

/* ── new showIf shape: { all: [Condition, ...] } — AND of sub-conditions ── */

test("shouldShow: all — true only when every sub-condition holds", () => {
  const field = {
    key: "b",
    showIf: { all: [{ key: "a", equals: "x" }, { key: "c", answered: true }] },
  };
  assert.equal(shouldShow(field, { a: "x", c: "yes" }), true);
  assert.equal(shouldShow(field, { a: "x", c: "" }), false);
  assert.equal(shouldShow(field, { a: "y", c: "yes" }), false);
  assert.equal(shouldShow(field, {}), false);
});

test("shouldShow: all — empty array is vacuously true", () => {
  const field = { key: "b", showIf: { all: [] } };
  assert.equal(shouldShow(field, {}), true);
});

/* ── new showIf shape: { not: Condition } — negation ───────────────────── */

test("shouldShow: not — inverts the wrapped condition", () => {
  const field = { key: "b", showIf: { not: { key: "a", includes: "x" } } };
  assert.equal(shouldShow(field, { a: ["x"] }), false);
  assert.equal(shouldShow(field, { a: ["y"] }), true);
  assert.equal(shouldShow(field, {}), true);
});

test("sectionVisible agrees with shouldShow on all/not", () => {
  const allSection = { showIf: { all: [{ key: "a", equals: "x" }, { key: "b", answered: true }] } };
  assert.equal(sectionVisible(allSection, { a: "x", b: "y" }), true);
  assert.equal(sectionVisible(allSection, { a: "x" }), false);

  const notSection = { showIf: { not: { key: "a", equals: "x" } } };
  assert.equal(sectionVisible(notSection, { a: "x" }), false);
  assert.equal(sectionVisible(notSection, { a: "y" }), true);
});

/* ── unrecognised showIf shape: throws in dev rather than hiding silently ── */

test("shouldShow throws on an unrecognised showIf shape (dev-mode guard rail)", () => {
  const field = { key: "b", showIf: { key: "a", bogus: "nonsense" } };
  assert.throws(() => shouldShow(field, { a: "x" }));
});

test("sectionVisible throws on an unrecognised showIf shape too — same predicate", () => {
  const section = { showIf: { key: "a", bogus: "nonsense" } };
  assert.throws(() => sectionVisible(section, { a: "x" }));
});

/* ── disableOptionsIf / disabledOptions(field, answers) ────────────────── */

test("disabledOptions returns an empty set when no rule matches", () => {
  const field = {
    key: "upperExpansionType",
    disableOptionsIf: [
      {
        when: { key: "upperArchRetention", oneOf: ["Removable"] },
        options: ["Memory Screw (Fixed ONLY)", "Standard Hyrax RPE (Fixed ONLY)"],
      },
    ],
  };
  const set = disabledOptions(field, { upperArchRetention: "Fixed (Banded)" });
  assert.equal(set.size, 0);
});

test("disabledOptions returns the rule's options when the `when` condition matches", () => {
  const field = {
    key: "upperExpansionType",
    disableOptionsIf: [
      {
        when: { key: "upperArchRetention", oneOf: ["Removable"] },
        options: ["Memory Screw (Fixed ONLY)", "Standard Hyrax RPE (Fixed ONLY)"],
      },
    ],
  };
  const set = disabledOptions(field, { upperArchRetention: "Removable" });
  assert.ok(set.has("Memory Screw (Fixed ONLY)"));
  assert.ok(set.has("Standard Hyrax RPE (Fixed ONLY)"));
  assert.equal(set.size, 2);
});

test("disabledOptions with no disableOptionsIf on the field returns an empty set", () => {
  const set = disabledOptions({ key: "x" }, {});
  assert.equal(set.size, 0);
});

test("validateForm flags a selected option that is now disabled — stale answer must not silently pass", () => {
  const form = {
    sections: [
      {
        id: "s",
        fields: [
          { type: "radio", key: "upperArchRetention", options: ["Fixed", "Removable"] },
          {
            type: "radio",
            key: "upperExpansionType",
            label: "UPPER Expansion type",
            options: ["No Expansion", "Standard Hyrax RPE (Fixed ONLY)"],
            disableOptionsIf: [
              {
                when: { key: "upperArchRetention", oneOf: ["Removable"] },
                options: ["Standard Hyrax RPE (Fixed ONLY)"],
              },
            ],
          },
        ],
      },
    ],
  };
  // Doctor originally picked Fixed + the Hyrax screw, then changed their mind
  // to Removable — the screw answer is now contradictory but still present.
  const answers = {
    upperArchRetention: "Removable",
    upperExpansionType: "Standard Hyrax RPE (Fixed ONLY)",
  };
  const { ok, errors } = validateForm(form, answers);
  assert.equal(ok, false);
  assert.ok(errors.upperExpansionType, "stale disabled selection should be flagged");
});

test("validateForm passes when the selected option is not among the disabled ones", () => {
  const form = {
    sections: [
      {
        id: "s",
        fields: [
          { type: "radio", key: "upperArchRetention", options: ["Fixed", "Removable"] },
          {
            type: "radio",
            key: "upperExpansionType",
            label: "UPPER Expansion type",
            options: ["No Expansion", "Standard Hyrax RPE (Fixed ONLY)"],
            disableOptionsIf: [
              {
                when: { key: "upperArchRetention", oneOf: ["Removable"] },
                options: ["Standard Hyrax RPE (Fixed ONLY)"],
              },
            ],
          },
        ],
      },
    ],
  };
  const answers = {
    upperArchRetention: "Removable",
    upperExpansionType: "No Expansion",
  };
  const { ok } = validateForm(form, answers);
  assert.equal(ok, true);
});
