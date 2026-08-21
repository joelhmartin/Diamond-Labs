import { test } from "vitest";
import assert from "node:assert/strict";

import { rxFormSubmitSchema, buildDigitalDevices } from "@my-app/shared";

test("valid payload parses", () => {
  const result = rxFormSubmitSchema.safeParse({
    formType: "digital",
    patientFirst: "Jane",
    patientLast: "Doe",
    formData: { q1: "yes", q2: ["a", "b"] },
    dueDate: "2026-07-01",
    signatureUrl: "data:image/png;base64,AAAA",
  });
  assert.equal(result.success, true);
  assert.equal(result.data.formType, "digital");
  assert.equal(result.data.patientFirst, "Jane");
  assert.deepEqual(result.data.formData, { q1: "yes", q2: ["a", "b"] });
});

test("missing patientFirst → parse error", () => {
  const result = rxFormSubmitSchema.safeParse({
    formType: "digital",
    patientLast: "Doe",
    formData: {},
  });
  assert.equal(result.success, false);
  assert.ok(
    result.error.issues.some((i) => i.path.join(".") === "patientFirst"),
    "expected an issue on patientFirst"
  );
});

test('formType "bogus" → error', () => {
  const result = rxFormSubmitSchema.safeParse({
    formType: "bogus",
    patientFirst: "Jane",
    patientLast: "Doe",
    formData: {},
  });
  assert.equal(result.success, false);
  assert.ok(
    result.error.issues.some((i) => i.path.join(".") === "formType"),
    "expected an issue on formType"
  );
});

test("omitted formData defaults to {}", () => {
  const result = rxFormSubmitSchema.safeParse({
    formType: "digital",
    patientFirst: "Jane",
    patientLast: "Doe",
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.formData, {});
});

test("a form submission resolves its devices instead of storing null", () => {
  const devices = buildDigitalDevices({
    devicesToOrder: ["ddso"],
    ddsoMaterial: "NYLON",
  });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].deviceKey, "ddso");
});

test("a multi-device submission keeps every device, not just the first", () => {
  const devices = buildDigitalDevices({
    devicesToOrder: ["ddso", "snorehook"],
    ddsoMaterial: "NYLON",
  });
  assert.deepEqual(devices.map((d) => d.deviceKey).sort(), ["ddso", "snorehook"]);
});
