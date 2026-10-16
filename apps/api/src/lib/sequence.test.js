import { test } from "vitest";
import assert from "node:assert/strict";
import { nextSequenceNumber } from "./sequence.js";

test("a sequence continues from its start and never reuses a number", () => {
  assert.equal(nextSequenceNumber(null, 100000), 100000);
  assert.equal(nextSequenceNumber(100244, 100000), 100245);
  assert.equal(nextSequenceNumber(12, 100000), 100000, "raising the start later jumps ahead");
  assert.throws(() => nextSequenceNumber(null, 0), RangeError);
  assert.throws(() => nextSequenceNumber(null, 1.5), RangeError);
});
