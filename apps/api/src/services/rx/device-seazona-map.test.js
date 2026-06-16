import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLineItems } from "./device-seazona-map.js";

test("DDSO Nylon resolves to the DDSO Nylon primary line", () => {
  const { items, unmapped } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } });
  assert.ok(items.some((i) => /DDSO Nylon/i.test(i.name)));
  assert.equal(unmapped.length, 0);
});
test("an unmapped modification is flagged, never guessed", () => {
  const { unmapped } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon", modifications: ["__nope__"] } });
  assert.ok(unmapped.includes("modifications:__nope__"));
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
