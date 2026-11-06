/**
 * The 14 reports that read the later pieces' data (pieces 6, 7, 8 and 10),
 * and the enrichments those pieces brought to existing reports. Fake
 * transactions only: `selects` answer drizzle reads (calendar, plans, tags,
 * pricing), `executes` answer the reports' own SQL.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { STAFF_ROLES, LAB_TIMEZONE } from "@my-app/shared";
import { createRegistry } from "../../../modules/reports/registry.js";
import { runReport, createRunSlots, ReportError } from "../../../modules/reports/runner.js";
import { capacityFor, toCalendar } from "../../../modules/business-calendar/index.js";
import { planWith } from "../../../modules/workflows/index.js";
import { fakeTx, fakeDb } from "../../../test/fake-tx.js";
import { executedSql } from "../../../test/sql-text.js";
import { LAB_CAPABILITIES, registerLabReports } from "./index.js";
import { NO_REP, NO_REPS_NOTICE } from "./sales.reports.js";

const boss = { id: "u1", role: "admin" };
const NOW = new Date("2026-11-05T17:00:00Z"); // Thursday, 11:00 in Chicago
const ctx = (over = {}) => ({ now: NOW, today: "2026-11-05", tz: LAB_TIMEZONE, ...over });
const PHI = /legacy_patient|patient_|form_data|notes|hold_reason|lab_notes|cancel_reason|delivery_notes|source_label|\bnote\b/;

/** Weekends closed; capacity 10 units Monday to Friday. */
const CAL_ROW = {
  key: "default", timezone: LAB_TIMEZONE, leadDays: 0, closedWeekdays: [0, 6],
  capacityBasis: "units", capacityByWeekday: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 },
};
const calendarSelects = (row = CAL_ROW, holidays = []) => [[row], holidays];

const reg = (() => {
  const r = createRegistry({ defaultRoles: STAFF_ROLES });
  registerLabReports(r);
  return r;
})();
const report = (key) => reg.getReport(key);

const TEMPLATE = {
  key: "std", name: "Standard", totalDays: 6, rushWorkflowKey: null, isDefault: true, active: true,
  stages: [
    { key: "model", label: "Models", milestone: "in_production", dayOffset: 1 },
    { key: "build", label: "Build", milestone: "quality_check", dayOffset: 3 },
    { key: "ship", label: "Ship", milestone: "shipped", dayOffset: 6 },
  ],
};
/** A plan exactly as planFor saves it, started on a lab day. */
const planOn = (day) => planWith({ std: TEMPLATE }, { workflowKey: "std", startAt: new Date(`${day}T17:00:00Z`) }, toCalendar(CAL_ROW));
const planned = (id, n, status, plan, over = {}) => ({
  labOrderId: id, orderNumber: n, client: "One Dental", status, heldFrom: null, dueDate: plan.dueAt,
  assigneeUserId: "t1", assignee: "Tech One", departmentId: "d1", department: "Design", stages: plan.stages, ...over,
});

test("capability provided -> report available and runs; stub UNAVAILABLE path deleted", async () => {
  const listed = reg.listReports(boss);
  assert.equal(listed.filter((d) => !d.available).length, 0);
  for (const c of LAB_CAPABILITIES) assert.ok(reg.hasCapability(c), c);
  assert.equal(existsSync(new URL("./dependent.js", import.meta.url)), false, "the stub helper is gone");
  const out = await report("operations.production-tasks").run(fakeTx({ selects: calendarSelects(), executes: [[]] }), {}, boss, ctx());
  assert.deepEqual(out.rows, []);
});

