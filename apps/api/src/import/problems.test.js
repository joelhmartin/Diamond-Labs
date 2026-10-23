import { test } from "vitest";
import assert from "node:assert/strict";
import { problemList } from "./problems.js";

test("one shape { kind, count, seazonaIds }; empty kinds are dropped", () => {
  assert.deepEqual(problemList([["a", ["1", "2"]], ["b", []]]), [{ kind: "a", count: 2, seazonaIds: ["1", "2"] }]);
});

test("ids are capped at 50 but the count stays whole", () => {
  const ids = Array.from({ length: 80 }, (_, i) => String(i));
  const [p] = problemList([["a", ids]]);
  assert.equal(p.count, 80);
  assert.deepEqual(p.seazonaIds, ids.slice(0, 50));
});
