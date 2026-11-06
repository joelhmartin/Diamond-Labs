import { test } from "vitest";
import assert from "node:assert/strict";
import { isOverdue, TERMINAL_LAB_STATUSES, LAB_ORDER_STATUSES } from "@my-app/shared";
import { fakeTx } from "../../../test/fake-tx.js";
import { executedSql, renderSql, sqlText } from "../../../test/sql-text.js";
import { toCalendar } from "../../../modules/business-calendar/index.js";
import { boardTiles, tileOrderIds } from "../lab-schedule-queries.js";
import {
  atRiskOrders, boardDayCounts, dueByDay, dueSoonSql, isOpenOrder, ordersByDay, openUnitsByCategory, pastDueSql, shippedByDay, turnaroundDays,
  turnaroundAverage, turnaroundByWeek, weekStart,
} from "./order-metrics.js";

const PHI = /legacy_patient|patient_|form_data|notes|hold_reason|lab_notes|source_label|\bnote\b/;
const range = (from, to) => ({ from, to });

// Piece 7's board fixture: Friday 2026-11-06, 9am in Chicago; Sat/Sun closed, so "tomorrow" is Monday 11-09.
const NOW = new Date("2026-11-06T15:00:00Z");
const CAL_ROW = { key: "default", timezone: "America/Los_Angeles", leadDays: 0, closedWeekdays: [0, 6], capacityBasis: "none", capacityByWeekday: {} };
const open = (id, status, dueDate, heldFrom = null) => ({ id, status, heldFrom, dueDate });
const LATE_PLAN = {
  recordType: "lab_order", recordId: "g", workflowKey: "10d", workflowName: "10d", startDate: "2026-10-26", dueDate: "2026-11-30", direction: "forward",
  stages: [{ key: "qc", label: "Quality check", milestone: "quality_check", targetAt: "2026-11-05" }],
};
const OPEN_ORDERS = [
  open("a", "in_production", "2026-11-05"), open("b", "received", "2026-11-06"), open("c", "received", "2026-11-09"),
  open("d", "in_production", "2026-11-30"), open("e", "on_hold", "2026-11-30", "in_production"), open("f", "quality_check", "2026-11-06"),
  open("g", "in_production", "2026-11-30"), open("h", "on_hold", "2026-11-05", "received"),
];
/** The selects one boardTiles / tileOrderIds call reads: calendar row, holidays, open orders, plans. */
const boardSelects = () => [[CAL_ROW], [], OPEN_ORDERS, [LATE_PLAN]];

test("boardDayCounts equals piece 7's tile counts for the same fixture", async () => {
  const ours = await boardDayCounts(fakeTx({ selects: boardSelects() }), NOW);
  const { today, tomorrowDate, ...theirs } = await boardTiles(fakeTx({ selects: boardSelects() }), NOW);
  assert.deepEqual(ours, theirs);
  assert.deepEqual(ours, { pastDue: 2, dueToday: 2, dueTomorrow: 1, onHold: 2, atRisk: 5 });
  assert.equal(tomorrowDate, "2026-11-09", "tomorrow is the next open business day");
  // An on-hold order past its due date is past due (and on hold), as the shared isOverdue says.
  assert.equal(isOverdue("2026-11-05", "on_hold", today), true);
});

test("the at-risk list is piece 7's at-risk ids, and its total is the At risk tile's count", async () => {
  const ids = await tileOrderIds(fakeTx({ selects: boardSelects() }), "at_risk", NOW);
  assert.deepEqual(ids, ["a", "b", "c", "g", "h"]);
  const detail = ids.map((id, i) => ({ id, orderNumber: 50000 + i, client: "One Dental", status: "received", dueDate: "2026-11-06", rush: i === 0 }));
  const tx = fakeTx({ selects: boardSelects(), executes: [detail.slice(0, 3)] });
  const out = await atRiskOrders(tx, NOW, 3);
  const { atRisk } = await boardDayCounts(fakeTx({ selects: boardSelects() }), NOW);
  assert.equal(out.total, atRisk, "list total and tile agree");
  assert.equal(out.truncated, true);
  assert.deepEqual(out.rows.map((r) => r.id), ["a", "b", "c"]);
  assert.equal(out.rows[0].rush, true);
  const [{ text, params }] = executedSql(tx);
  assert.match(text, /where lab_orders\.id = any\(\$1::text\[\]\)/, "one array parameter, not an IN list");
  assert.deepEqual(params[0], ids);
  assert.match(text, /order by lab_orders\.due_date nulls last, lab_orders\.rush desc, lab_orders\.order_number/);
  assert.doesNotMatch(text, PHI);
  // Nothing at risk: no detail query at all.
  const none = fakeTx({ selects: [[CAL_ROW], [], [open("d", "in_production", "2026-11-30")], []] });
  assert.deepEqual(await atRiskOrders(none, NOW), { rows: [], total: 0, truncated: false });
  assert.equal(executedSql(none).length, 0);
});

