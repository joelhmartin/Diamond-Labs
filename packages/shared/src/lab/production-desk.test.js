import { test } from "vitest";
import assert from "node:assert/strict";
import {
  LAB_ENCLOSED_KINDS, LAB_DELIVERY_METHODS, LAB_DELIVERY_LABELS, LAB_ENCLOSED_LABELS,
  formatEnclosure, normalizeEnclosures, parseEnclosures,
} from "./production-desk.js";

test("vocabulary", () => {
  assert.deepEqual(LAB_ENCLOSED_KINDS, ["impression", "model", "bite", "digital", "other"]);
  assert.deepEqual(LAB_DELIVERY_METHODS, ["local_delivery", "ups", "fedex", "pickup", "other"]);
  for (const k of LAB_ENCLOSED_KINDS) assert.ok(LAB_ENCLOSED_LABELS[k]);
  for (const m of LAB_DELIVERY_METHODS) assert.ok(LAB_DELIVERY_LABELS[m]);
});

test("formatEnclosure reads like the paperwork", () => {
  assert.equal(formatEnclosure({ kind: "digital", date: "2026-10-01", note: "scanner" }), "Digital (scanner 10/01/2026)");
  assert.equal(formatEnclosure({ kind: "model" }), "Model");
  assert.equal(formatEnclosure({ kind: "bite", date: "2026-10-01" }), "Bite (10/01/2026)");
});

test("normalizeEnclosures sorts by kind, trims, drops blanks and refuses repeats or unknown kinds", () => {
  assert.deepEqual(
    normalizeEnclosures([{ kind: "digital", note: " scan " }, { kind: "impression", date: "2026-10-01" }]),
    [{ kind: "impression", date: "2026-10-01" }, { kind: "digital", note: "scan" }],
  );
  assert.deepEqual(normalizeEnclosures([]), []);
  assert.deepEqual(normalizeEnclosures(null), []);
  assert.throws(() => normalizeEnclosures([{ kind: "model" }, { kind: "model" }]));
  assert.throws(() => normalizeEnclosures([{ kind: "x" }]));
  assert.throws(() => normalizeEnclosures([{ kind: "model", date: "2026-02-30" }]));
  assert.throws(() => normalizeEnclosures([{ kind: "model", note: "x".repeat(61) }]));
});

test("parseEnclosures tolerates null and bad JSON", () => {
  assert.deepEqual(parseEnclosures(null), []);
  assert.deepEqual(parseEnclosures("nope"), []);
  assert.deepEqual(parseEnclosures('[{"kind":"model"}]'), [{ kind: "model" }]);
});
