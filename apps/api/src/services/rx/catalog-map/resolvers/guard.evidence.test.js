/**
 * Guard resolution checked against what the lab actually billed.
 *
 * Each case is a JotForm answer → the product on the matched Seazona orders
 * (15,808 prescriptions matched to their orders, 2025–26; n = matched orders,
 * % = share of them carrying that product). A failure here means the resolver
 * disagrees with the lab's own history, not with a guess.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveGuard, nestGuardMatrix, guardMatrixNotes } from "./guard.js";

const MATRIX_EVIDENCE = [
  // [row, Base Material, expected code, evidence]
  ["Nightguard - Full Occlusion", "Acrylic w/clasps", "2164", "3/3 orders billed 2164 PMT"],
  ["Nightguard - Full Occlusion", "PMT (Diamoform)", "2164", "88%, n=25"],
  ["Nightguard - Full Occlusion", "BIOMED (Printed)", "2165", "62%, n=13"],
  ["Occlusal Guard - Slider Type", "Nylon (Printed)", "2176", "95%, n=43"],
  ["Occlusal Guard - Slider Type", "BIOMED (Printed)", "2175", "4/4"],
  ["Occlusal Guard - NTI Type", "Nylon (Printed)", "2176", "84%, n=44"],
  ["Michigan Splint - Anterior Guidance", "Nylon (Printed)", "2170", "6/6"],
  ["Michigan Splint - Anterior Guidance", "BIOMED (Printed)", "2169", "2/2"],
];

test("each matrix row + material resolves to the product real orders carried", () => {
  for (const [row, material, code, why] of MATRIX_EVIDENCE) {
    const { items, unmapped } = resolveGuard({
      standardGuards: { [row]: { "UPPER ARCH": true, "Base Material": material } },
    });
    assert.deepEqual(unmapped, [], `${row} + ${material}`);
    assert.equal(items.length, 1, `${row} + ${material}`);
    assert.equal(items[0].code, code, `${row} + ${material} (${why})`);
    assert.equal(items[0].status, "confirmed");
  }
});

const PICKER_EVIDENCE = [
  // [picker render, expected code, status, evidence]
  ["Dual Arch - FLATPLANE", "2163", "proposed", "77%, n=43"],
  ["Dual Arch - SLIDER", "2176", "proposed", "84%, n=73"],
];

test("each picker render alone resolves to the product real orders carried", () => {
  for (const [variant, code, status, why] of PICKER_EVIDENCE) {
    const { items, unmapped } = resolveGuard({ variant });
    assert.deepEqual(unmapped, [], variant);
    assert.equal(items.length, 1, variant);
    assert.equal(items[0].code, code, `${variant} (${why})`);
    assert.equal(items[0].status, status);
  }
});

test("a dual-arch appliance is ONE line however many arches are ticked", () => {
  // 2176 sat on 70/70 real orders as a single line; 2163 on 35/35.
  const { items } = resolveGuard({
    standardGuards: {
      "Occlusal Guard - Slider Type": { "UPPER ARCH": true, "LOWER ARCH": true, "Base Material": "Nylon (Printed)" },
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].code, "2176");
  assert.equal(items[0].arch, null);
});

test("a dual-arch row with a material but no arch ticked still orders the appliance", () => {
  const { items, unmapped } = resolveGuard({
    standardGuards: { "Occlusal Guard - Slider Type": { "Base Material": "Nylon (Printed)" } },
  });
  assert.deepEqual(unmapped, []);
  assert.deepEqual(items.map((i) => i.code), ["2176"]);
});

test("a per-arch row answered with no arch is held, never dropped or guessed", () => {
  const { items, unmapped } = resolveGuard({
    standardGuards: { "Michigan Splint - Anterior Guidance": { "Base Material": "Nylon (Printed)" } },
  });
  assert.equal(items.length, 0);
  assert.deepEqual(unmapped, ["guard:michigan-splint-anterior-guidance:no-arch"]);
});

/* ── picker + matrix: one appliance answered twice is billed once ────────── */

test("SLIDER picker + Slider Type row → one line, from the row's material", () => {
  const { items, unmapped } = resolveGuard({
    variant: ["Dual Arch - SLIDER"],
    standardGuards: {
      "Occlusal Guard - Slider Type": { "UPPER ARCH": true, "LOWER ARCH": true, "Base Material": "BIOMED (Printed)" },
    },
  });
  assert.deepEqual(unmapped, []);
  assert.deepEqual(items.map((i) => i.code), ["2175"]);
});

test("SLIDER picker + NTI Type row → one line (the same NTI Slider-Type product)", () => {
  const { items } = resolveGuard({
    variant: "Dual Arch - SLIDER",
    standardGuards: { "Occlusal Guard - NTI Type": { "LOWER ARCH": true, "Base Material": "Nylon (Printed)" } },
  });
  assert.deepEqual(items.map((i) => i.code), ["2176"]);
});

