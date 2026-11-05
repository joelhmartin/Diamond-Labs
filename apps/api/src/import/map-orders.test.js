import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { mapLegacyOrder, planOrders, planLegacyFlagBackfill } from "./map-orders.js";

const load = (n) => JSON.parse(readFileSync(new URL(`../../test-fixtures/seazona/${n}`, import.meta.url), "utf8"));
const summaries = load("orders.json");
const details = new Map(load("order-details.json").map((d) => [d.id, d]));
const byId = (id) => summaries.find((s) => s.id === id);
const records = summaries.map((p) => ({ seazonaId: p.id, payload: p }));

test("an open order: board status, its own number, patient kept for sealing, lines from detail", () => {
  const { order, lines } = mapLegacyOrder({ summary: byId("ord-1"), detail: details.get("ord-1"), ownerUserId: "u-1324" });
  assert.equal(order.source, "legacy");
  assert.equal(order.sourceId, "ord-1");
  assert.equal(order.orderNumber, 98000);
  assert.equal(order.status, "in_production");
  assert.equal(order.clientUserId, "u-1324");
  assert.equal(order.legacyPatient, "Test Patient B");
  assert.equal(order.dueDate, "2026-11-03");
  assert.equal(isoDateIn(LAB_TIMEZONE, order.receivedAt), "2026-10-20");
  assert.equal(order.shippedAt, null);
  assert.deepEqual(lines.map((l) => [l.code, l.name, l.qty, l.arch]), [["2608", "DDSO Nylon", 1, "upper"], ["2701", "Night guard", 2, "lower"]]);
  assert.equal(lines[0].labOrderId, order.id);
});

test("shipped history keeps its own dates, so it never lands in the board's 14-day shipped window", () => {
  const { order, lines } = mapLegacyOrder({ summary: byId("ord-2"), ownerUserId: "u-2001" });
  assert.equal(order.status, "shipped");
  assert.equal(isoDateIn(LAB_TIMEZONE, order.shippedAt), "2019-03-14");
  assert.ok(order.shippedAt < new Date("2020-01-01"));
  assert.deepEqual(lines, [], "no detail: no lines (the order page says so)");
  const { order: cancelled } = mapLegacyOrder({ summary: byId("ord-5"), ownerUserId: "u-1324" });
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelledAt < new Date("2020-01-01"));
});

test("a held order resumes in production", () => {
  const { order } = mapLegacyOrder({ summary: byId("ord-3"), ownerUserId: "u-2001" });
  assert.equal(order.status, "on_hold");
  assert.equal(order.heldFrom, "in_production");
});

test("an unknown Seazona state is a problem, never a guessed status", () => {
  assert.deepEqual(mapLegacyOrder({ summary: byId("ord-4"), ownerUserId: "u-1324" }), { problem: "unknown_status" });
});

test("plan: skips loaded orders and taken numbers; counts open ones", () => {
  const owners = new Map([["c-1324", "u-1324"], ["c-2001", "u-2001"]]);
  const plan = planOrders({ summaries: records, details, owners, existingSourceIds: new Set(["ord-5"]), existingNumbers: new Set([97990]) });
  assert.deepEqual(plan.rows.map((r) => r.order.sourceId), ["ord-1", "ord-2"]);
  assert.equal(plan.counts.open, 1);
  assert.equal(plan.counts.alreadyLoaded, 1);
  assert.equal(plan.counts.unowned, 0);
  const kinds = Object.fromEntries(plan.problems.map((p) => [p.kind, p.seazonaIds]));
  assert.deepEqual(kinds.unknown_status, ["ord-4"]);
  assert.deepEqual(kinds.order_number_taken, ["ord-3"]);
  assert.ok(!JSON.stringify(plan.problems).includes("Patient"));
});

test("plan: a client without one eligible owner loads its orders UNOWNED and is reported by client id", () => {
  const owners = new Map([["c-1324", "u-1324"]]);
  const plan = planOrders({
    summaries: records, details, owners, rejectedClients: new Set(["c-2001"]), existingSourceIds: new Set(), existingNumbers: new Set(),
  });
  const mine = plan.rows.filter((r) => r.order.clientUserId === null).map((r) => r.order.sourceId);
  assert.deepEqual(mine, ["ord-2", "ord-3"]);
  assert.equal(plan.counts.unowned, 2);
  const kinds = Object.fromEntries(plan.problems.map((p) => [p.kind, p]));
  assert.deepEqual(kinds.client_owner_not_approved_doctor.seazonaIds, ["c-2001"]);
  assert.equal(kinds.client_owner_not_approved_doctor.count, 1);

  const ambiguous = planOrders({ summaries: records, details, owners: new Map(), ambiguousClients: new Set(["c-1324"]), existingSourceIds: new Set(), existingNumbers: new Set() });
  const k = Object.fromEntries(ambiguous.problems.map((p) => [p.kind, p.seazonaIds]));
  assert.deepEqual(k.client_has_multiple_owners, ["c-1324"]);
  assert.deepEqual(k.client_not_loaded, ["c-2001"]);
});

