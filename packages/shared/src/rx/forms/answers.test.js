import { test } from "vitest";
import assert from "node:assert/strict";
import { groupRxAnswers, formatRxAnswer } from "./answers.js";
import { getRxForm, RX_FORM_LIST } from "./index.js";

const form = {
  sections: [
    {
      id: "case-id", heading: "Case Identification",
      fields: [
        { type: "static", key: "noteDoctorAuto", html: "<b>Doctor</b>" },
        { type: "heading", key: "hdrCaseId", label: "Case Identification" },
        { type: "fullname", key: "patientName", label: "PATIENT:" },
        { type: "date", key: "dueDate", label: "Due Date Requested" },
      ],
    },
    {
      id: "ddso", heading: "DDSO",
      fields: [
        { type: "checkbox", key: "ddsoMods", label: "Modifications ↴" },
        { type: "fileUpload", key: "recordsUpload", label: "Upload" },
        { type: "radio", key: "ddsoEmpty", label: "Unanswered" },
      ],
    },
    { id: "unused", heading: "Not answered", fields: [{ type: "text", key: "nothing", label: "Nothing" }] },
  ],
};

test("answers are grouped by the form's sections, in form order, with clean labels", () => {
  const groups = groupRxAnswers(form, {
    patientName: { first: "Jane", last: "Doe" },
    dueDate: "2026-10-21",
    ddsoMods: ["Wrap distal", "Anterior pad"],
    recordsUpload: ["scan.stl"],
    ddsoEmpty: "",
    strayKey: true,
  });
  assert.deepEqual(groups, [
    { id: "case-id", title: "Case Identification", items: [
      { key: "patientName", label: "PATIENT", value: "Jane Doe" },
      { key: "dueDate", label: "Due Date Requested", value: "2026-10-21" },
    ] },
    { id: "ddso", title: "DDSO", items: [{ key: "ddsoMods", label: "Modifications", value: "Wrap distal, Anterior pad" }] },
    { id: "other", title: "Other answers", items: [{ key: "strayKey", label: "Stray Key", value: "Yes" }] },
  ]);
});

test("file, signature and display-only fields never print as answers", () => {
  const groups = groupRxAnswers(form, { recordsUpload: ["scan.stl"], noteDoctorAuto: "x" });
  assert.deepEqual(groups, []);
});

test("nested answers (matrices) read as words, never JSON", () => {
  assert.equal(formatRxAnswer({ upper: { clearance: "2mm" } }), "Upper: Clearance: 2mm");
  assert.equal(formatRxAnswer([]), null);
  assert.equal(formatRxAnswer(false), "No");
  assert.equal(formatRxAnswer(0), "0");
});

test("an unknown form still prints every answer, under Other", () => {
  const groups = groupRxAnswers(null, { foo: "bar" });
  assert.deepEqual(groups, [{ id: "other", title: "Other answers", items: [{ key: "foo", label: "Foo", value: "bar" }] }]);
});

test("option-based fields print the option label, for {value,label} and plain-string options", () => {
  const f = { sections: [{ id: "s", heading: "S", fields: [
    { type: "checkbox", key: "devs", label: "Devices", options: [{ value: "a", label: "Alpha Device" }, { value: "b", label: "Beta Device" }] },
    { type: "radio", key: "ret", label: "Retention", options: ["Fixed", "Removable"] },
    { type: "select", key: "sel", label: "Pick", options: [{ value: "x", label: "Ex" }] },
  ] }] };
  const [g] = groupRxAnswers(f, { devs: ["a", "b"], ret: "Fixed", sel: "x" });
  assert.deepEqual(g.items.map((i) => i.value), ["Alpha Device, Beta Device", "Fixed", "Ex"]);
});

test("a stored value with no matching option falls back to the raw value", () => {
  const f = { sections: [{ id: "s", heading: "S", fields: [
    { type: "radio", key: "r", label: "R", options: [{ value: "a", label: "Alpha" }] },
    { type: "checkbox", key: "c", label: "C", options: [{ value: "a", label: "Alpha" }] },
  ] }] };
  const [g] = groupRxAnswers(f, { r: "legacy", c: ["a", "old"] });
  assert.deepEqual(g.items.map((i) => i.value), ["legacy", "Alpha, old"]);
});

test("the real forms are registered and group a real answer by label", () => {
  assert.deepEqual(RX_FORM_LIST.map((f) => f.slug), ["digital", "ortho"]);
  assert.equal(getRxForm("nope"), null);
  const groups = groupRxAnswers(getRxForm("digital"), { devicesToOrder: ["ddso"] });
  const select = groups.find((g) => g.id === "select-device");
  assert.equal(select.items[0].value, "DDSO — Diamond Digital Sleep Orthotic");
});
