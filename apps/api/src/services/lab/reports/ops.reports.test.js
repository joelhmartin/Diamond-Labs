import { test, afterEach } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../../../test/fake-tx.js";
import { executedSql } from "../../../test/sql-text.js";
import { OPERATIONS_REPORTS } from "./operations.reports.js";
import { PRODUCTIVITY_REPORTS } from "./productivity.reports.js";
import { DEPARTMENT_REPORTS } from "./departments.reports.js";
import { PLANNING_REPORTS } from "./planning.reports.js";

const ALL = [...OPERATIONS_REPORTS, ...PRODUCTIVITY_REPORTS, ...DEPARTMENT_REPORTS, ...PLANNING_REPORTS];
const report = (key) => ALL.find((r) => r.key === key);
const range = (from, to) => ({ from, to, previous: { from: "2000-01-01", to: "2000-01-31" } });
const ctx = (over = {}) => ({ page: null, now: new Date("2026-11-01T15:00:00Z"), today: "2026-11-01", tz: "America/Chicago", ...over });
const paged = (page) => ctx({ page: { limit: 50, offset: 0, sort: null, ...page } });
// Never patients, Rx form data, or any free-text note column (lab_order_events.note, hold_reason, lab_notes).
const PHI = /legacy_patient|patient_|form_data|notes|hold_reason|lab_notes|source_label|lab_order_events\.note\b|\bnote as\b/;

afterEach(() => { delete process.env.REPORTS_COVERAGE_FROM; });

test("tasks completed counts status events per byUserId per to-status in range, ignoring system (null) moves", async () => {
  const tx = fakeTx({ executes: [[
    { userId: "u1", user: "Ana", toStatus: "in_production", moves: "3" },
    { userId: "u1", user: "Ana", toStatus: "quality_check", moves: "2" },
    { userId: "u2", user: "Ben", toStatus: "shipped", moves: "1" },
  ]] });
  const out = await report("productivity.tasks-completed").run(tx, { range: range("2026-10-01", "2026-10-31") }, null, ctx());
  const [{ text, params }] = executedSql(tx);
  assert.match(text, /lab_order_events\.type = 'status'/);
  assert.match(text, /lab_order_events\.by_user_id is not null/);
  assert.match(text, /lab_order_events\.to_value as toStatus/);
  assert.match(text, /group by lab_order_events\.by_user_id, users\.name, lab_order_events\.to_value/);
  assert.match(text, /lab_order_events\.at >= /);
  assert.ok(params.includes("2026-10-01") && params.includes("2026-10-31"));
  assert.doesNotMatch(text, PHI);
  const ana = out.rows.find((r) => r.userId === "u1");
  assert.equal(ana.user, "Ana");
  assert.equal(ana.in_production, 3);
  assert.equal(ana.quality_check, 2);
  assert.equal(ana.shipped, 0);
  assert.equal(ana.total, 5);
  assert.equal(out.rows.find((r) => r.userId === "u2").total, 1);
  assert.equal(out.summary.total, 6);
  assert.equal(out.rows.length, 2);
});

test("case submission: digital when recordsMethod is set or a scan file exists, physical otherwise; shop and legacy orders count as unknown", async () => {
  const tx = fakeTx({ executes: [[{ day: "2026-10-02", digital: "3", physical: "1", unknown: "2" }]] });
  const out = await report("operations.case-submission").run(tx, { range: range("2026-10-01", "2026-10-03") }, null, ctx());
  const [{ text }] = executedSql(tx);
  assert.match(text, /left join rx_cases on lab_orders\.source = 'rx_case' and rx_cases\.id = lab_orders\.source_id/);
  const digital = /coalesce\(rx_cases\.records_method, ''\) <> '' or exists \(select 1 from rx_case_files where rx_case_files\.case_id = rx_cases\.id and rx_case_files\.kind = 'scan'\)/;
  assert.match(text, digital);
  assert.match(text, /filter \(where rx_cases\.id is not null and \(.*\)\) as digital/);
  assert.match(text, /filter \(where rx_cases\.id is not null and not \(.*\)\) as physical/);
  assert.match(text, /filter \(where rx_cases\.id is null\) as unknown/);
  assert.match(text, /lab_orders\.is_remake = false/);
  assert.match(text, /lab_orders\.received_at at time zone 'America\/Chicago'/);
  assert.doesNotMatch(text, PHI);
  assert.deepEqual(out.rows, [
    { day: "2026-10-01", digital: 0, physical: 0, unknown: 0, total: 0, digitalShare: 0 },
    { day: "2026-10-02", digital: 3, physical: 1, unknown: 2, total: 6, digitalShare: 0.75 },
    { day: "2026-10-03", digital: 0, physical: 0, unknown: 0, total: 0, digitalShare: 0 },
  ]);
  assert.deepEqual(out.summary, { day: "Total", digital: 3, physical: 1, unknown: 2, total: 6, digitalShare: 0.75 });
});

