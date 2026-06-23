import { test } from "vitest";
import assert from "node:assert/strict";

import { formAnswersToCaseInput } from "./form-to-case.js";
import { getForm } from "./index.js";

const digital = getForm("digital");
const ortho = getForm("ortho");

test("digital: mistry(ARA only) + sportguards + dpro → 3 devices (ARA, sport-guard, D-Pro; no MORA)", () => {
  const answers = {
    devicesToOrder: ["mistry", "sportguards", "dpro"],
    // MISTRY: only ARA selected → emit ara, NOT mora
    ara: ["ARA - Anterior Repositioning Appliance"],
    // sport guard
    sportGuardDevice: ["Diamond Orthotic Sport-Guard"],
    mouthguardComments: "boil-and-bite no",
    // d-pro
    dproAdditionalOptions: ["Soft liner"],
    dproComments: "tight fit",
  };

  const { devices } = formAnswersToCaseInput("digital", digital, answers);
  const keys = devices.map((d) => d.deviceKey);

  assert.equal(devices.length, 3);
  assert.ok(keys.includes("ara"), "expected ara device");
  assert.ok(!keys.includes("mora"), "MORA must NOT be emitted (not selected)");
  assert.ok(keys.includes("sport-guard"), "expected sport-guard device");
  assert.ok(keys.includes("cadcam-d-pro"), "expected cadcam-d-pro device");
});

test("digital: olmos with OD + ON fields → both olmos-day and olmos-night", () => {
  const answers = {
    devicesToOrder: ["olmos"],
    odMaterial: "OD (PMT)",
    odComments: "day notes",
    onDesign: "Positioner ON-P (Anterior)",
    onSpecifications: ["No anterior build-up on lower"],
  };

  const { devices } = formAnswersToCaseInput("digital", digital, answers);
  const keys = devices.map((d) => d.deviceKey);

  assert.ok(keys.includes("olmos-day"), "expected olmos-day device");
  assert.ok(keys.includes("olmos-night"), "expected olmos-night device");

  const day = devices.find((d) => d.deviceKey === "olmos-day");
  assert.equal(day.deviceOptions.baseMaterial, "OD (PMT)");
  const night = devices.find((d) => d.deviceKey === "olmos-night");
  assert.equal(night.deviceOptions.variant, "Positioner ON-P (Anterior)");
});

test("digital: olmos with NO OD/ON fields → single olmos-day with empty options", () => {
  const { devices } = formAnswersToCaseInput("digital", digital, {
    devicesToOrder: ["olmos"],
  });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].deviceKey, "olmos-day");
  assert.deepEqual(devices[0].deviceOptions, {});
});

test("ortho slug → single ortho-expander device + shared caseFields (no whole-form dump)", () => {
  const { devices, caseFields } = formAnswersToCaseInput("ortho", ortho, {
    additionalComments: "please rush",
  });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].deviceKey, "ortho-expander");
  assert.equal(caseFields.recordsMethod, "itero");
  assert.equal(caseFields.firstDevice, "Yes");
  // caseFields no longer dumps the whole form into generalComments
  assert.equal(caseFields.generalComments, undefined);
});