test("tasks schedule lists planFor stage targets per day for the next 14 lab days", async () => {
  const mon = planOn("2026-11-02"); // Models Tue 11-03, Build Thu 11-05, Ship Tue 11-10
  const wed = planOn("2026-11-04"); // Models Thu 11-05, Build Mon 11-09, Ship Thu 11-12
  assert.deepEqual(mon.stages.map((s) => s.targetAt), ["2026-11-03", "2026-11-05", "2026-11-10"]);
  const rows = [
    planned("o1", 50001, "received", mon), // behind: Models (11-03) not reached
    planned("o2", 50002, "in_production", wed, { departmentId: null, department: "No department" }),
  ];
  const tx = fakeTx({ selects: calendarSelects(), executes: [rows] });
  const out = await report("planning.tasks-schedule").run(tx, { days: 14 }, boss, ctx());
  // 14 open days from Thursday 11-05, weekends skipped: through Tuesday 11-24.
  assert.equal(out.notice, "Lab days 2026-11-05 to 2026-11-24.");
  assert.deepEqual(out.rows, [
    { day: "2026-11-05", stage: "Build", department: "Design", targets: 1, behind: 1 },
    { day: "2026-11-09", stage: "Build", department: "No department", targets: 1, behind: 0 },
    { day: "2026-11-10", stage: "Ship", department: "Design", targets: 1, behind: 1 },
    { day: "2026-11-12", stage: "Ship", department: "No department", targets: 1, behind: 0 },
  ], "reached stages (o2's Models) and stages before today (o1's Models) are not on the schedule");
  assert.deepEqual(out.summary, { day: "Total", targets: 4, behind: 2 });
  const [{ text, params }] = executedSql(tx);
  assert.match(text, /join workflow_plans on workflow_plans\.record_type = \$\d+ and workflow_plans\.record_id = lab_orders\.id/);
  assert.ok(params.includes("lab_order"));
  assert.match(text, /jsonb_array_elements\(workflow_plans\.stages\)/);
  assert.ok(params.includes("2026-11-05") && params.includes("2026-11-24"));
  assert.match(text, /lab_orders\.status not in \('shipped', 'cancelled'\)/);
  assert.doesNotMatch(text, PHI);
});

test("calendar compares due units to capacityFor(date)", async () => {
  const cal = toCalendar(CAL_ROW);
  // Selects: calendar row, holidays, orders due per day (grouped), unit lines.
  const tx = fakeTx({ selects: [
    ...calendarSelects(), [{ dueDate: "2026-11-05", n: 3 }, { dueDate: "2026-11-07", n: 1 }],
    [{ dueDate: "2026-11-05", qty: 6, noteOnly: false }, { dueDate: "2026-11-05", qty: 2, noteOnly: false }, { dueDate: "2026-11-05", qty: 9, noteOnly: true }, { dueDate: "2026-11-07", qty: 1, noteOnly: false }],
  ] });
  const out = await report("planning.calendar").run(tx, { days: 3 }, boss, ctx());
  assert.deepEqual(out.rows, [
    { day: "2026-11-05", orders: 3, units: 8, capacity: capacityFor("2026-11-05", cal), load: 0.8, note: "" },
    { day: "2026-11-06", orders: 0, units: 0, capacity: 10, load: 0, note: "" },
    { day: "2026-11-07", orders: 1, units: 1, capacity: capacityFor("2026-11-07", cal), load: null, note: "Closed" },
  ]);
  assert.equal(capacityFor("2026-11-05", cal), 10);
  assert.equal(capacityFor("2026-11-07", cal), 0);
  assert.match(out.notice, /Capacity counts units/);
  assert.equal(report("planning.calendar").columns[0].link, "/lab/calendar?view=week&anchor={day}");
  // No capacity configured: no load at all.
  const none = fakeTx({ selects: [...calendarSelects({ ...CAL_ROW, capacityBasis: "none" }), [], []] });
  const flat = await report("planning.calendar").run(none, { days: 1 }, boss, ctx());
  assert.deepEqual(flat.rows[0], { day: "2026-11-05", orders: 0, units: 0, capacity: null, load: null, note: "" });
  assert.match(flat.notice, /No daily capacity/);
});