test("single-arch picker + Full Occlusion row → the row's line only, not held", () => {
  const { items, unmapped } = resolveGuard({
    variant: "Single Arch - NIGHTGUARD",
    standardGuards: { "Nightguard - Full Occlusion": { "UPPER ARCH": true, "Base Material": "Nylon (Printed)" } },
  });
  assert.deepEqual(unmapped, []);
  assert.deepEqual(items.map((i) => i.code), ["2166"]);
});

test("FLATPLANE picker + Full Occlusion row → one FLATPLANE line in the row's material", () => {
  // Full Occlusion rows answered Nylon billed FLATPLANE 2163 on 50% of orders
  // (n=62); FLATPLANE and a single-arch nightguard shared an order once in 3,600.
  for (const [material, code] of [["Nylon (Printed)", "2163"], ["BIOMED (Printed)", "2162"]]) {
    const { items, unmapped } = resolveGuard({
      variant: "Dual Arch - FLATPLANE",
      standardGuards: {
        "Nightguard - Full Occlusion": { "UPPER ARCH": true, "LOWER ARCH": true, "Base Material": material },
      },
    });
    assert.deepEqual(unmapped, [], material);
    assert.deepEqual(items.map((i) => i.code), [code], material);
    assert.equal(items[0].status, "confirmed");
  }
});

test("FLATPLANE picker + a row material FLATPLANE is not made in is held", () => {
  const { items, unmapped } = resolveGuard({
    variant: "Dual Arch - FLATPLANE",
    standardGuards: { "Nightguard - Full Occlusion": { "UPPER ARCH": true, "Base Material": "PMT (Diamoform)" } },
  });
  assert.equal(items.length, 0);
  assert.deepEqual(unmapped, ["guard:dual-arch-flatplane:pmt-diamoform"]);
});

test("a picker for a DIFFERENT appliance than the matrix row still bills both", () => {
  const { items } = resolveGuard({
    variant: "Dual Arch - SLIDER",
    standardGuards: { "Essix Tray": { "UPPER ARCH": true } },
  });
  assert.deepEqual(items.map((i) => i.code).sort(), ["2161", "2176"]);
});

/* ── the live form's matrix shape ───────────────────────────────────────── */

test("the live form's flat `row__column` cells resolve like nested ones", () => {
  // MatrixField (apps/web/src/components/rx/fields.jsx) stores free text per cell.
  const flat = {
    "Nightguard - Full Occlusion__UPPER ARCH": "x",
    "Nightguard - Full Occlusion__Base Material": "nylon",
    "Essix Tray__LOWER ARCH": "yes",
  };
  const { items, unmapped } = resolveGuard({ standardGuards: flat });
  assert.deepEqual(unmapped, []);
  assert.deepEqual(
    items.map((i) => [i.code, i.arch]).sort(),
    [["2161", "lower"], ["2166", "upper"]]
  );
});

test("free-text materials match the known literals exactly, never fuzzily", () => {
  const code = (m) => resolveGuard({ standardGuards: { "Nightguard - Full Occlusion": { "UPPER ARCH": "x", "Base Material": m } } });
  assert.equal(code("PMT").items[0].code, "2164");
  assert.equal(code("biomed (printed)").items[0].code, "2165");
  assert.equal(code("Dual-Laminate").items[0].code, "2167");
  assert.deepEqual(code("soft").unmapped, ["guard:nightguard-full-occlusion:soft"]);
});

test("an arch cell that plainly says no is not an order for that arch", () => {
  const { items } = resolveGuard({
    standardGuards: { "Essix Tray__UPPER ARCH": "x", "Essix Tray__LOWER ARCH": "no" },
  });
  assert.deepEqual(items.map((i) => i.arch), ["upper"]);
});

test("nestGuardMatrix accepts both shapes", () => {
  assert.deepEqual(nestGuardMatrix({ "A__UPPER ARCH": "x", "A__Color:": "white" }), { A: { "UPPER ARCH": "x", "Color:": "white" } });
  assert.deepEqual(nestGuardMatrix({ A: { "UPPER ARCH": true } }), { A: { "UPPER ARCH": true } });
  assert.deepEqual(nestGuardMatrix(undefined), {});
});

test("clearance, teeth and colour reach the notes (follow-up 1)", () => {
  const notes = guardMatrixNotes({
    "Occlusal Guard - Slider Type__UPPER ARCH": "x",
    "Occlusal Guard - Slider Type__Increase for clearance": "2mm",
    "Occlusal Guard - Slider Type__Only Cover teeth #'s:": "5-12",
    "Nightguard - Full Occlusion__Color:": "white",
  });
  assert.deepEqual(notes, [
    "Occlusal Guard - Slider Type: Increase for clearance: 2mm; Only Cover teeth #'s: 5-12",
    "Nightguard - Full Occlusion: Color: white",
  ]);
});
