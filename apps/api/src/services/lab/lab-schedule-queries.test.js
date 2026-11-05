import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../../test/fake-tx.js";
import { boardTiles, tileOrderIds, labLoadCounts, tomorrowOf } from "./lab-schedule-queries.js";
import { toCalendar } from "../../modules/business-calendar/index.js";

// Friday 2026-11-06, 9am in Chicago. Sat/Sun closed, so "tomorrow" is Monday 11-09.
const NOW = new Date("2026-11-06T15:00:00Z");
const CAL_ROW = { key: "default", timezone: "America/Chicago", leadDays: 13, closedWeekdays: [0, 6], capacityBasis: "none", capacityByWeekday: {} };
const calendarSelects = [[CAL_ROW], []];

const open = (id, status, dueDate, heldFrom = null) => ({ id, status, heldFrom, dueDate });
const lateStagePlan = {
  recordType: "lab_order", recordId: "g", workflowKey: "10d", workflowName: "10d", startDate: "2026-10-26", dueDate: "2026-11-30", direction: "forward",
  stages: [{ key: "qc", label: "Quality check", milestone: "quality_check", targetAt: "2026-11-05" }],
};
const ORDERS = [
  open("a", "in_production", "2026-11-05"), // past due, at risk
  open("b", "received", "2026-11-06"), // due today, at risk
  open("c", "received", "2026-11-09"), // due next open day, at risk
  open("d", "in_production", "2026-11-30"), // nothing
  open("e", "on_hold", "2026-11-30", "in_production"), // on hold only
  open("f", "quality_check", "2026-11-06"), // due today, but already in QC
  open("g", "in_production", "2026-11-30"), // behind its plan: at risk
  open("h", "on_hold", "2026-11-05", "received"), // past due + on hold + at risk
];

test("tiles count past due, today, next open day, on hold and at risk", async () => {
  const tx = fakeTx({ selects: [...calendarSelects, ORDERS, [lateStagePlan]] });
  const tiles = await boardTiles(tx, NOW);
  assert.deepEqual(tiles, {
    pastDue: 2, dueToday: 2, dueTomorrow: 1, onHold: 2, atRisk: 5, today: "2026-11-06", tomorrowDate: "2026-11-09",
  });
});

test("on hold counts in onHold and atRisk independently", async () => {
  const tx = fakeTx({ selects: [...calendarSelects, [open("h", "on_hold", "2026-11-05", "received"), open("e", "on_hold", "2026-11-30", "in_production")], []] });
  const tiles = await boardTiles(tx, NOW);
  assert.equal(tiles.onHold, 2);
  assert.equal(tiles.atRisk, 1, "only the held order that is past due and not past QC");
  assert.equal(tiles.pastDue, 1);
});

test("today comes from the calendar's timezone, not the server's", async () => {
  const tokyo = { ...CAL_ROW, timezone: "Asia/Tokyo" };
  // 2026-11-06 23:30Z is already Saturday 11-07 in Tokyo; the next open day is Monday 11-09.
  const tiles = await boardTiles(fakeTx({ selects: [[tokyo], [], [], []] }), new Date("2026-11-06T23:30:00Z"));
  assert.equal(tiles.today, "2026-11-07");
  assert.equal(tiles.tomorrowDate, "2026-11-09");
});

test("tomorrowOf skips the weekend and holidays", () => {
  const cal = toCalendar(CAL_ROW, ["2026-11-09"]);
  assert.equal(tomorrowOf("2026-11-06", cal), "2026-11-10");
  assert.equal(tomorrowOf("2026-11-03", cal), "2026-11-04");
});

test("tileOrderIds: at_risk resolves ids, every other tile is left to SQL", async () => {
  const tx = fakeTx({ selects: [...calendarSelects, ORDERS, [lateStagePlan]] });
  assert.deepEqual(await tileOrderIds(tx, "at_risk", NOW), ["a", "b", "c", "g", "h"]);
  assert.equal(await tileOrderIds(fakeTx(), "past_due", NOW), null);
  assert.equal(await tileOrderIds(fakeTx(), "on_hold", NOW), null);
});

test("plans load in batches so a large board never builds one huge IN list", async () => {
  const many = Array.from({ length: 900 }, (_, i) => open(`o${i}`, "received", "2026-12-30"));
  const tx = fakeTx({ selects: [...calendarSelects, many, [], [], []] });
  assert.deepEqual(await tileOrderIds(tx, "at_risk", NOW), []);
  assert.equal(tx.log.filter((l) => l.op === "select").length, 2 + 1 + 3, "calendar, holidays, open orders, then 3 plan batches");
});

test("units counts quantities and skips note-only lines", async () => {
  const tx = fakeTx({ selects: [[
    { dueDate: "2026-11-09", qty: 2, noteOnly: false },
    { dueDate: "2026-11-09", qty: 1, noteOnly: true },
    { dueDate: "2026-11-09", qty: 3, noteOnly: false },
    { dueDate: "2026-11-10", qty: 1, noteOnly: false },
  ]] });
  const counts = await labLoadCounts(tx, { from: "2026-11-09", to: "2026-11-13", basis: "units" });
  assert.deepEqual([...counts], [["2026-11-09", 5], ["2026-11-10", 1]]);
});

test("orders basis counts non-cancelled orders per due date", async () => {
  const tx = fakeTx({ selects: [[{ dueDate: "2026-11-09", n: "4" }, { dueDate: "2026-11-10", n: 1 }]] });
  const counts = await labLoadCounts(tx, { from: "2026-11-09", to: "2026-11-13", basis: "orders" });
  assert.deepEqual([...counts], [["2026-11-09", 4], ["2026-11-10", 1]]);
});
