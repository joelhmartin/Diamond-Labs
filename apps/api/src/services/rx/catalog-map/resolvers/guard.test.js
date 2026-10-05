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

test("a row with no base material and no ruling for that is flagged, never guessed", () => {
  // NTI Type has no no-material ruling (one replayed order with it billed a
  // single-arch nightguard instead), so it still holds.
  const { items, unmapped } = resolveGuard({
    standardGuards: { "Occlusal Guard - NTI Type": { "UPPER ARCH": true } },
  });
  assert.equal(items.length, 0);
  assert.deepEqual(unmapped, ["guard:occlusal-guard-nti-type:no-material"]);
});

test("unmapped entries are bare mapKeys the override layer can key on", () => {
  const { unmapped } = resolveGuard({
    standardGuards: { "Nightguard - Full Occlusion": { "UPPER ARCH": true, "Base Material": "Lab Decision" } },
  });
  assert.deepEqual(unmapped, ["guard:nightguard-full-occlusion:lab-decision"]);
});

// No material written in → the lab's printed default, Nylon (proposed).
// [row, arches, expected codes, evidence]
const NO_MATERIAL_EVIDENCE = [
  ["Nightguard - Full Occlusion", { "UPPER ARCH": true }, ["2166"], "'Lab Decision' 2166 75% (n=4); replay 5 of 5"],
  ["Nightguard - Full Occlusion", { "UPPER ARCH": true, "LOWER ARCH": true }, ["2166", "2166"], "per arch, as with any material"],
  ["Occlusal Guard - Slider Type", { "UPPER ARCH": true }, ["2176"], "Slider rows 2176 83–89% (n=47/55)"],
  ["Michigan Splint - Anterior Guidance", { "UPPER ARCH": true }, ["2170"], "Michigan row 2170 80% (n=20)"],
];
for (const [row, cells, codes, why] of NO_MATERIAL_EVIDENCE)
  test(`no material: ${row} → ${codes.join(" + ")} (${why})`, () => {
    const { items, unmapped } = resolveGuard({ standardGuards: { [row]: cells } });
    assert.deepEqual(unmapped, []);
    assert.deepEqual(items.map((i) => i.code), codes);
    assert.ok(items.every((i) => i.status === "proposed" && i.mapKey.endsWith(":no-material")));
  });

test("one dual-arch appliance described on two rows is one line (NTI upper + Slider lower)", () => {
  const { items, unmapped } = resolveGuard({
    variant: ["Dual Arch - SLIDER"],
    standardGuards: {
      "Occlusal Guard - NTI Type": { "UPPER ARCH": true, "Base Material": "Nylon (Printed)" },
      "Occlusal Guard - Slider Type": { "LOWER ARCH": true, "Base Material": "Nylon (Printed)" },
    },
  });
  assert.deepEqual(unmapped, []);
  assert.deepEqual(items.map((i) => i.code), ["2176"]);
});

test("two different dual-arch appliances still bill one line each", () => {
  const { items } = resolveGuard({
    standardGuards: {
      "Occlusal Guard - NTI Type": { "UPPER ARCH": true, "Base Material": "BIOMED (Printed)" },
      "Occlusal Guard - Slider Type": { "LOWER ARCH": true, "Base Material": "Nylon (Printed)" },
    },
  });
  assert.deepEqual(items.map((i) => i.code), ["2175", "2176"]);
});

test("a Michigan row with the single-arch picker is one appliance, one line", () => {
  const { items, unmapped } = resolveGuard({
    variant: ["Single Arch - NIGHTGUARD"],
    standardGuards: { "Michigan Splint - Anterior Guidance": { "UPPER ARCH": true } },
  });
  assert.deepEqual(unmapped, []);
  assert.deepEqual(items.map((i) => [i.code, i.arch]), [["2170", "upper"]]);
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

test("a picker variant with no material proposes the product real orders used", () => {
  // FLATPLANE picker alone: 2163 on 77% of real orders (n=43).
  const { items, unmapped } = resolveGuard({ variant: "Dual Arch - FLATPLANE" });
  assert.deepEqual(unmapped, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].code, "2163");
  assert.equal(items[0].status, "proposed");
  assert.equal(items[0].mapKey, "guard:dual-arch-flatplane:no-material");
});

test("the single-arch picker alone stays open — real orders split three ways", () => {
  // 2166 40% / 2164 24% / 2170 14% (n=105): nothing to propose.
  const { items, unmapped } = resolveGuard({ variant: "Single Arch - NIGHTGUARD" });
  assert.equal(items.length, 0);
  assert.deepEqual(unmapped, ["guard:single-arch-nightguard"]);
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
  const { items, unmapped } = resolveGuard({ variant: ["Dual Arch - SLIDER", "Single Arch - NIGHTGUARD"] });
  assert.deepEqual(items.map((i) => i.code), ["2176"]);
  assert.deepEqual(unmapped, ["guard:single-arch-nightguard"]);
});

test("a picker choice duplicating an ordered matrix row does not double the order", () => {
  const { items } = resolveGuard({
    variant: "Essix Tray",
    standardGuards: { "Essix Tray": { "UPPER ARCH": true } },
  });
  assert.equal(items.length, 1);
});
