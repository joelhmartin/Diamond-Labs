import { test } from "vitest";
import assert from "node:assert/strict";
import { planApply, normalizeLabel, assertUniqueLabel, TagError } from "./rules.js";

const defs = [
  { id: "t1", recordType: "order", label: "Rush", color: "red", active: true },
  { id: "t2", recordType: "order", label: "Old", color: "slate", active: false },
  { id: "x1", recordType: "other", label: "Elsewhere", color: "blue", active: true },
];
const base = { definitions: defs, current: new Map(), ids: ["a"], add: [], remove: [], existing: ["a", "b"], recordType: "order" };

test("refuses a tag from another record type", () => {
  assert.throws(() => planApply({ ...base, add: ["x1"] }), (e) => e instanceof TagError && e.code === "INVALID");
});

test("refuses adding an inactive tag but allows removing one", () => {
  assert.throws(() => planApply({ ...base, add: ["t2"] }), (e) => e instanceof TagError && e.code === "INVALID");
  const { changes } = planApply({ ...base, current: new Map([["a", ["t2"]]]), remove: ["t2"] });
  assert.equal(changes[0].removed[0].id, "t2");
});

test("missing ids land in failed and the rest apply", () => {
  const { changes, failed } = planApply({ ...base, ids: ["a", "ghost"], add: ["t1"] });
  assert.equal(failed[0].message, "not found");
  assert.equal(failed[0].id, "ghost");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].recordId, "a");
});

test("adding an already-applied tag is a no-op, not a change", () => {
  const { changes, failed } = planApply({ ...base, current: new Map([["a", new Set(["t1"])]]), add: ["t1"] });
  assert.deepEqual(changes, []);
  assert.deepEqual(failed, []);
});

test("more than 500 ids is refused", () => {
  const ids = Array.from({ length: 501 }, (_, i) => `r${i}`);
  assert.throws(() => planApply({ ...base, ids, add: ["t1"] }), (e) => e instanceof TagError && e.code === "INVALID");
});

test("labels are normalized and unique ignoring case", () => {
  assert.equal(normalizeLabel("  Sample   Model "), "Sample Model");
  assert.throws(() => assertUniqueLabel(defs, "order", "rUSH"), (e) => e.code === "CONFLICT");
  assertUniqueLabel(defs, "order", "Elsewhere");
  assertUniqueLabel(defs, "order", "rush", "t1");
});
