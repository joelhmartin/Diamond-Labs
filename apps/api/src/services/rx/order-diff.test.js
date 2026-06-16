import { test } from "node:test";
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