test("turnaround excludes unshipped and cancelled orders; median of [2,4,30] is 4", async () => {
  const tx = fakeTx({ executes: [[
    { month: "2026-10", category: "Night guards", orders: "3", avgDays: "12", medianDays: "4", isTotal: 0 },
    { month: null, category: null, orders: "3", avgDays: "12", medianDays: "4", isTotal: 1 },
  ]] });
  const out = await report("productivity.turnaround").run(tx, { range: range("2026-10-01", "2026-10-31") }, null, ctx());
  const [{ text }] = executedSql(tx);
  assert.match(text, /lab_orders\.status = 'shipped' and lab_orders\.shipped_at is not null/);
  assert.match(text, /percentile_cont\(0\.5\) within group \(order by x\.days\)/);
  assert.match(text, /\(\(lab_orders\.shipped_at at time zone 'America\/Chicago'\)::date - \(lab_orders\.received_at at time zone 'America\/Chicago'\)::date\)/);
  assert.match(text, /lab_orders\.shipped_at >= /);
  assert.match(text, /grouping sets \(\(x\.month, x\.category\), \(\)\)/);
  assert.deepEqual(out.rows, [{ month: "2026-10", category: "Night guards", orders: 3, avgDays: 12, medianDays: 4 }]);
  assert.deepEqual(out.summary, { month: "All", orders: 3, avgDays: 12, medianDays: 4 });
});

test("technician workload shows an Unassigned row", async () => {
  const tx = fakeTx({ executes: [[
    { assigneeUserId: "u1", assignee: "Ana", orders: "4", units: "9", pastDue: "1", dueSoon: "2", onHold: "0", rush: "1" },
    { assigneeUserId: null, assignee: "Unassigned", orders: "6", units: "11", pastDue: "2", dueSoon: "0", onHold: "1", rush: "0" },
  ]] });
  const out = await report("planning.technician-workload").run(tx, {}, null, ctx());
  const [{ text, params }] = executedSql(tx);
  assert.match(text, /coalesce\(assignee\.name, \$\d+\)/);
  assert.ok(params.includes("Unassigned"));
  assert.match(text, /left join users as assignee on assignee\.id = lab_orders\.assignee_user_id/);
  assert.match(text, /lab_orders\.status not in \('shipped', 'cancelled'\)/);
  assert.match(text, /group by lab_orders\.assignee_user_id, assignee\.name/);
  assert.deepEqual(out.rows.map((r) => [r.assignee, r.orders, r.units]), [["Ana", 4, 9], ["Unassigned", 6, 11]]);
  assert.deepEqual(out.summary, { assignee: "Total", orders: 10, units: 20, pastDue: 3, dueSoon: 2, onHold: 1, rush: 1 });
  assert.equal(report("planning.technician-workload").chart.type, "bar");
});

test("remakes report carries the history coverage notice", async () => {
  const rows = [{ labOrderId: "r1", orderNumber: 50010, receivedDay: "2026-10-03", originalId: "o1", originalNumber: 49001, client: "One", status: "received", assignee: "Ana" }];
  const run = (r, env) => {
    if (env) process.env.REPORTS_COVERAGE_FROM = env; else delete process.env.REPORTS_COVERAGE_FROM;
    return report("productivity.remakes").run(fakeTx({ executes: [rows, [{ orders: "40" }]] }), { range: r }, null, ctx());
  };
  const unset = await run(range("2026-10-01", "2026-10-31"));
  assert.match(unset.notice, /imported orders are not flagged as remakes/i);
  assert.match(unset.notice, /1 remake of 40 orders received \(2\.5%\)/);
  const before = await run(range("2026-10-01", "2026-10-31"), "2026-11-15");
  assert.match(before.notice, /before 2026-11-15/);
  const after = await run(range("2026-12-01", "2026-12-31"), "2026-11-15");
  assert.doesNotMatch(after.notice, /imported/);
  assert.deepEqual(unset.rows[0], {
    labOrderId: "r1", orderNumber: 50010, received: "2026-10-03", originalId: "o1", originalNumber: 49001, client: "One", status: { value: "received", label: "Received" }, assignee: "Ana",
  });
  const cols = Object.fromEntries(report("productivity.remakes").columns.map((c) => [c.id, c]));
  assert.equal(cols.orderNumber.link, "/lab/orders/{labOrderId}");
  assert.equal(cols.originalNumber.link, "/lab/orders/{originalId}");
});

