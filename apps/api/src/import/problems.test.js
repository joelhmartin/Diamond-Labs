import { test } from "vitest";
import assert from "node:assert/strict";
import { problemList } from "./problems.js";

test("one shape { kind, count, seazonaIds }; empty kinds are dropped", () => {
  assert.deepEqual(problemList([["a", ["1", "2"]], ["b", []]]), [{ kind: "a", count: 2, seazonaIds: ["1", "2"] }]);
});