test("a live-shaped order with no number of its own takes its invoice's number", () => {
  const { orderNumber, number, ...rest } = byId("ord-2");
  const { order } = mapLegacyOrder({ summary: { ...rest, invoiceNumber: "23019" }, ownerUserId: "u-2001" });
  assert.equal(order.orderNumber, 23019);
  assert.equal(mapLegacyOrder({ summary: { ...rest, invoiceNumber: "INV-1" } }).problem, "order_number_not_numeric");
});

test("mapLegacyOrder maps panNumber", () => {
  const base = byId("ord-1");
  assert.equal(mapLegacyOrder({ summary: { ...base, panNumber: "  P-4471 " } }).order.panNumber, "P-4471");
  assert.equal(mapLegacyOrder({ summary: base, detail: { panNumber: "D-9" } }).order.panNumber, "D-9", "falls back to the detail");
  assert.equal(mapLegacyOrder({ summary: { ...base, panNumber: "A" }, detail: { panNumber: "D-9" } }).order.panNumber, "A", "the summary wins");
  assert.equal(mapLegacyOrder({ summary: { ...base, panNumber: "x".repeat(40) } }).order.panNumber.length, 30);
  assert.equal(mapLegacyOrder({ summary: { ...base, panNumber: 123 } }).order.panNumber, "123");
});

test("blank pan maps to null", () => {
  const base = byId("ord-1");
  assert.equal(mapLegacyOrder({ summary: { ...base, panNumber: "   " } }).order.panNumber, null);
  assert.equal(mapLegacyOrder({ summary: base }).order.panNumber, null);
});

test("mapLegacyOrder maps isRemake true", () => {
  const base = byId("ord-1");
  for (const v of [true, "true"]) {
    const { order } = mapLegacyOrder({ summary: { ...base, isRemake: v } });
    assert.equal(order.isRemake, true);
    assert.equal(order.remakeOfOrderId, null, "Seazona gives no link to the original");
  }
  assert.equal(mapLegacyOrder({ summary: base, detail: { isRemake: true } }).order.isRemake, true, "falls back to the detail");
});

test("isRemake missing or false maps to false", () => {
  const base = byId("ord-1");
  for (const v of [undefined, null, false, "false", "yes", 1, ""]) {
    assert.equal(mapLegacyOrder({ summary: { ...base, isRemake: v } }).order.isRemake, false);
  }
  assert.equal(mapLegacyOrder({ summary: { ...base, isRemake: false }, detail: { isRemake: true } }).order.isRemake, false, "the summary's answer wins");
});

test("backfill fills only null pans", () => {
  const existing = [
    { id: "lo-1", sourceId: "ord-1", panNumber: null, isRemake: false },
    { id: "lo-2", sourceId: "ord-2", panNumber: "KEEP", isRemake: false },
    { id: "lo-3", sourceId: "ord-3", panNumber: null, isRemake: false },
    { id: "lo-x", sourceId: "ord-gone", panNumber: null, isRemake: false },
  ];
  const recs = [
    { seazonaId: "ord-1", payload: { panNumber: " 77 " } },
    { seazonaId: "ord-2", payload: { panNumber: "OVERWRITE" } },
    { seazonaId: "ord-3", payload: {} },
  ];
  const plan = planLegacyFlagBackfill(existing, recs, new Map([["ord-3", { panNumber: "D3" }]]));
  assert.deepEqual(plan.pan, [{ id: "lo-1", panNumber: "77" }, { id: "lo-3", panNumber: "D3" }]);
  assert.deepEqual(plan.remake, []);
});

test("backfill sets is_remake only on rows that are false and whose payload is true", () => {
  const existing = [
    { id: "lo-1", sourceId: "a", panNumber: "p", isRemake: false },
    { id: "lo-2", sourceId: "b", panNumber: "p", isRemake: true },
    { id: "lo-3", sourceId: "c", panNumber: "p", isRemake: false },
  ];
  const recs = [
    { seazonaId: "a", payload: { isRemake: true } },
    { seazonaId: "b", payload: { isRemake: false } }, // never flips true -> false
    { seazonaId: "c", payload: { isRemake: false } },
  ];
  const plan = planLegacyFlagBackfill(existing, recs, new Map());
  assert.deepEqual(plan.remake, ["lo-1"]);
  assert.deepEqual(plan.pan, []);
});
