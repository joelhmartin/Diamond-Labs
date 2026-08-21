import { test } from "vitest";
import assert from "node:assert/strict";
import {
  DEFAULT_QUEUE_STATUSES,
  summariseLines,
  canPush,
  overrideRowFor,
  normalizeSeazonaCode,
  CASE_STATUSES,
  canTransition,
} from "../admin-rx-cases.routes.js";

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

test("overrideRowFor clears a code paired with noteOnly — note-only wins", () => {
  // A partial update can send noteOnly: true while a real seazonaCode still
  // sits on the row from a previous edit. Both downstream readers (canPush,
  // itemFromOverride) key off noteOnly and would silently drop the code, so
  // the persisted row must not lie about what will actually happen.
  const row = overrideRowFor({
    mapKey: "x",
    seazonaCode: "1234",
    noteOnly: true,
  });
  assert.equal(row.seazonaCode, null);
  assert.equal(row.noteOnly, true);
});

test("overrideRowFor still passes a code through when noteOnly is false", () => {
  // Pins the normal path so the noteOnly-wins fix cannot over-reach.
  const row = overrideRowFor({
    mapKey: "x",
    seazonaCode: "1234",
    noteOnly: false,
  });
  assert.equal(row.seazonaCode, "1234");
});

test("normalizeSeazonaCode clears the code when noteOnly is true", () => {
  assert.equal(normalizeSeazonaCode({ seazonaCode: "1234", noteOnly: true }), null);
});

test("normalizeSeazonaCode keeps the code when noteOnly is false", () => {
  assert.equal(normalizeSeazonaCode({ seazonaCode: "1234", noteOnly: false }), "1234");
});

test("normalizeSeazonaCode is null-safe when there's no code and no ruling", () => {
  assert.equal(normalizeSeazonaCode({ seazonaCode: null, noteOnly: false }), null);
});

test("the six agreed states exist and nothing else", () => {
  assert.deepEqual([...CASE_STATUSES].sort(), [
    "awaiting_doctor", "cancelled", "failed", "in_review", "new", "pushed",
  ]);
});

test("a pushed case cannot be moved back — the Seazona order already exists", () => {
  assert.equal(canTransition("pushed", "in_review"), false);
  assert.equal(canTransition("pushed", "cancelled"), false);
});

test("a failed push can be retried or cancelled", () => {
  assert.equal(canTransition("failed", "in_review"), true);
  assert.equal(canTransition("failed", "cancelled"), true);
});

test("canTransition rejects a 'from' status the system does not recognise", () => {
  // A status canTransition doesn't recognise isn't a state anything should be
  // able to transition out of — the brief's version only checked `to` and the
  // pushed-is-terminal rule, so an unknown or undefined origin fell through to
  // `true`. That's the gap this pins closed.
  assert.equal(canTransition("bogus_status", "in_review"), false);
  assert.equal(canTransition(undefined, "in_review"), false);
  assert.equal(canTransition(null, "cancelled"), false);
});

test("canTransition still rejects an unrecognised 'to' status", () => {
  assert.equal(canTransition("new", "bogus_status"), false);
});
