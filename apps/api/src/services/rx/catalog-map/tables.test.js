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

test("occlusal contact and design preference map to the $0 catalog items", () => {
  const expected = {
    "Posterior Contact": "2293",
    "Anterior Contact": "2289",
    "FULL Occlusal Contact": "2292",
    "TRIPOD Occlusion": "2291",
    "Lingual-Free": "2314",
    "Buccal-Free": "2308",
  };
  for (const [literal, code] of Object.entries(expected)) {
    const row = ATTRIBUTE_ROWS.find((r) => r.match.includes(literal));
    assert.ok(row, `no row matches ${literal}`);
    assert.equal(row.code, code);
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