test("sales by rep groups by the client's rep tag; untagged clients show \"No rep\"", async () => {
  const tag = (id, label, position) => ({ id, recordType: "client_rep", label, color: "slate", position, active: true });
  const tx = fakeTx({
    executes: [[
      { clientUserId: "c1", invoices: "2", cents: "30000" }, { clientUserId: "c2", invoices: "1", cents: "10000" },
      { clientUserId: "c3", invoices: "4", cents: "50000" }, { clientUserId: null, invoices: "1", cents: "10000" },
    ]],
    // tagsFor: c1 and c3 with Alice; c3 also Bob (counted under its first rep only); c2 untagged.
    selects: [[{ recordId: "c1", tag: tag("t1", "Alice", 0) }, { recordId: "c3", tag: tag("t1", "Alice", 0) }, { recordId: "c3", tag: tag("t2", "Bob", 1) }]],
  });
  const out = await report("sales.by-rep").run(tx, { range: { from: "2026-10-01", to: "2026-10-31" } }, boss, ctx());
  assert.deepEqual(out.rows, [
    { rep: "Alice", clients: 2, invoices: 6, sales: 80000, share: 0.8 },
    { rep: NO_REP, clients: 1, invoices: 2, sales: 20000, share: 0.2 },
  ]);
  assert.equal(NO_REP, "No rep");
  assert.deepEqual(out.summary, { rep: "Total", clients: 3, invoices: 8, sales: 100000, share: 1 });
  const [{ text }] = executedSql(tx);
  assert.match(text, /invoices\.status = 'issued'/, "the one sales rule");
  const tagRead = tx.log.find((e) => e.op === "select");
  assert.ok(tagRead, "rep tags are read with tagsFor in the report's transaction");
  assert.deepEqual(report("sales.by-rep").roles, ["admin"]);
  assert.equal(out.notice, undefined, "reps exist, so no set-up notice");
});

test("sales by rep says so when no rep is defined at all, and stays quiet when reps exist but none is assigned", async () => {
  const sales = [{ clientUserId: "c1", invoices: "1", cents: "10000" }];
  const range = { range: { from: "2026-10-01", to: "2026-10-31" } };
  // Selects: tagsFor (no client tagged), then the rep definitions.
  const none = fakeTx({ executes: [sales], selects: [[], []] });
  const out = await report("sales.by-rep").run(none, range, boss, ctx());
  assert.deepEqual(out.rows.map((r) => r.rep), [NO_REP]);
  assert.equal(out.notice, NO_REPS_NOTICE);
  assert.match(out.notice, /No sales reps are set up yet/);
  const defined = fakeTx({ executes: [sales], selects: [[], [{ id: "t1", recordType: "client_rep", label: "Alice", color: "slate", position: 0, active: true }]] });
  assert.equal((await report("sales.by-rep").run(defined, range, boss, ctx())).notice, undefined);
});

