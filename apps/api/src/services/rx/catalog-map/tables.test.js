import { test } from "vitest";
import assert from "node:assert/strict";
import { MODIFICATION_ROWS } from "./modifications.table.js";
import { ATTRIBUTE_ROWS } from "./attributes.table.js";

test("DDSO's six form modifications all resolve", () => {
  const expected = {
    "Tongue Positioners": "2330",
    "Hooks for Elastics": "2319",
    "Vertical Shims": "2302",
    "ON Loop": "2300",
    "BAB Loop": "2303",
    "ON Ramp": "2301",
  };
  for (const [literal, code] of Object.entries(expected)) {
    const row = MODIFICATION_ROWS.find((r) => r.match.includes(literal));
    assert.ok(row, `no row matches ${literal}`);
    assert.equal(row.code, code);
    assert.equal(row.status, "confirmed");
  }
});

// Every occlusal-contact / design-preference answer on the live Rx form, as
// worded in the JotForm evidence (pleaseSelect466/485/131, designPreference*).
// None of 2289/2291/2292/2293/2308/2314 appears on any of 3,600 real orders.
test("occlusal contact and design preference are note-only — never a line, never flagged", () => {
  for (const literal of [
    "Posterior Contact", "Anterior Contact", "FULL Occlusal Contact", "TRIPOD Occlusion",
    "Lingual-Free", "Buccal-Free", "Standard", "Full Coverage",
  ]) {
    const row = ATTRIBUTE_ROWS.find((r) => r.match.includes(literal));
    assert.ok(row, `no row matches ${literal}`);
    assert.equal(row.status, "none", `${literal} should be note-only`);
    assert.equal(row.code, null);
  }
});

test("open rows carry no code", () => {
  for (const r of [...MODIFICATION_ROWS, ...ATTRIBUTE_ROWS])
    if (r.status === "open") assert.equal(r.code, null);
});

test("none rows (deliberate no-op, not a gap) also carry no code", () => {
  for (const r of [...MODIFICATION_ROWS, ...ATTRIBUTE_ROWS])
    if (r.status === "none") assert.equal(r.code, null);
});