test("productivity orders is server-paged with status and source filters and an id tiebreaker", async () => {
  const tx = fakeTx({ executes: [[{ total: "120" }], [{
    labOrderId: "o1", orderNumber: 50001, receivedDay: "2026-10-02", client: "One Dental", source: "rx_case", status: "shipped",
    dueDate: "2026-10-09", shippedDay: "2026-10-08", rush: false, isRemake: false, units: "2",
  }]] });
  const def = report("productivity.orders");
  assert.equal(def.paging, "server");
  assert.equal(def.featured, true);
  assert.ok(!def.params.some((p) => p.type === "lookup" && p.source === "client"), "the client lookup is admin only");
  const out = await def.run(tx, { range: range("2026-10-01", "2026-10-31"), status: ["shipped", "on_hold"], source: ["rx_case"] }, null, paged({ limit: 25, offset: 50, sort: { id: "client", desc: false } }));
  const [count, rows] = executedSql(tx);
  for (const q of [count, rows]) {
    assert.match(q.text, /lab_orders\.status in \(\$\d+, \$\d+\)/);
    assert.match(q.text, /lab_orders\.source in \(\$\d+\)/);
    assert.match(q.text, /lab_orders\.received_at >= /);
    assert.doesNotMatch(q.text, PHI);
  }
  assert.match(rows.text, /order by coalesce\(doctor_profiles\.company_name, users\.name\) asc nulls last, lab_orders\.id asc limit \$\d+ offset \$\d+/);
  assert.equal(out.total, 120);
  assert.deepEqual(out.rows[0], {
    labOrderId: "o1", orderNumber: 50001, received: "2026-10-02", client: "One Dental", source: { value: "rx_case", label: "Rx case" },
    status: { value: "shipped", label: "Shipped" }, dueDate: "2026-10-09", shipped: "2026-10-08", rush: "", remake: "", units: 2,
  });
  // No filter: no status/source clause.
  const plain = fakeTx({ executes: [[{ total: "0" }], []] });
  await def.run(plain, { range: range("2026-10-01", "2026-10-31") }, null, paged());
  assert.doesNotMatch(executedSql(plain)[0].text, /status in|source in/);
});

test("shipping is server-paged over shipments by lab-local created day, voided labels excluded", async () => {
  const tx = fakeTx({ executes: [[{ total: "3" }], [{
    id: "s1", createdDay: "2026-10-02", shippedDay: "2026-10-02", carrier: "ups", serviceName: "UPS Ground", trackingNumber: "1Z9",
    status: "in_transit", chargeCents: 1234, orders: "2", orderNumbers: "50001, 50002",
  }]] });
  const def = report("operations.shipping");
  assert.equal(def.paging, "server");
  const out = await def.run(tx, { range: range("2026-10-01", "2026-10-31") }, null, paged({ sort: { id: "charge", desc: true } }));
  const [, rows] = executedSql(tx);
  assert.match(rows.text, /shipments\.purchased_at >= /);
  assert.match(rows.text, /shipments\.status <> 'voided'/);
  assert.match(rows.text, /order by shipments\.charge_cents desc nulls last, shipments\.id desc/);
  assert.doesNotMatch(rows.text, /ship_to|label_data|PHI/);
  assert.deepEqual(out.rows[0], {
    id: "s1", created: "2026-10-02", shipped: "2026-10-02", carrier: "UPS", service: "UPS Ground", tracking: "1Z9",
    status: { value: "in_transit", label: "In transit" }, charge: 1234, orders: 2, orderNumbers: "50001, 50002",
  });
});

