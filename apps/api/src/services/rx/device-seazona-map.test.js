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
