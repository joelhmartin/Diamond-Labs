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
