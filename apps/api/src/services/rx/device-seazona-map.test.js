import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveLineItems } from "./device-seazona-map.js";

test("DDSO Nylon resolves to the DDSO Nylon primary line", () => {
  const { items, unmapped } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } });
  assert.ok(items.some((i) => /DDSO Nylon/i.test(i.name)));
  assert.equal(unmapped.length, 0);
});
test("an unmapped modification is flagged, never guessed", () => {
  const { unmapped } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon", modifications: ["__nope__"] } });
  assert.ok(unmapped.includes("mod:__nope__"));
});
test("resolveLineItems attaches a mapKey to each item", () => {
  const { items } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } });
  assert.equal(items[0].mapKey, "primary:ddso:Nylon");
});
test("an override resolves a previously-unmapped line (override wins)", () => {
  const overrides = { "mod:__nope__": { code: "9999", name: "Custom Mod" } };
  const { items, unmapped } = resolveLineItems(
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon", modifications: ["__nope__"] } },
    { overrides });
  assert.ok(items.some((i) => i.code === "9999" && i.mapKey === "mod:__nope__"));
  assert.ok(!unmapped.includes("mod:__nope__"));
});
test("override replaces a file-default primary code", () => {
  const overrides = { "primary:ddso:Nylon": { code: "1234", name: "Override DDSO" } };
  const { items } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } }, { overrides });
  assert.equal(items.find((i) => i.mapKey === "primary:ddso:Nylon").code, "1234");
});
test("unknown device is flagged", () => {
  const { items, unmapped } = resolveLineItems({ deviceKey: "__missing__", deviceOptions: {} });
  assert.equal(items.length, 0);
  assert.ok(unmapped.includes("device:__missing__"));
});
test("guard carries the selected arch through to the item", () => {
  const { items } = resolveLineItems({ deviceKey: "guard", deviceOptions: { baseMaterial: "Hard Nightguard", arch: "Upper" } });
  assert.ok(items.some((i) => i.arch === "Upper"));
});
test("a default-only device (mora) resolves its primary without a material", () => {
  const { items, unmapped } = resolveLineItems({ deviceKey: "mora", deviceOptions: {} });
  assert.ok(items.length >= 1);
  assert.equal(unmapped.filter((u) => u.startsWith("primary:")).length, 0);
});

test("override items carry overridden:true; file-default items do not", () => {
  const overrides = { "primary:ddso:Nylon": { code: "1234", name: "Override DDSO" } };
  const ov = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } }, { overrides });
  assert.equal(ov.items.find((i) => i.mapKey === "primary:ddso:Nylon").overridden, true);
  const plain = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } });
  assert.ok(!plain.items.find((i) => i.mapKey === "primary:ddso:Nylon").overridden);
});
