import { test } from "vitest";
import assert from "node:assert/strict";
import { paramsReady, paramsToQuery, optionsOf, isPartialRange } from "./spec.js";

const specs = [
  { name: "from", type: "date", required: true },
  { name: "range", type: "dateRange" },
  { name: "tags", type: "multiselect", options: ["x", { value: 2, label: "Two" }] },
];

test("paramsReady wants every required value and no half-filled range", () => {
  assert.equal(paramsReady(specs, {}), false);
  assert.equal(paramsReady(specs, { from: "2026-10-01" }), true);
  assert.equal(paramsReady(specs, { from: "2026-10-01", range: "2026-10-01.." }), false);
  assert.equal(isPartialRange("last30"), false);
});

test("paramsToQuery keeps only the specs' non-blank raw values", () => {
  assert.deepEqual(paramsToQuery(specs, { from: "2026-10-01", tags: "", other: "z", range: "last7" }), { from: "2026-10-01", range: "last7" });
});

test("optionsOf accepts strings and { value, label }", () => {
  assert.deepEqual(optionsOf(specs[2]), [{ value: "x", label: "x" }, { value: "2", label: "Two" }]);
});
