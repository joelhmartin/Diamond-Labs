import { test } from "vitest";
import assert from "node:assert/strict";
import { groupByStatus, quickMoves, boardParams, describeEvent, isStale, errorText, blobErrorText } from "../lab-board.js";

test("every board column exists, even empty; cancelled cards are not on the board", () => {
  const g = groupByStatus([
    { id: "a", status: "received" }, { id: "b", status: "received" }, { id: "c", status: "on_hold" }, { id: "d", status: "cancelled" },
  ]);
  assert.deepEqual(Object.keys(g), ["received", "in_production", "quality_check", "ready_to_ship", "on_hold", "shipped"]);
  assert.deepEqual(g.received.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(g.in_production, []);
  assert.ok(!Object.values(g).flat().some((c) => c.id === "d"));
});

test("cards offer only the moves that need no reason, straight from the shared table", () => {
  assert.deepEqual(quickMoves({ status: "received" }), [{ to: "in_production", label: "→ In production" }]);
  assert.deepEqual(quickMoves({ status: "quality_check" }).map((m) => m.to), ["ready_to_ship", "in_production"]);
  assert.deepEqual(quickMoves({ status: "on_hold", heldFrom: "quality_check" }), [{ to: "quality_check", label: "→ Quality check" }]);
  assert.deepEqual(quickMoves({ status: "shipped" }), []);
});

test("filters become query params, dropping blanks", () => {
  assert.deepEqual(
    boardParams({ departmentId: " ", assigneeUserId: "", q: " RX-1 ", rush: true, dueBefore: "2026-10-10" }),
    { q: "RX-1", dueBefore: "2026-10-10", rush: "true" },
  );
  assert.deepEqual(boardParams({ rush: false }), {});
});

test("timeline rows read as sentences, naming people and rooms", () => {
  const ctx = { staffById: { t1: "Maria Lopez" }, departmentsById: { d1: "Acrylic" } };
  assert.equal(describeEvent({ type: "release", byName: null }, ctx), "System: released to the lab");
  assert.equal(describeEvent({ type: "status", from: "received", to: "in_production", byName: "Ana" }, ctx), "Ana: Received → In production");
  assert.equal(describeEvent({ type: "hold", note: "Waiting on bite", byName: "Ana" }, ctx), "Ana: put on hold — Waiting on bite");
  assert.equal(describeEvent({ type: "assign", to: "t1", byName: "Ana" }, ctx), "Ana: assigned to Maria Lopez");
  assert.equal(describeEvent({ type: "assign", to: null, byName: "Ana" }, ctx), "Ana: unassigned");
  assert.equal(describeEvent({ type: "department", to: "d1", byName: "Ana" }, ctx), "Ana: moved to Acrylic");
  assert.equal(describeEvent({ type: "due", to: "2026-10-21", byName: "Ana" }, ctx), "Ana: due date set to 10/21/2026");
  assert.equal(describeEvent({ type: "due", to: null, byName: "Ana" }, ctx), "Ana: due date cleared");
  assert.equal(describeEvent({ type: "note", note: "Lab notes updated", byName: "Ana" }, ctx), "Ana: Lab notes updated");
});

test("a 409 STALE is recognised so the page can reload instead of retrying", () => {
  assert.equal(isStale({ response: { status: 409, data: { error: { code: "STALE" } } } }), true);
  assert.equal(isStale({ response: { status: 409, data: { error: { code: "CONFLICT" } } } }), false);
  assert.equal(errorText({ response: { data: { error: { message: "Nope." } } } }), "Nope.");
  assert.equal(errorText({}), "Something went wrong.");
});

test("a failed blob request surfaces the server's message", async () => {
  const blob = new Blob([JSON.stringify({ error: { message: "Ticket unavailable." } })]);
  assert.equal(await blobErrorText({ response: { data: blob } }), "Ticket unavailable.");
  assert.equal(await blobErrorText({ response: { data: new Blob(["not json"]) }, message: "boom" }), "boom");
  assert.equal(await blobErrorText({ message: "offline" }), "offline");
});
