import { test } from "vitest";
import assert from "node:assert/strict";
import { groupByStatus, quickMoves, commonMoves, moveOrders, moveBulkActions, boardParams, describeEvent } from "../lab-board.js";

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

test("boardParams includes tile and dueOn only when set", () => {
  assert.deepEqual(boardParams({ tile: "at_risk", dueOn: "2026-11-12" }), { tile: "at_risk", dueOn: "2026-11-12" });
  assert.deepEqual(boardParams({ tile: "", dueOn: " " }), {});
  assert.deepEqual(boardParams({ tile: null }), {});
});

test("boardParams joins tagIds with commas and drops empty", () => {
  assert.deepEqual(boardParams({ tagIds: ["t1", "t2"] }), { tagIds: "t1,t2" });
  assert.deepEqual(boardParams({ tagIds: [] }), {});
  assert.deepEqual(boardParams({ tagIds: ["", "t1", " "] }), { tagIds: "t1" });
  assert.deepEqual(boardParams({ starred: true, tile: "past_due" }), { starred: "true", tile: "past_due" });
  assert.deepEqual(boardParams({ starred: false }), {});
});

test("a label event reads as a sentence with the label", () => {
  assert.equal(describeEvent({ type: "label", to: "Rush check", note: "Label added", byName: "Ana" }), "Ana: Label added — Rush check");
  assert.equal(describeEvent({ type: "label", to: "Rush check", note: "Label removed", byName: null }), "System: Label removed — Rush check");
});

test("a merge event reads its note", () => {
  assert.equal(describeEvent({ type: "merge", note: "Merged #101, #102 into this order", byName: "Ana" }), "Ana: Merged #101, #102 into this order");
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
  assert.equal(describeEvent({ type: "workflow", from: "10d-printed", to: "7d-1-device", byName: "Ana" }, ctx), "Ana: workflow changed from 10d-printed to 7d-1-device");
  assert.equal(describeEvent({ type: "workflow", from: null, to: "7d-1-device", byName: "Ana" }, ctx), "Ana: workflow set to 7d-1-device");
});

test("a labelled card offers only → Shipped (anything else would strand its label)", () => {
  assert.deepEqual(quickMoves({ status: "ready_to_ship", labelled: true }).map((m) => m.to), ["shipped"]);
  assert.deepEqual(quickMoves({ status: "ready_to_ship" }).map((m) => m.to), ["shipped", "quality_check"]);
});

test("shipment events read as sentences", () => {
  assert.equal(describeEvent({ type: "shipment", to: "sh1", byName: "Maria", note: "Label: UPS Ground 1Z9" }), "Maria: Label: UPS Ground 1Z9");
  assert.equal(describeEvent({ type: "shipment", from: "sh1", to: null, byName: "Maria", note: null }), "Maria: shipping label voided");
});

test("commonMoves returns only moves every card allows", () => {
  const cards = [{ status: "quality_check" }, { status: "received" }];
  assert.deepEqual(commonMoves([{ status: "quality_check" }, { status: "quality_check" }]).map((m) => m.to), ["ready_to_ship", "in_production"]);
  assert.deepEqual(commonMoves([{ status: "quality_check" }, { status: "received" }]).map((m) => m.to), ["in_production"]);
  assert.deepEqual(commonMoves(cards.concat([{ status: "shipped" }])), []);
});

test("commonMoves of an empty list is empty", () => {
  assert.deepEqual(commonMoves([]), []);
});

test("moveOrders keeps going after a stale failure", async () => {
  const cards = [1, 2, 3].map((n) => ({ id: `o${n}`, orderNumber: 100 + n, version: n }));
  const post = async (id) => {
    if (id === "o2") throw Object.assign(new Error("x"), { response: { status: 409, data: { error: { code: "STALE", message: "Changed since you loaded it." } } } });
  };
  const res = await moveOrders(cards, "in_production", post);
  assert.equal(res.ok, 2);
  assert.deepEqual(res.failed, [{ id: "#102", message: "Changed since you loaded it." }]);
});

test("moveOrders sends each card's own expectedVersion", async () => {
  const calls = [];
  await moveOrders([{ id: "a", orderNumber: 1, version: 4 }, { id: "b", orderNumber: 2, version: 9 }], "in_production", async (id, body) => calls.push([id, body]));
  assert.deepEqual(calls, [["a", { to: "in_production", expectedVersion: 4 }], ["b", { to: "in_production", expectedVersion: 9 }]]);
});

const stale = () => Object.assign(new Error("x"), { response: { status: 409, data: { error: { code: "STALE", message: "This order changed — reload." } } } });
const ready = (n, shipmentId = null) => ({ id: `o${n}`, orderNumber: 100 + n, version: n, status: "ready_to_ship", labelled: Boolean(shipmentId), shipmentId });

test("moveOrders to shipped posts a shared box once and counts its box-mates as done", async () => {
  const calls = [];
  const post = async (id) => {
    calls.push(id);
    if (id !== "o1") throw stale(); // a second post for the same box would be STALE: the first one shipped it
  };
  const res = await moveOrders([ready(1, "sh1"), ready(2, "sh1")], "shipped", post);
  assert.deepEqual(calls, ["o1"]);
  assert.deepEqual(res, { ok: 2, failed: [] });
});

test("moveOrders to shipped reports a failure, and a failed box is still tried for its box-mate", async () => {
  const calls = [];
  const post = async (id) => {
    calls.push(id);
    if (id === "o1") throw stale();
  };
  const res = await moveOrders([ready(1, "sh1"), ready(2, "sh1"), ready(3)], "shipped", post);
  assert.deepEqual(calls, ["o1", "o2", "o3"]);
  assert.equal(res.ok, 2);
  assert.deepEqual(res.failed, [{ id: "#101", message: "This order changed — reload." }]);
});

test("moveOrders only dedupes boxes for a shipped move", async () => {
  const calls = [];
  await moveOrders([{ ...ready(1, "sh1"), status: "quality_check" }, { ...ready(2, "sh1"), status: "quality_check" }], "in_production", async (id) => calls.push(id));
  assert.deepEqual(calls, ["o1", "o2"]);
});

test("moveBulkActions: Move to Shipped needs a second click and reports failures", async () => {
  const rows = [ready(1), ready(2)];
  let reloaded = 0;
  const actions = moveBulkActions(rows, { post: async (id) => { if (id === "o2") throw stale(); }, after: () => { reloaded += 1; } });
  const ship = actions.find((a) => a.id === "move-shipped");
  assert.equal(ship.label, "Move to Shipped");
  assert.equal(ship.confirmLabel, "Click again to ship 2 orders");
  assert.equal(ship.tone, "danger");
  const res = await ship.run(rows);
  assert.deepEqual(res, { ok: 1, failed: [{ id: "#102", message: "This order changed — reload." }] });
  assert.equal(reloaded, 1);
});

test("moveBulkActions: other moves are one click", () => {
  const actions = moveBulkActions([{ ...ready(1), status: "quality_check" }]);
  assert.ok(actions.length > 0);
  for (const a of actions) assert.equal(a.confirmLabel, undefined);
  assert.equal(moveBulkActions([ready(1)]).find((a) => a.id === "move-shipped").confirmLabel, "Click again to ship 1 order");
});
