import { test } from "vitest";
import assert from "node:assert/strict";
import { diffOrderLines } from "./order-diff.js";

test("diff reports matched, missing, and extra by product name", () => {
  const generated = [{ name: "DDSO Nylon" }, { name: "Digital Model Fabrication (Per Arch)" }];
  const real = [{ name: "DDSO Nylon" }, { name: "Articulate Models (Per Arch)" }];
  const d = diffOrderLines(generated, real);
  assert.deepEqual(d.matched, ["DDSO Nylon"]);
  assert.deepEqual(d.missingFromOurs, ["Articulate Models (Per Arch)"]);
  assert.deepEqual(d.extraInOurs, ["Digital Model Fabrication (Per Arch)"]);
});
test("matching is case- and whitespace-insensitive", () => {
  const d = diffOrderLines([{ name: "ddso   nylon" }], [{ name: "DDSO Nylon" }]);
  assert.deepEqual(d.matched, ["ddso   nylon"]);
  assert.equal(d.missingFromOurs.length, 0);
});
test("handles empty inputs", () => {
  const d = diffOrderLines([], []);
  assert.deepEqual(d, { matched: [], missingFromOurs: [], extraInOurs: [] });
});
test("skips null and {} items without throwing", () => {
  // Real Seazona order data can include {name:null} or bare {} rows.
  const generated = [{ name: "DDSO Nylon" }, null, {}];
  const real = [{ name: "DDSO Nylon" }, { name: null }, null];
  const d = diffOrderLines(generated, real);
  // null / {} items are silently skipped; only valid names participate in the diff.
  assert.deepEqual(d.matched, ["DDSO Nylon"]);
  assert.deepEqual(d.missingFromOurs, []);
  assert.deepEqual(d.extraInOurs, []);
});
