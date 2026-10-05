import { test } from "vitest";
import assert from "node:assert/strict";
import { buildDigitalDevices } from "./form-devices.js";

test("a DDSO selection becomes one device with its options", () => {
  const devices = buildDigitalDevices({
    devicesToOrder: ["ddso"],
    ddsoMaterial: "NYLON",
    ddsoOcclusalContact: "Anterior Contact",
    ddsoModifications: ["Tongue Positioners"],
  });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].deviceKey, "ddso");
  assert.equal(devices[0].deviceOptions.baseMaterial, "NYLON");
  assert.deepEqual(devices[0].deviceOptions.modifications, ["Tongue Positioners"]);
});

test("selecting nothing yields no devices — never invents one", () => {
  assert.deepEqual(buildDigitalDevices({}), []);
  assert.deepEqual(buildDigitalDevices({ devicesToOrder: [] }), []);
});

test("a nightguard carries its standardGuards matrix through", () => {
  const matrix = { "Essix Tray": { "UPPER ARCH": true } };
  const devices = buildDigitalDevices({ devicesToOrder: ["nightguards"], standardGuards: matrix });
  assert.deepEqual(devices[0].deviceOptions.standardGuards, matrix);
});

test("every devicesToOrder value produces the device keys it should", () => {
  const cases = [
    // Unconditional single-device branches.
    [{ devicesToOrder: ["ddso"] }, ["ddso"]],
    [{ devicesToOrder: ["dpro"] }, ["cadcam-d-pro"]],
    [{ devicesToOrder: ["shirazi"] }, ["shirazi-hybrid"]],
    [{ devicesToOrder: ["nightguards"] }, ["guard"]],
    [{ devicesToOrder: ["ortho"] }, ["ortho-expander"]],
    [{ devicesToOrder: ["sportguards"] }, ["sport-guard"]],
    [{ devicesToOrder: ["snorehook"] }, ["snorehook"]],

    // olmos: emits olmos-day and/or olmos-night depending on which OD/ON
    // sub-answers are present, and falls back to a bare olmos-day when
    // neither side was answered.
    [{ devicesToOrder: ["olmos"] }, ["olmos-day"]],
    [{ devicesToOrder: ["olmos"], odMaterial: "OD (PMT)" }, ["olmos-day"]],
    [{ devicesToOrder: ["olmos"], onDesign: "Positioner ON-P (Anterior)" }, ["olmos-night"]],
    [
      {
        devicesToOrder: ["olmos"],
        odMaterial: "OD (PMT)",
        onDesign: "Positioner ON-P (Anterior)",
      },
      ["olmos-day", "olmos-night"],
    ],

    // mistry: emits mora and/or ara only when those checkboxes are answered;
    // answering neither emits nothing (unlike olmos, there is no fallback).
    [{ devicesToOrder: ["mistry"] }, []],
    [{ devicesToOrder: ["mistry"], mora: ["MORA - Mandibular Repositioning Appliance"] }, ["mora"]],
    [{ devicesToOrder: ["mistry"], ara: ["ARA - Anterior Repositioning Appliance"] }, ["ara"]],
    [
      {
        devicesToOrder: ["mistry"],
        mora: ["MORA - Mandibular Repositioning Appliance"],
        ara: ["ARA - Anterior Repositioning Appliance"],
      },
      ["ara", "mora"],
    ],
  ];

  for (const [answers, expected] of cases) {
    const got = buildDigitalDevices(answers).map((d) => d.deviceKey).sort();
    assert.deepEqual(
      got,
      [...expected].sort(),
      `devicesToOrder ${JSON.stringify(answers.devicesToOrder)} answers=${JSON.stringify(answers)}`
    );
  }
});

test("a device's label comes from the shared DEVICE_LABELS entry", () => {
  const [device] = buildDigitalDevices({ devicesToOrder: ["ddso"] });
  assert.equal(device.label, "DDSO");
});