test("past due is the SQL twin of isOverdue; due soon is piece 7's business-day window without the past due", () => {
  assert.equal(isOverdue("2026-10-30", "on_hold", "2026-11-01"), true);
  assert.equal(isOverdue("2026-10-30", "shipped", "2026-11-01"), false);
  const pd = sqlText(pastDueSql("2026-11-01"));
  assert.match(pd, /lab_orders\.status not in \('shipped', 'cancelled'\) and lab_orders\.due_date < \$1::date/);
  assert.deepEqual(TERMINAL_LAB_STATUSES, ["shipped", "cancelled"]);
  for (const s of LAB_ORDER_STATUSES) assert.equal(sqlText(isOpenOrder).includes(`'${s}'`), TERMINAL_LAB_STATUSES.includes(s), s);
  // Friday with the weekend closed: today, Monday and Tuesday are due soon; the cutoff is Wednesday.
  const cal = toCalendar(CAL_ROW, []);
  const { text, params } = renderSql(dueSoonSql("2026-11-06", cal));
  assert.equal(text, "lab_orders.due_date >= $1::date and lab_orders.due_date < $2::date");
  assert.deepEqual(params, ["2026-11-06", "2026-11-11"]);
  // A holiday on Monday pushes the cutoff a day.
  assert.deepEqual(renderSql(dueSoonSql("2026-11-06", toCalendar(CAL_ROW, ["2026-11-09"]))).params, ["2026-11-06", "2026-11-12"]);
});

test("turnaroundDays: business days between lab-local days; calendar days with no calendar; null when unshipped or cancelled", () => {
  assert.equal(turnaroundDays({ status: "shipped", receivedAt: "2026-10-01T15:00:00Z", shippedAt: "2026-10-05T03:00:00Z" }), 3);
  assert.equal(turnaroundDays({ status: "shipped", receivedAt: "2026-10-01T15:00:00Z", shippedAt: "2026-10-01T20:00:00Z" }), 0);
  assert.equal(turnaroundDays({ status: "in_production", receivedAt: "2026-10-01T15:00:00Z", shippedAt: null }), null);
  assert.equal(turnaroundDays({ status: "cancelled", receivedAt: "2026-10-01T15:00:00Z", shippedAt: "2026-10-03T15:00:00Z" }), null);
  // Thu Oct 1 -> Mon Oct 5 (Chicago days) with the weekend closed: Fri + Mon = 2; a Friday holiday makes it 1.
  const cal = toCalendar(CAL_ROW, []);
  const order = { status: "shipped", receivedAt: "2026-10-01T15:00:00Z", shippedAt: "2026-10-05T20:00:00Z" };
  assert.equal(turnaroundDays(order), 4);
  assert.equal(turnaroundDays(order, cal), 2);
  assert.equal(turnaroundDays(order, toCalendar(CAL_ROW, ["2026-10-02"])), 1);
});

test("ordersByDay buckets live orders by lab-local received day and fills empty days", async () => {
  const tx = fakeTx({ executes: [[{ day: "2026-10-02", orders: "4", rush: "1", remakes: "1", units: "9" }]] });
  const out = await ordersByDay(tx, range("2026-10-01", "2026-10-03"));
  assert.deepEqual(out, [
    { day: "2026-10-01", orders: 0, rush: 0, remakes: 0, units: 0 },
    { day: "2026-10-02", orders: 4, rush: 1, remakes: 1, units: 9 },
    { day: "2026-10-03", orders: 0, rush: 0, remakes: 0, units: 0 },
  ]);
  const [{ text }] = executedSql(tx);
  assert.match(text, /lab_orders\.received_at at time zone 'America\/Los_Angeles'/);
  assert.match(text, /lab_orders\.status <> 'cancelled'/);
  assert.match(text, /lab_order_lines\.note_only = false/);
});

test("shippedByDay counts each shipment once per carrier and orders without a shipment", async () => {
  const tx = fakeTx({ executes: [[{ day: "2026-10-01", orders: "5", shipments: "3", ups: "2", fedex: "0", manual: "1", noShipment: "1" }]] });
  const out = await shippedByDay(tx, range("2026-10-01", "2026-10-01"));
  assert.deepEqual(out, [{ day: "2026-10-01", orders: 5, shipments: 3, ups: 2, fedex: 0, manual: 1, noShipment: 1 }]);
  const [{ text }] = executedSql(tx);
  assert.match(text, /count\(distinct shipments\.id\) filter \(where shipments\.carrier = \$\d+\) as ups/);
  assert.match(text, /left join shipments on shipments\.id = lab_orders\.shipment_id/);
  assert.match(text, /lab_orders\.status = 'shipped' and lab_orders\.shipped_at >= /);
});