test("monitoring boards: open orders by department x status, unassigned department as its own row, wall display", async () => {
  const tx = fakeTx({ executes: [[
    { departmentId: "d1", department: "Model room", status: "received", orders: "2", pastDue: "1" },
    { departmentId: "d1", department: "Model room", status: "on_hold", orders: "1", pastDue: "1" },
    { departmentId: null, department: "No department", status: "in_production", orders: "4", pastDue: "0" },
  ]] });
  const def = report("departments.monitoring-boards");
  assert.equal(def.display, "wall");
  assert.equal(def.featured, true);
  assert.equal(def.chart.type, "stackedBar");
  const out = await def.run(tx, {}, null, ctx());
  const [{ text, params }] = executedSql(tx);
  assert.match(text, /lab_orders\.status not in \('shipped', 'cancelled'\)/);
  assert.match(text, /left join lab_departments on lab_departments\.id = lab_orders\.department_id/);
  assert.ok(params.includes("2026-11-01"), "past due is against the lab day from ctx.today");
  assert.deepEqual(out.rows, [
    { departmentId: "d1", department: "Model room", received: 2, in_production: 0, quality_check: 0, ready_to_ship: 0, on_hold: 1, total: 3, pastDue: 2 },
    { departmentId: null, department: "No department", received: 0, in_production: 4, quality_check: 0, ready_to_ship: 0, on_hold: 0, total: 4, pastDue: 0 },
  ]);
  assert.equal(out.summary.total, 7);
});

test("dept moved lists department events with names, never the event note", async () => {
  const tx = fakeTx({ executes: [[{ at: "2026-10-02T15:00:00.000Z", labOrderId: "o1", orderNumber: 50001, fromName: null, toName: "Model room", byName: null }]] });
  const out = await report("departments.moved").run(tx, { range: range("2026-10-01", "2026-10-31") }, null, ctx());
  const [{ text }] = executedSql(tx);
  assert.match(text, /lab_order_events\.type = 'department'/);
  assert.doesNotMatch(text, PHI);
  assert.deepEqual(out.rows[0], { at: "2026-10-02T15:00:00.000Z", labOrderId: "o1", orderNumber: 50001, from: "No department", to: "Model room", by: "System" });
  // byName null is "System"; a named mover keeps the name.
  assert.equal(out.rows[0].by, "System");
});

test("tbd orders: open orders with no due date", async () => {
  const tx = fakeTx({ executes: [[{ labOrderId: "o1", orderNumber: 50001, receivedDay: "2026-10-20", client: "One", status: "received", department: "No department", assignee: "Unassigned", rush: true }]] });
  const out = await report("operations.tbd-orders").run(tx, {}, null, ctx());
  const [{ text }] = executedSql(tx);
  assert.match(text, /lab_orders\.due_date is null/);
  assert.match(text, /lab_orders\.status not in \('shipped', 'cancelled'\)/);
  assert.equal(out.rows[0].daysOpen, 12);
  assert.equal(out.rows[0].rush, "Rush");
});

test("monthly orders pivots 12 months per client for the chosen year (default: ctx.today's year)", async () => {
  const tx = fakeTx({ executes: [[{ clientUserId: "d1", client: "One", month: "2026-02", orders: "3" }, { clientUserId: "d1", client: "One", month: "2026-10", orders: "1" }]] });
  const out = await report("productivity.monthly-orders").run(tx, {}, null, ctx());
  const [{ params }] = executedSql(tx);
  assert.ok(params.includes("2026-01-01") && params.includes("2026-12-31"));
  assert.deepEqual(out.rows[0], { clientUserId: "d1", client: "One", m01: 0, m02: 3, m03: 0, m04: 0, m05: 0, m06: 0, m07: 0, m08: 0, m09: 0, m10: 1, m11: 0, m12: 0, total: 4 });
  assert.equal(report("productivity.monthly-orders").columns.filter((c) => /^m\d\d$/.test(c.id)).length, 12);
});

test("every report in these groups is staff, links only to the lab order page, and selects no PHI", async () => {
  for (const def of ALL) {
    assert.equal(def.roles, undefined, def.key);
    for (const c of def.columns) if (c.link) assert.match(c.link, /^\/lab\/orders\/\{\w+\}$/, `${def.key}.${c.id}`);
  }
});