test("assigned and department task reports judge each stage target by piece 7's rule: done, behind or to do", async () => {
  const plan = planOn("2026-11-02"); // Models 11-03, Build 11-05, Ship 11-10
  const rows = [planned("o1", 50001, "in_production", plan), planned("o2", 50002, "received", plan, { assigneeUserId: null, assignee: "Unassigned", departmentId: "d2", department: "Print" })];
  const range = { from: "2026-11-02", to: "2026-11-06" };
  const run = (key, params = {}) => report(key).run(fakeTx({ selects: calendarSelects(), executes: [rows] }), { range, ...params }, boss, ctx());

  const tasks = await run("planning.assigned-tasks");
  assert.deepEqual(tasks.rows.map((r) => [r.assignee, r.orderNumber, r.stage, r.state.label]), [
    ["Tech One", 50001, "Models", "Done"], ["Tech One", 50001, "Build", "To do"],
    ["Unassigned", 50002, "Models", "Behind"], ["Unassigned", 50002, "Build", "To do"],
  ]);
  const summary = await run("planning.assigned-tasks-summary");
  assert.deepEqual(summary.rows, [
    { assigneeUserId: "t1", assignee: "Tech One", due: 2, done: 1, behind: 0 },
    { assigneeUserId: null, assignee: "Unassigned", due: 2, done: 0, behind: 1 },
  ]);
  assert.deepEqual(summary.summary, { assignee: "Total", due: 4, done: 1, behind: 1 });
  const depts = await run("departments.tasks-summary");
  assert.deepEqual(depts.rows.map((r) => [r.department, r.due, r.done, r.behind]), [["Design", 2, 1, 0], ["Print", 2, 0, 1]]);
  const dept = await run("departments.tasks", { department: "d1" });
  assert.equal(dept.rows.length, 4, "the fake answers both orders; the filter is in SQL");
  const tx = fakeTx({ selects: calendarSelects(), executes: [[]] });
  await report("departments.tasks").run(tx, { range, department: "d1" }, boss, ctx());
  assert.match(executedSql(tx)[0].text, /lab_orders\.department_id = \$\d+/);
  const daily = await report("operations.daily-tasks").run(fakeTx({ selects: calendarSelects(), executes: [rows] }), {}, boss, ctx());
  assert.deepEqual(daily.rows.map((r) => [r.orderNumber, r.stage, r.target]), [[50001, "Build", "2026-11-05"], [50002, "Build", "2026-11-05"]]);
});

test("production tasks: each open order at its first unreached stage, business days behind, most behind first", async () => {
  const late = planOn("2026-10-26"); // Models 10-27, Build 10-29, Ship 11-03
  const fresh = planOn("2026-11-04"); // Models 11-05
  const rows = [planned("o1", 50001, "in_production", late), planned("o2", 50002, "received", fresh)];
  const out = await report("operations.production-tasks").run(fakeTx({ selects: calendarSelects(), executes: [rows] }), {}, boss, ctx());
  // o1 reached Models; its Build target 10-29 (Thu) -> today 11-05 (Thu) is 5 business days.
  assert.deepEqual(out.rows.map((r) => [r.orderNumber, r.stage, r.target, r.daysBehind]), [[50001, "Build", "2026-10-29", 5], [50002, "Models", "2026-11-05", 0]]);
});

test("pan numbers, pickups and deliveries read pieces 6 and 8 without notes or patients", async () => {
  const pan = fakeTx({ executes: [[{ total: "1" }], [{ labOrderId: "o1", pan: "P-12", orderNumber: 50001, client: "One", status: "in_production", dueDate: "2026-11-09" }]] });
  const pans = await report("operations.pan-numbers").run(pan, { openOnly: true }, boss, ctx({ page: { limit: 50, offset: 0, sort: null } }));
  assert.equal(pans.total, 1);
  assert.deepEqual(pans.rows[0], { labOrderId: "o1", pan: "P-12", orderNumber: 50001, client: "One", status: { value: "in_production", label: "In production" }, dueDate: "2026-11-09" });
  for (const { text } of executedSql(pan)) {
    assert.match(text, /lab_orders\.pan_number is not null/);
    assert.doesNotMatch(text, PHI);
  }
  assert.match(executedSql(pan)[1].text, /order by lab_orders\.pan_number asc nulls last, lab_orders\.id asc/);

  const pk = fakeTx({ executes: [[{ pickupId: "p1", pickupNumber: 7, day: "2026-11-06", client: "One", status: "scheduled", earliest: "2026-11-05", latest: "2026-11-07", time: "am", boxes: 2, driver: "Dan" }]] });
  const picks = await report("operations.pickups").run(pk, { range: { from: "2026-11-01", to: "2026-11-30" } }, boss, ctx());
  assert.deepEqual(picks.rows[0], {
    pickupId: "p1", pickupNumber: 7, day: "2026-11-06", client: "One", status: { value: "scheduled", label: "Scheduled" },
    window: "2026-11-05 to 2026-11-07", time: "Morning", boxes: 2, driver: "Dan",
  });
  const [{ text: pkText }] = executedSql(pk);
  assert.doesNotMatch(pkText, PHI);
  assert.doesNotMatch(pkText, /pickups\.address|pickups\.notes/);

  // Deliveries: listStops in the report's transaction. Orders, pickups, then the practices.
  const dl = fakeTx({ selects: [
    [{ id: "o1", orderNumber: 50001, status: "in_production", version: 3, dueDate: "2026-11-05", shippedAt: null, clientUserId: "c1", accountId: "acct1", deliveryMethod: "local_delivery" }],
    [{ id: "p1", pickupNumber: 7, boxCount: 2, clientUserId: "c1", partyKey: "practice:acct1", scheduledDate: "2026-11-05", version: 1 }],
    [{ id: "c1", seazonaClientId: "SZ1", name: "Dr One", companyName: "One Dental", address1: "1 Main St", city: "Austin", state: "TX", zip: "78701", deliveryNotes: "gate code 1234" }],
  ] });
  const route = await report("operations.deliveries").run(dl, { range: { from: "2026-11-05", to: "2026-11-05" } }, boss, ctx());
  assert.deepEqual(route.rows, [{
    day: "2026-11-05", stop: 1, client: "One Dental", address: "1 Main St, Austin, TX 78701", status: { value: "on_time", label: "On time" },
    orders: 1, orderNumbers: "50001", pickups: 1, boxes: 2,
  }]);
  assert.ok(!JSON.stringify(route).includes("gate code"), "the practice's delivery notes never reach the report");
  assert.equal(report("operations.deliveries").params[0].maxDays, 63, "listStops' 62-day span, inclusive");
});

