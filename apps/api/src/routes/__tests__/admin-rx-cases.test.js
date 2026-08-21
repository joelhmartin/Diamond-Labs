import { test } from "vitest";
import assert from "node:assert/strict";
import { DEFAULT_QUEUE_STATUSES, summariseLines } from "../admin-rx-cases.routes.js";

test("the queue defaults to everything needing attention", () => {
  assert.deepEqual(
    [...DEFAULT_QUEUE_STATUSES].sort(),
    ["awaiting_doctor", "failed", "in_review", "new"]
  );
  assert.ok(!DEFAULT_QUEUE_STATUSES.includes("pushed"));
  assert.ok(!DEFAULT_QUEUE_STATUSES.includes("cancelled"));
});

test("a noteOnly line is not counted as unmapped — it does not block a push", () => {
  const s = summariseLines([
    { status: "confirmed", noteOnly: false },
    { status: "open", noteOnly: true },
  ]);
  assert.equal(s.lineCount, 2);
  assert.equal(s.unmappedCount, 0);
});

test("an open line that is not noteOnly counts as unmapped", () => {
  const s = summariseLines([
    { status: "confirmed", noteOnly: false },
    { status: "open", noteOnly: false },
  ]);
  assert.equal(s.unmappedCount, 1);
});
