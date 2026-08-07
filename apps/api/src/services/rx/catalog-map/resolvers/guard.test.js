import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveGuard } from "./guard.js";

test("a full-occlusion nightguard in Nylon on the upper arch resolves to 2166", () => {
  const { items, unmapped } = resolveGuard({
    standardGuards: {
      "Nightguard - Full Occlusion": { "UPPER ARCH": true, "Base Material": "Nylon (Printed)" },
    },
  });
  assert.equal(unmapped.length, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].code, "2166");
  assert.equal(items[0].arch, "upper");
});

test("upper and lower selected on one row emit two lines", () => {
  const { items } = resolveGuard({
    standardGuards: {
      "Michigan Splint - Anterior Guidance": { "UPPER ARCH": true, "LOWER ARCH": true, "Base Material": "BIOMED (Printed)" },
    },
  });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.arch).sort(), ["lower", "upper"]);
  assert.ok(items.every((i) => i.code === "2169"));
});

test("Essix and Bleaching ignore base material", () => {
  const { items } = resolveGuard({
    standardGuards: { "Essix Tray": { "UPPER ARCH": true }, "Bleaching Trays": { "LOWER ARCH": true } },
  });
  assert.deepEqual(items.map((i) => i.code).sort(), ["2155", "2161"]);
});

test("a row with no base material where one is required is flagged, never guessed", () => {
  const { items, unmapped } = resolveGuard({
    standardGuards: { "Nightguard - Full Occlusion": { "UPPER ARCH": true } },
  });
  assert.equal(items.length, 0);
  assert.ok(unmapped.some((u) => u.includes("nightguard-full-occlusion")));
});

test("Slider Type is ambiguous and never guesses between NTI and FLATPLANE", () => {
  const { items, unmapped } = resolveGuard({
    standardGuards: { "Occlusal Guard - Slider Type": { "UPPER ARCH": true, "Base Material": "Nylon (Printed)" } },
  });
  assert.equal(items.length, 0);
  assert.ok(unmapped.some((u) => u.includes("slider-type")));
});

test("unmapped entries are bare mapKeys the override layer can key on", () => {
  const { unmapped } = resolveGuard({
    standardGuards: { "Occlusal Guard - Slider Type": { "UPPER ARCH": true, "Base Material": "Nylon (Printed)" } },
  });
  assert.deepEqual(unmapped, ["guard:occlusal-guard-slider-type"]);
});

test("a material-agnostic row keys on 'any' whatever material was submitted", () => {
  const keyFor = (cells) => resolveGuard({ standardGuards: { "Essix Tray": cells } }).items[0].mapKey;
  assert.equal(keyFor({ "UPPER ARCH": true }), "guard:essix-tray:any");
  assert.equal(keyFor({ "UPPER ARCH": true, "Base Material": "Nylon (Printed)" }), "guard:essix-tray:any");
  assert.equal(keyFor({ "UPPER ARCH": true, "Base Material": "PMT (Diamoform)" }), "guard:essix-tray:any");
});

test("a material-keyed row still carries its material in the mapKey", () => {
  const { items } = resolveGuard({
    standardGuards: { "Nightguard - Full Occlusion": { "UPPER ARCH": true, "Base Material": "Nylon (Printed)" } },
  });
  assert.equal(items[0].mapKey, "guard:nightguard-full-occlusion:nylon-printed");
  assert.equal(items[0].code, "2166");
});

/* ── the "Select Device:" picker (nightguardDevice → variant) ───────────────
   Regression: the resolver used to read ONLY standardGuards, so a picker
   selection produced items:[] unmapped:[] — a doctor's choice vanishing with
   nothing flagged. */

test("a device-picker variant is never silently dropped", () => {
  const { items, unmapped } = resolveGuard({ variant: "Dual Arch - FLATPLANE" });
  assert.ok(items.length > 0 || unmapped.length > 0, "picker selection produced nothing at all");
});

test("a picker variant that names a matrix row resolves exactly like that row", () => {
  const picked = resolveGuard({ variant: "Dual Arch - FLATPLANE", baseMaterial: "Nylon (Printed)" });
  assert.equal(picked.unmapped.length, 0);
  assert.equal(picked.items.length, 1);
  assert.equal(picked.items[0].code, "2163");
  assert.equal(picked.items[0].mapKey, "guard:dual-arch-flatplane:nylon-printed");
});

test("a picker variant with no material is flagged, never guessed", () => {
  const { items, unmapped } = resolveGuard({ variant: "Dual Arch - FLATPLANE" });
  assert.equal(items.length, 0);
  assert.deepEqual(unmapped, ["guard:dual-arch-flatplane:no-material"]);
});

test("a picker variant with no catalog row at all lands in unmapped as a bare mapKey", () => {
  assert.deepEqual(resolveGuard({ variant: "Dual Arch - SLIDER" }).unmapped, ["guard:dual-arch-slider"]);
  assert.deepEqual(resolveGuard({ variant: "Single Arch - NIGHTGUARD" }).unmapped, ["guard:single-arch-nightguard"]);
});

test("an unrecognised wizard device literal is flagged rather than dropped", () => {
  // The older wizard's guard picker offers wording of its own ("Hard Nightguard"…).
  assert.deepEqual(resolveGuard({ variant: "Hard Nightguard" }).unmapped, ["guard:hard-nightguard"]);
});

test("a wizard baseMaterial alone is treated as the appliance signal", () => {
  const { items, unmapped } = resolveGuard({ baseMaterial: "Essix Tray" });
  assert.equal(unmapped.length, 0);
  assert.equal(items[0].mapKey, "guard:essix-tray:any");
});

test("every checked picker render is resolved, not just the first", () => {
  const { unmapped } = resolveGuard({ variant: ["Dual Arch - SLIDER", "Single Arch - NIGHTGUARD"] });
  assert.deepEqual(unmapped.sort(), ["guard:dual-arch-slider", "guard:single-arch-nightguard"]);
});

test("a picker choice duplicating an ordered matrix row does not double the order", () => {
  const { items } = resolveGuard({
    variant: "Essix Tray",
    standardGuards: { "Essix Tray": { "UPPER ARCH": true } },
  });
  assert.equal(items.length, 1);
});