test("openUnitsByCategory sums product lines on open orders by catalog category", async () => {
  const tx = fakeTx({ executes: [[{ category: "Night guards", units: "12", orders: "7" }]] });
  assert.deepEqual(await openUnitsByCategory(tx), [{ category: "Night guards", units: 12, orders: 7 }]);
  const [{ text }] = executedSql(tx);
  assert.match(text, /left join product_variants as by_code/);
  assert.match(text, /lab_orders\.status not in \('shipped', 'cancelled'\)/);
  assert.doesNotMatch(text, PHI);
});

test("dueByDay counts open orders by due date, every day filled (the board's due-today rule)", async () => {
  const tx = fakeTx({ executes: [[{ day: "2026-11-06", orders: "4", rush: "1" }]] });
  const out = await dueByDay(tx, range("2026-11-05", "2026-11-07"));
  assert.deepEqual(out, [
    { day: "2026-11-05", orders: 0, rush: 0 }, { day: "2026-11-06", orders: 4, rush: 1 }, { day: "2026-11-07", orders: 0, rush: 0 },
  ]);
  const [{ text, params }] = executedSql(tx);
  assert.match(text, /lab_orders\.status not in \('shipped', 'cancelled'\) and lab_orders\.due_date between \$\d::date and \$\d::date/);
  assert.ok(params.includes("2026-11-05") && params.includes("2026-11-07"));
  assert.doesNotMatch(text, PHI);
});

test("turnaround average and weekly trend use the clamped received -> shipped lab-day rule on shipped orders", async () => {
  const tx = fakeTx({ executes: [[{ orders: "3", avgDays: "2.5" }], []] });
  assert.deepEqual(await turnaroundAverage(tx, range("2026-10-07", "2026-11-05")), { orders: 3, avgDays: 2.5 });
  assert.deepEqual(await turnaroundAverage(tx, range("2026-09-07", "2026-10-06")), { orders: 0, avgDays: null });
  const [{ text }] = executedSql(tx);
  assert.match(text, /lab_orders\.status = 'shipped' and lab_orders\.shipped_at is not null/);
  // No calendar row: every day is open, so business days are plain lab-day arithmetic.
  assert.match(text, /avg\(greatest\(0, \(lab_orders\.shipped_at at time zone 'America\/Los_Angeles'\)::date - \(lab_orders\.received_at at time zone 'America\/Los_Angeles'\)::date\)\)/);
  // With the weekend closed and a holiday, the average counts open days only (the SQL twin of turnaroundDays).
  const biz = fakeTx({ selects: [[CAL_ROW], [{ id: "h1", date: "2026-11-26", label: "Thanksgiving" }]], executes: [[{ orders: "1", avgDays: "2" }]] });
  await turnaroundAverage(biz, range("2026-11-01", "2026-11-30"));
  const [{ text: bt }] = executedSql(biz);
  assert.match(bt, /generate_series\(\(\(lab_orders\.received_at at time zone 'America\/Los_Angeles'\)::date \+ 1\)::timestamp, \(\(lab_orders\.shipped_at at time zone 'America\/Los_Angeles'\)::date\)::timestamp, interval '1 day'\)/);
  assert.match(bt, /extract\(dow from g\.d\)::int not in \(0, 6\) and g\.d::date not in \('2026-11-26'\)/);

  assert.equal(weekStart("2026-11-05"), "2026-11-02"); // a Thursday -> its Monday
  assert.equal(weekStart("2026-11-02"), "2026-11-02");
  assert.equal(weekStart("2026-11-01"), "2026-10-26"); // Sunday belongs to the week before
  const wk = fakeTx({ executes: [[{ week: "2026-10-26", orders: "2", avgDays: "4" }]] });
  const weeks = await turnaroundByWeek(wk, range("2026-10-19", "2026-11-05"));
  assert.deepEqual(weeks, [
    { week: "2026-10-19", orders: 0, avgDays: null }, { week: "2026-10-26", orders: 2, avgDays: 4 }, { week: "2026-11-02", orders: 0, avgDays: null },
  ]);
  const [{ text: wt }] = executedSql(wk);
  assert.match(wt, /date_trunc\('week', \(lab_orders\.shipped_at at time zone 'America\/Los_Angeles'\)::date\)/);
});