test("deliveries: a preset longer than 63 days is INVALID on the range, never a 500", async () => {
  const run = (query) => runReport({
    registry: reg, db: fakeDb(fakeTx({ selects: [] })), key: "operations.deliveries", query, actor: boss, now: NOW, tz: LAB_TIMEZONE, slots: createRunSlots(),
  });
  for (const range of ["ytd", "last12m", "lastYear"]) {
    await assert.rejects(run({ range }), (err) => err instanceof ReportError && err.code === "INVALID" && err.field === "range", range);
  }
  assert.ok(Array.isArray((await run({ range: "last30" })).rows));
  // listStops' own refusal is mapped at the report boundary too (a range the param check let through).
  await assert.rejects(
    report("operations.deliveries").run(fakeTx(), { range: { from: "2026-11-05", to: "2027-02-01" } }, boss, ctx()),
    (err) => err instanceof ReportError && err.code === "INVALID" && err.field === "range" && /62 days/.test(err.message),
  );
});

test("materials used lists piece 6's materials and lots per line, staff (no money columns)", async () => {
  const tx = fakeTx({ executes: [[{ labOrderId: "o1", orderNumber: 50001, receivedDay: "2026-11-02", product: "Night guard", qty: 1, material: "PMMA puck", lot: "L-77" }]] });
  const out = await report("products.materials").run(tx, { range: { from: "2026-11-01", to: "2026-11-05" } }, boss, ctx());
  assert.deepEqual(out.rows[0], { labOrderId: "o1", orderNumber: 50001, received: "2026-11-02", product: "Night guard", material: "PMMA puck", lot: "L-77", qty: 1 });
  const [{ text }] = executedSql(tx);
  assert.match(text, /from lab_order_line_materials\s+join lab_order_lines on lab_order_lines\.id = lab_order_line_materials\.lab_order_line_id/);
  assert.doesNotMatch(text, PHI);
  const def = report("products.materials");
  assert.equal(def.roles, undefined);
  assert.ok(def.columns.every((c) => c.type !== "money"));
});

