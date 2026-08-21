import { test } from "vitest";
import assert from "node:assert/strict";
import { DEFAULT_QUEUE_STATUSES, summariseLines, canPush, overrideRowFor } from "../admin-rx-cases.routes.js";

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

test("a case with an unresolved line cannot be pushed", () => {
  assert.equal(canPush([{ status: "open", noteOnly: false }]).ok, false);
});

test("a case whose only open line is noteOnly can be pushed", () => {
  assert.equal(canPush([
    { status: "confirmed", noteOnly: false, seazonaCode: "2608" },
    { status: "open", noteOnly: true },
  ]).ok, true);
});

test("a case with no lines at all cannot be pushed", () => {
  const r = canPush([]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no lines/i);
});

test("a case whose only line is note-only has nothing to send", () => {
  // Guards the difference between "no lines" and "no SENDABLE lines" — an
  // implementation checking lines.length instead of emitting.length passes
  // every other test here and still lets this through.
  const r = canPush([{ status: "open", noteOnly: true }]);
  assert.equal(r.ok, false);
});

test("a line claiming to be confirmed with no code is refused, not trusted", () => {
  // canPush must not take a line's own claim about itself at face value.
  // Nothing upstream produces this shape today (statusForLine guards the
  // write path, the resolver routes codeless rows to unmapped) — but the
  // gate is the last check before a real order reaches the lab, and it must
  // hold even if a future producer gets it wrong.
  const r = canPush([{ seazonaCode: null, noteOnly: false, status: "confirmed", mapKey: "mod:x" }]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /product code/i);
  assert.deepEqual(r.blocking, ["mod:x"]);
});

test("an 'always' code assignment becomes an override row", () => {
  const row = overrideRowFor({
    mapKey: "mod:anterior-pad",
    seazonaCode: "2181",
    seazonaName: "Acrylic Palatal Pads",
    noteOnly: false,
    confirmedBy: "u1",
  });
  assert.equal(row.mapKey, "mod:anterior-pad");
  assert.equal(row.seazonaCode, "2181");
  assert.equal(row.noteOnly, false);
});

test("an 'always' note-only ruling is recorded without inventing a code", () => {
  const row = overrideRowFor({
    mapKey: "mod:wrap-distal",
    seazonaCode: null,
    noteOnly: true,
    confirmedBy: "u1",
  });
  assert.equal(row.seazonaCode, null);
  assert.match(row.note, /note only/i);
  // The ruling must be a real, queryable column — not only readable back out
  // of the human-language `note` text — because the resolver has to branch
  // on it later without parsing prose.
  assert.equal(row.noteOnly, true);
});

test("an override cannot be written without a mapKey to key it on", () => {
  assert.throws(() => overrideRowFor({ mapKey: null, seazonaCode: "2181" }), /mapKey/);
});
