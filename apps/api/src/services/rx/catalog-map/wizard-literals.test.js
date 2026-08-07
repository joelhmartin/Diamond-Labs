/**
 * Cross-package coverage test for the OLDER wizard at /app/cases/new.
 *
 * That wizard is live, publicly linked, and is the only producer that populates
 * rx_cases.deviceKey / rx_cases.deviceOptions — so its option wording, not just
 * the consolidated form's, has to resolve here. Literals are read from
 * apps/web/src/data/rx-devices.js rather than restated, so re-wording an option
 * there fails HERE instead of quietly failing the ok gate on every order.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveLineItems } from "./index.js";
import { RX_DEVICES } from "../../../../../web/src/data/rx-devices.js";

/** Every distinct option literal the wizard offers for `optionKey`. */
function wizardLiterals(optionKey) {
  const out = new Set();
  for (const device of RX_DEVICES) {
    const field = device.options?.[optionKey];
    for (const o of field?.options || []) out.add(typeof o === "string" ? o : o.value);
  }
  return [...out];
}

/** Resolve one selection against a device whose primary line always resolves. */
const resolve = (deviceOptions) =>
  resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon", ...deviceOptions } });

test("every wizard occlusal-contact literal resolves to an attribute row", () => {
  const literals = wizardLiterals("occlusalContact");
  assert.ok(literals.length >= 4, `expected the wizard to still offer occlusal contacts, got ${literals}`);
  for (const occlusalContact of literals) {
    const { unmapped } = resolve({ occlusalContact });
    assert.deepEqual(unmapped, [], `wizard occlusal contact "${occlusalContact}" is unmapped`);
  }
});

test("every wizard design-preference literal resolves (or is a deliberate no-op)", () => {
  for (const designPreference of wizardLiterals("designPreference")) {
    const { unmapped } = resolve({ designPreference });
    // "Full Coverage" is a real open decision for the lab — it must stay flagged.
    if (designPreference === "Full Coverage") {
      assert.deepEqual(unmapped, ["attr:design:full-coverage"]);
      continue;
    }
    assert.deepEqual(unmapped, [], `wizard design preference "${designPreference}" is unmapped`);
  }
});

test("the wizard modification literals with a real catalog product resolve", () => {
  for (const [literal, code] of Object.entries({
    "Labial bow": "2184",
    "Buccal tubes to bands": "2307",
  })) {
    const { items, unmapped } = resolve({ modifications: [literal] });
    assert.deepEqual(unmapped, [], `"${literal}" should resolve`);
    assert.ok(items.some((i) => i.code === code), `"${literal}" did not resolve to ${code}`);
  }
});

/**
 * The rest have NO catalog equivalent and must stay flagged rather than resolve
 * to a guess. This list is the inventory the lab still has to rule on — it is
 * asserted exactly so that adding a wizard option, or inventing a mapping for
 * one of these, has to be a deliberate edit here.
 */
test("wizard modifications with no catalog equivalent stay unmapped, never guessed", () => {
  const unresolved = wizardLiterals("modifications")
    .filter((m) => resolve({ modifications: [m] }).unmapped.length > 0)
    .sort();
  assert.deepEqual(unresolved, [
    "Anterior lap springs",
    "Anterior ramp",
    "Anterior ring (positioner)",
    "Buccal hooks for tandem elastics",
    "CPAP-Pro coupler",
    "Finger Springs",
    "Lingual bar",
    "Lingual guide arm (distal)",
    "Lingual guide arm to canines",
    "Lingual ramp",
    "Occlusal Rest(s)",
    "Occlusal pad",
    "Opposing Trutaine only",
    "Other",
    "Palatal pads",
    "Posterior pads",
    "Relief over bony prominences",
    "Sheaths for Tandem Bow",
    "Soft liner",
    "Tongue space",
    "Transfer tray for composite buttons",
    "Trim to gumline",
    "Trim to occlusal plane",
  ]);
});

test("every wizard base-material literal resolves to a device row", () => {
  for (const device of RX_DEVICES) {
    const literals = (device.options?.baseMaterial?.options || []).map((o) => (typeof o === "string" ? o : o.value));
    for (const baseMaterial of literals) {
      const { items, unmapped } = resolveLineItems({ deviceKey: device.key, deviceOptions: { baseMaterial } });
      assert.ok(
        items.length > 0 && unmapped.length === 0,
        `wizard ${device.key} base material "${baseMaterial}" does not resolve`
      );
    }
  }
});