test("same pricing wraps piece 10's sameClientPricingGroups in the report's transaction", async () => {
  // Selects: clients, then client prices, assigned lists, list items (loadClientPriceStates).
  const tx = fakeTx({ selects: [
    [{ id: "c1", name: "Dr One", email: "a@x", accountNumber: "A1", practice: "One Dental" }, { id: "c2", name: "Dr Two", email: "b@x", accountNumber: "A2", practice: null }, { id: "c3", name: "Dr Three", email: "c@x", accountNumber: "A3", practice: "Three" }],
    [],
    [{ clientUserId: "c1", listId: "l1", name: "Gold", archivedAt: null, position: 0 }, { clientUserId: "c2", listId: "l1", name: "Gold", archivedAt: null, position: 0 }],
    [{ listId: "l1", variantId: "v1", priceCents: 9000 }],
  ] });
  const out = await report("clients.same-pricing").run(tx, {}, boss, ctx());
  assert.deepEqual(out.rows, [{ priceSet: "Gold", clients: 2, clientNames: "One Dental, Dr Two", overrides: 0 }]);
  assert.equal(tx.log.filter((e) => e.op === "select").length, 4, "every read went through the report's transaction");
  assert.deepEqual(report("clients.same-pricing").roles, ["admin"]);
});

test("enrichments: discounts carry the reason, orders filter by a label, price list shows a named list", async () => {
  const disc = fakeTx({ executes: [[{ day: "2026-11-02", invoiceId: "i1", invoiceNumber: 7001, clientUserId: "c1", client: "One", reason: null, description: "Courtesy", amount: "-500" }]] });
  const d = await report("accounting.discounts").run(disc, { range: { from: "2026-11-01", to: "2026-11-05" } }, boss, ctx());
  assert.equal(d.rows[0].reason, "Other");
  const [{ text: dt }] = executedSql(disc);
  assert.match(dt, /from adjustment_reasons\s+where adjustment_reasons\.applies_to in \('discount', 'both'\)/);
  assert.match(dt, /starts_with\(lower\(invoice_lines\.description\), lower\(adjustment_reasons\.label\) \|\| ' — '\)/);
  assert.doesNotMatch(dt, /price_note|legacy_description/);

  const ord = fakeTx({ executes: [[{ total: "1" }], [{ labOrderId: "o1", orderNumber: 50001, receivedDay: "2026-11-02", source: "rx_case", status: "received", units: "1" }]], selects: [[{ recordId: "o1", tag: { id: "t9", recordType: "lab_order", label: "Rush review", color: "red", position: 0, active: true } }]] });
  const o = await report("productivity.orders").run(ord, { range: { from: "2026-11-01", to: "2026-11-05" }, tag: "t9" }, boss, ctx({ page: { limit: 50, offset: 0, sort: null } }));
  assert.equal(o.rows[0].tags, "Rush review");
  for (const { text, params } of executedSql(ord)) {
    assert.match(text, /exists \(select 1 from record_tags where \(record_tags\.record_type = \$\d+ and record_tags\.record_id = lab_orders\.id and record_tags\.tag_id in \(\$\d+\)\)\)/);
    assert.ok(params.includes("lab_order") && params.includes("t9"));
  }
  assert.ok(report("productivity.orders").params.some((p) => p.name === "tag" && p.type === "lookup" && p.source === "tag"));
  assert.equal(reg.getLookup("tag").roles, undefined, "the label lookup is staff");

  const pl = fakeTx({ executes: [[{ family: "Night", category: null, variant: "Hard", code: "2608", basePriceCents: 12500, listPriceCents: 9900, active: true }], [{ name: "Gold", archivedAt: null }]] });
  const p = await report("products.price-list").run(pl, { priceList: "l1" }, boss, ctx());
  assert.equal(p.rows[0].listPrice, 9900);
  assert.match(p.notice, /List prices from "Gold"/);
  assert.match(executedSql(pl)[0].text, /left join price_list_items on price_list_items\.price_list_id = \$1 and price_list_items\.variant_id = product_variants\.id/);
  assert.deepEqual(reg.getLookup("priceList").roles, ["admin"]);
});
