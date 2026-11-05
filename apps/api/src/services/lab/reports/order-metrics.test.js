import { test } from "vitest";
import assert from "node:assert/strict";
import { isOverdue, TERMINAL_LAB_STATUSES, LAB_ORDER_STATUSES } from "@my-app/shared";
import { fakeTx } from "../../../test/fake-tx.js";
import { executedSql, renderSql, sqlText } from "../../../test/sql-text.js";
import {
  atRiskOrders, atRiskSql, boardDayCounts, dueByDay, dueSoonSql, isOpenOrder, ordersByDay, openUnitsByCategory, pastDueSql, shippedByDay, turnaroundDays,
  turnaroundAverage, turnaroundByWeek, weekStart,
} from "./order-metrics.js";

const PHI = /legacy_patient|patient_|form_data|notes|hold_reason|lab_notes|source_label|\bnote\b/;
const range = (from, to) => ({ from, to });

test("boardDayCounts agrees with isOverdue: an on-hold past-due order is past due (and on hold)", async () => {
  // The shared rule: only terminal statuses are exempt, so on hold past its date is overdue (the board shows it red).
  assert.equal(isOverdue("2026-10-30", "on_hold", "2026-11-01"), true);
  assert.equal(isOverdue("2026-10-30", "shipped", "2026-11-01"), false);
  assert.equal(isOverdue("2026-11-01", "received", "2026-11-01"), false);

  // The SQL twin excludes exactly the terminal statuses and compares the due date with today, strictly.
  const pd = sqlText(pastDueSql("2026-11-01"));
  assert.match(pd, /lab_orders\.status not in \('shipped', 'cancelled'\) and lab_orders\.due_date < \$1::date/);
  assert.deepEqual(TERMINAL_LAB_STATUSES, ["shipped", "cancelled"]);
  assert.doesNotMatch(pd, /on_hold/);
  // ...and every non-terminal status, on hold included, is "open".
  for (const s of LAB_ORDER_STATUSES) assert.equal(sqlText(isOpenOrder).includes(`'${s}'`), TERMINAL_LAB_STATUSES.includes(s), s);

  const tx = fakeTx({ executes: [[{ pastDue: "3", dueToday: "2", dueTomorrow: "1", onHold: "4", atRisk: "5" }]] });
  const out = await boardDayCounts(tx, "2026-11-01");
  assert.deepEqual(out, { pastDue: 3, dueToday: 2, dueTomorrow: 1, onHold: 4, atRisk: 5 });
  const [{ text, params }] = executedSql(tx);
  assert.equal((text.match(/count\(\*\) filter \(where/g) || []).length, 5, "one query, five FILTER clauses");
  assert.match(text, /filter \(where lab_orders\.status = 'on_hold'\) as onHold/);
  assert.match(text, /where lab_orders\.status not in \('shipped', 'cancelled'\)$/);
  // Lab days: today, tomorrow, and the at-risk horizon today + 2.
  for (const d of ["2026-11-01", "2026-11-02", "2026-11-03"]) assert.ok(params.includes(d), `missing ${d}`);
});

test("at risk is received or in production and due today through today+2; on hold is never at risk", () => {
  const { text, params } = renderSql(atRiskSql("2026-11-01"));
  assert.match(text, /lab_orders\.status in \('received', 'in_production'\) and lab_orders\.due_date between \$1::date and \$2::date/);
  assert.deepEqual(params, ["2026-11-01", "2026-11-03"]);
  assert.doesNotMatch(text, /on_hold/);
  // The same window as Technician Workload's "due soon".
  assert.equal(sqlText(dueSoonSql("2026-11-01")), "lab_orders.due_date between $1::date and $2::date");
});

test("a past-due in-production order is past due, not at risk", () => {
  // Due Oct 30, today Nov 1: below at risk's lower bound (today), inside past due (< today).
  const due = "2026-10-30";
  const [low, high] = renderSql(atRiskSql("2026-11-01")).params;
  assert.equal(due >= low && due <= high, false, "not in the at-risk window");
  assert.equal(isOverdue(due, "in_production", "2026-11-01"), true, "past due by the shared rule");
  assert.match(sqlText(pastDueSql("2026-11-01")), /due_date < \$1::date/);
});

test("atRiskOrders lists soonest due first and never selects notes or patients", async () => {
  const tx = fakeTx({ executes: [[{ id: "o1", orderNumber: 50001, client: "One Dental", status: "in_production", dueDate: "2026-11-02", rush: true }]] });
  const out = await atRiskOrders(tx, "2026-11-01", 10);
  assert.deepEqual(out, { rows: [{ id: "o1", orderNumber: 50001, client: "One Dental", status: "in_production", dueDate: "2026-11-02", rush: true }], truncated: false });
  const [{ text, params }] = executedSql(tx);
  assert.match(text, /order by lab_orders\.due_date, lab_orders\.rush desc, lab_orders\.order_number\s+limit \$\d+/);
  assert.ok(params.includes(11), "reads one past the limit to know whether more exist");
  assert.doesNotMatch(text, PHI);
});

test("turnaroundDays: lab-local calendar days; null when unshipped or cancelled", () => {
  // Received Oct 1 (Chicago), shipped 03:00 UTC Oct 5 = Oct 4 in Chicago: 3 days, not 4.
  assert.equal(turnaroundDays({ status: "shipped", receivedAt: "2026-10-01T15:00:00Z", shippedAt: "2026-10-05T03:00:00Z" }), 3);
  assert.equal(turnaroundDays({ status: "shipped", receivedAt: "2026-10-01T15:00:00Z", shippedAt: "2026-10-01T20:00:00Z" }), 0);
  assert.equal(turnaroundDays({ status: "in_production", receivedAt: "2026-10-01T15:00:00Z", shippedAt: null }), null);
  assert.equal(turnaroundDays({ status: "cancelled", receivedAt: "2026-10-01T15:00:00Z", shippedAt: "2026-10-03T15:00:00Z" }), null);
  assert.throws(() => turnaroundDays({}, { open: [] }), /business calendar/);
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
  assert.match(text, /lab_orders\.received_at at time zone 'America\/Chicago'/);
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
  assert.match(text, /avg\(greatest\(0, \(lab_orders\.shipped_at at time zone 'America\/Chicago'\)::date - \(lab_orders\.received_at at time zone 'America\/Chicago'\)::date\)\)/);

  assert.equal(weekStart("2026-11-05"), "2026-11-02"); // a Thursday -> its Monday
  assert.equal(weekStart("2026-11-02"), "2026-11-02");
  assert.equal(weekStart("2026-11-01"), "2026-10-26"); // Sunday belongs to the week before
  const wk = fakeTx({ executes: [[{ week: "2026-10-26", orders: "2", avgDays: "4" }]] });
  const weeks = await turnaroundByWeek(wk, range("2026-10-19", "2026-11-05"));
  assert.deepEqual(weeks, [
    { week: "2026-10-19", orders: 0, avgDays: null }, { week: "2026-10-26", orders: 2, avgDays: 4 }, { week: "2026-11-02", orders: 0, avgDays: null },
  ]);
  const [{ text: wt }] = executedSql(wk);
  assert.match(wt, /date_trunc\('week', \(lab_orders\.shipped_at at time zone 'America\/Chicago'\)::date\)/);
});
