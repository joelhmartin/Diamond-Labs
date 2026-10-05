import { test } from "vitest";
import assert from "node:assert/strict";
import { buildDigitalDevices, buildFormDevices } from "./form-devices.js";

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
    // Legacy: ortho was a digital-form device Aug–Oct 2026.
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

test("Olmos Night carries design, material, modifications and instructions", () => {
  const [night] = buildDigitalDevices({
    devicesToOrder: ["olmos"],
    onDesign: "POSITIONER (ON-P) - Anterior Occlusion",
    onMaterial: "PMT (Diamoform)",
    onModifications: ["Vertical Shims"],
    onSpecifications: ["Upper arch ONLY (No opposing trutaine)"],
  });
  assert.equal(night.deviceKey, "olmos-night");
  assert.equal(night.deviceOptions.baseMaterial, "PMT (Diamoform)");
  assert.deepEqual(night.deviceOptions.modifications, ["Vertical Shims"]);
  assert.deepEqual(night.deviceOptions.instructions, ["Upper arch ONLY (No opposing trutaine)"]);
});

test("D-Pro carries the D-Pro/Manta choice; additional options are instructions, not products", () => {
  const [dpro] = buildDigitalDevices({ devicesToOrder: ["dpro"], dproDevice: "Manta", dproAdditionalOptions: ["Wrap distal of last molars"] });
  assert.equal(dpro.deviceOptions.variant, "Manta");
  assert.deepEqual(dpro.deviceOptions.instructions, ["Wrap distal of last molars"]);
  assert.equal(dpro.deviceOptions.modifications, undefined);
});

test("the ortho form always yields exactly one ortho appliance, even unanswered", () => {
  const devices = buildFormDevices("ortho", {});
  assert.deepEqual(devices.map((d) => d.deviceKey), ["ortho-expander"]);
});

test("the ortho form ignores digital-form device picks", () => {
  const devices = buildFormDevices("ortho", { devicesToOrder: ["ddso"], selectDevice: "Twin Block" });
  assert.deepEqual(devices.map((d) => d.deviceKey), ["ortho-expander"]);
  assert.equal(devices[0].deviceOptions.applianceType, "Twin Block");
});

test("the digital form type still routes through buildDigitalDevices", () => {
  assert.deepEqual(buildFormDevices("digital", { devicesToOrder: ["ddso"] }).map((d) => d.deviceKey), ["ddso"]);
});

test("ortho answers survive the adapter, add-ons kept per arch and de-duplicated", () => {
  const [device] = buildFormDevices("ortho", {
    selectDevice: "Modified Tandem",
    upperArchRetention: "Fixed (Banded)",
    upperExpansionType: 'Slim-line "Variety-Click" (Fixed ONLY)',
    lowerArchRetention: "Acrylic w/ clasp retention",
    lowerExpansionType: 'Slim-line "Variety-Click"',
    fixedMandibularExpansion: ["Mandibular E-Arch"],
    requiredSelection: { "Maxillary__Place bands on:": "6's" },
    tandemBowSetting: "3",
    addToMaxillary: ["Buccal hooks for tandem elastics", "Buccal tubes to bands"],
    maxillaryAdd: ["Buccal tubes to bands", "Palatal pads"],
    addToMandibular: ["Sheaths for Tandem Bow (Removable)"],
    digitalStudyModels: "Digital Models ONLY - ABO - Full Base",
    digitalSetupEmail: "setup@example.test",
    dualArchComments: "a",
    orthoDesignComments: "b",
  });
  const o = device.deviceOptions;
  assert.equal(o.applianceType, "Modified Tandem");
  assert.equal(o.upperArchRetention, "Fixed (Banded)");
  assert.equal(o.lowerExpansionType, 'Slim-line "Variety-Click"');
  assert.deepEqual(o.fixedMandibularExpansion, ["Mandibular E-Arch"]);
  assert.deepEqual(o.requiredSelection, { "Maxillary__Place bands on:": "6's" });
  assert.equal(o.tandemBowSetting, "3");
  assert.deepEqual(o.upperAddOns, ["Buccal hooks for tandem elastics", "Buccal tubes to bands", "Palatal pads"]);
  assert.deepEqual(o.lowerAddOns, ["Sheaths for Tandem Bow (Removable)"]);
  assert.equal(o.digitalStudyModels, "Digital Models ONLY - ABO - Full Base");
  assert.equal(o.digitalSetupEmail, "setup@example.test");
  assert.equal(o.comments, "a | b");
  assert.equal(o.modifications, undefined, "ortho add-ons must not pool into arch-less modifications");
});
