import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveLineItems } from "./index.js";

test("DDSO NYLON from the Rx form resolves to 2608", () => {
  const { items, unmapped } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } });
  assert.equal(unmapped.length, 0);
  assert.equal(items[0].code, "2608");
  assert.equal(items[0].mapKey, "primary:ddso:nylon");
});

test("the older wizard's 'Nylon' resolves to the same row", () => {
  const { items } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } });
  assert.equal(items[0].code, "2608");
});

test("modifications and design attributes both become line items", () => {
  const { items } = resolveLineItems({
    deviceKey: "ddso",
    deviceOptions: { baseMaterial: "NYLON", modifications: ["Tongue Positioners"], occlusalContact: "Anterior Contact", designPreference: "Lingual-Free" },
  });
  const codes = items.map((i) => i.code).sort();
  assert.deepEqual(codes, ["2289", "2314", "2330", "2608"]);
});

test("an open row never emits and is always flagged", () => {
  const { items, unmapped } = resolveLineItems({
    deviceKey: "olmos-night",
    deviceOptions: { variant: "DEPROGRAMMER (ON-D) - Anterior Occlusion" },
  });
  assert.equal(items.length, 0);
  assert.ok(unmapped.includes("primary:olmos-night:ond"));
});

test("a DB override wins over the table", () => {
  const overrides = { "primary:ddso:nylon": { code: "9999", name: "Custom" } };
  const { items } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } }, { overrides });
  assert.equal(items[0].code, "9999");
  assert.equal(items[0].overridden, true);
});

test("an unknown modification is flagged, never guessed", () => {
  const { unmapped } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON", modifications: ["__nope__"] } });
  assert.ok(unmapped.some((u) => u.includes("__nope__")));
});

test("an override cannot collapse a two-arch guard order into one line", () => {
  const overrides = { "guard:occlusal-guard-slider-type": { code: "9999", name: "Custom" } };
  const { items, unmapped } = resolveLineItems(
    { deviceKey: "guard", deviceOptions: { standardGuards: { "Occlusal Guard - Slider Type": { "UPPER ARCH": true, "LOWER ARCH": true, "Base Material": "Nylon (Printed)" } } } },
    { overrides }
  );
  assert.equal(items.length, 0);
  assert.deepEqual(unmapped, ["guard:occlusal-guard-slider-type"]);
});

test("a 'none' attribute emits no line item and no unmapped flag", () => {
  const { items, unmapped } = resolveLineItems({
    deviceKey: "ddso",
    deviceOptions: { baseMaterial: "NYLON", designPreference: "Standard" },
  });
  assert.deepEqual(items.map((i) => i.code), ["2608"]);
  assert.equal(unmapped.length, 0);
});

test("a noteOnly override emits a non-product line, never a phantom confirmed code", () => {
  // mod:wrap-distal is a real open row (code: null) — exactly the case an
  // admin resolves permanently with scope: "always" + noteOnly: true.
  const overrides = { "mod:wrap-distal": { code: null, name: null, noteOnly: true } };
  const { items, unmapped } = resolveLineItems(
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON", modifications: ["Wrap Distal"] } },
    { overrides }
  );
  assert.equal(unmapped.length, 0, "a resolved noteOnly ruling must not still read as unmapped");
  const wrap = items.find((i) => i.mapKey === "mod:wrap-distal");
  assert.ok(wrap, "expected a line for the noteOnly-overridden modification");
  assert.equal(wrap.noteOnly, true);
  assert.equal(wrap.code, null, "a noteOnly ruling must never invent a code");
});

test("a code-less override that is NOT noteOnly is incoherent and falls back to unmapped", () => {
  // A confirmed mapping to nothing is not a valid state — it must not slip
  // through as a phantom "confirmed" line with no product on it.
  const overrides = { "mod:wrap-distal": { code: null, name: null, noteOnly: false } };
  const { items, unmapped } = resolveLineItems(
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON", modifications: ["Wrap Distal"] } },
    { overrides }
  );
  assert.ok(unmapped.includes("mod:wrap-distal"));
  assert.ok(!items.some((i) => i.mapKey === "mod:wrap-distal"));
});
