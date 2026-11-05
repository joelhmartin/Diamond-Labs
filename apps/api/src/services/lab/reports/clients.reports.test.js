import { test } from "vitest";
import assert from "node:assert/strict";
import { STAFF_ROLES } from "@my-app/shared";
import { fakeTx } from "../../../test/fake-tx.js";
import { executedSql } from "../../../test/sql-text.js";
import { createRegistry } from "../../../modules/reports/registry.js";
import { registerLabReports } from "./index.js";
import { CLIENT_REPORTS } from "./clients.reports.js";
import { HEALTH_THRESHOLDS, clientHealthRows } from "./client-health.js";

const report = (key) => CLIENT_REPORTS.find((r) => r.key === key);
const range = (from, to) => ({ from, to, previous: { from: "2000-01-01", to: "2000-01-31" } });
// 03:00 UTC on Nov 2 2026 is 21:00 on Nov 1 in Chicago (CST, the day DST ended): the lab day is Nov 1.
const NOW = new Date("2026-11-02T03:00:00Z");

const healthRow = (over = {}) => ({
  clientUserId: "doc1", client: "One Dental", recent: "3", base: "12",
  m0: "1", m1: "2", m2: "3", m3: "2", m4: "1", m5: "3",
  lastOrderAt: "2026-10-30T15:00:00Z", lastOrderDay: "2026-10-30", turnaround: "4.5", ...over,
});

test("HEALTH_THRESHOLDS are the spec's constants", () => {
  assert.deepEqual(HEALTH_THRESHOLDS, { inactiveDays: 90, declining: 0.5, stable: 0.85 });
});

test("clientHealthRows: baseline is days 31–210 divided by 6; recent is the last 30 lab-local days", async () => {
  const tx = fakeTx({ executes: [[healthRow()], [{ clientUserId: "doc1", cents: "45000" }]] });
  const rows = await clientHealthRows(tx, { asOf: NOW });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.recent, 3);
  assert.equal(r.baseline, 2); // 12 orders over days 31–210, / 6
  assert.equal(r.trend, 1.5);
  assert.equal(r.band, "healthy");
  assert.equal(r.isNew, false);
  assert.equal(r.sales30Cents, 45000);
  assert.equal(r.avgTurnaroundDays, 4.5);
  assert.deepEqual(r.monthly, [1, 2, 3, 2, 1, 3]);
  assert.equal(r.lastOrderAt, "2026-10-30T15:00:00.000Z");

  const [health, sales] = executedSql(tx);
  // Lab day is Nov 1: recent = Oct 3..Nov 1, baseline = Apr 6..Oct 2 (days 31–210).
  for (const d of ["2026-10-03", "2026-11-01", "2026-04-06", "2026-10-02"]) assert.ok(health.params.includes(d), `missing ${d}`);
  assert.ok(!health.params.includes("2026-11-02"), "the UTC day must not be used");
  assert.match(health.text, /count\(\*\) filter \(where/);
  assert.match(health.text, /lab_orders\.status <> 'cancelled'/);
  assert.match(health.text, /users\.role = 'doctor'/);
  assert.doesNotMatch(health.text, /legacy_patient|notes|form_data/);
  // Sales over the same 30 lab days, one grouped query (not per client), on the sales rule.
  assert.match(sales.text, /status\s*=\s*'issued'/);
  assert.match(sales.text, /group by/);
  assert.ok(sales.params.includes("2026-10-03") && sales.params.includes("2026-11-01"));
});

test("clientHealthRows bands declining, inactive and new", async () => {
  const tx = fakeTx({ executes: [[
    healthRow({ clientUserId: "a", recent: "0", base: "12", lastOrderAt: "2026-09-01T15:00:00Z", lastOrderDay: "2026-09-01" }),
    healthRow({ clientUserId: "b", recent: "0", base: "12", lastOrderAt: "2026-05-01T15:00:00Z", lastOrderDay: "2026-05-01" }),
    healthRow({ clientUserId: "c", recent: "2", base: "0", turnaround: null }),
  ], []] });
  const rows = await clientHealthRows(tx, { asOf: NOW });
  const by = Object.fromEntries(rows.map((r) => [r.clientUserId, r]));
  assert.equal(by.a.band, "declining");
  assert.equal(by.b.band, "inactive");
  assert.equal(by.c.band, "healthy");
  assert.equal(by.c.isNew, true);
  assert.equal(by.c.avgTurnaroundDays, null);
  assert.equal(by.a.sales30Cents, 0);
});

test("inactive is MORE than 90 lab days in both Client Health and Inactive Clients", async () => {
  // Last order Aug 6 16:00 Chicago (CDT); asOf Nov 4 17:00 Chicago (CST): 90 lab days, 90 days + 2 h of wall clock.
  const asOf = new Date("2026-11-04T23:00:00Z");
  const at90 = healthRow({ clientUserId: "d90", lastOrderAt: "2026-08-06T21:00:00Z", lastOrderDay: "2026-08-06" });
  const at91 = healthRow({ clientUserId: "d91", lastOrderAt: "2026-08-05T21:00:00Z", lastOrderDay: "2026-08-05" });
  const rows = await clientHealthRows(fakeTx({ executes: [[at90, at91], []] }), { asOf });
  const by = Object.fromEntries(rows.map((r) => [r.clientUserId, r.band]));
  assert.notEqual(by.d90, "inactive");
  assert.equal(by.d91, "inactive");

  // The report lists a client when its last order is on or before today − 91 = Aug 5.
  const tx = fakeTx({ executes: [[{ clientUserId: "d91", client: "x", accountNumber: null, lastDay: "2026-08-05", lifetime: "0" }]] });
  const out = await report("clients.inactive").run(tx, {}, null, { now: asOf, today: "2026-11-04" });
  const [q] = executedSql(tx);
  assert.ok(q.params.includes("2026-08-05"), "Aug 5 (91 days) is inside the cut");
  assert.ok(!q.params.includes("2026-08-06"), "Aug 6 (90 days) is outside the cut");
  assert.equal(out.rows[0].daysSince, 91);
});

test("health report excludes clients who never ordered", async () => {
  const tx = fakeTx({ executes: [[healthRow()], []] });
  const out = await report("clients.health").run(tx, {}, null, { now: NOW });
  // The client set comes from an inner join of lab_orders to users: no order, no row.
  const [health] = executedSql(tx);
  assert.match(health.text, /from lab_orders\s+(inner )?join users on users\.id = lab_orders\.client_user_id/);
  assert.doesNotMatch(health.text, /left join lab_orders|from users/);
  assert.equal(out.rows.length, 1);
  assert.deepEqual(
    { band: out.rows[0].band, trend: out.rows[0].trend, sales30: out.rows[0].sales30, lastOrder: out.rows[0].lastOrder },
    { band: { value: "healthy", label: "Healthy" }, trend: 1.5, sales30: 0, lastOrder: "2026-10-30" },
  );
  assert.match(out.notice, /1 active \(0 declining, 0 inactive\)/);
  assert.equal(report("clients.health").featured, true);
});

test("bottom clients only considers clients with an order in the prior 12 months", async () => {
  const tx = fakeTx({ executes: [[{ clientUserId: "d2", client: "Quiet Dental", accountNumber: "7", invoices: "0", cents: "0", total: "40000" }]] });
  const out = await report("clients.bottom").run(tx, { range: range("2026-10-01", "2026-10-31"), count: 10 }, null, { now: NOW });
  const [{ text, params }] = executedSql(tx);
  // Eligible = a non-cancelled order received in the 12 months ending with the range.
  assert.match(text, /exists \(select 1 from lab_orders/);
  assert.match(text, /lab_orders\.status <> 'cancelled'/);
  assert.ok(params.includes("2025-11-01") && params.includes("2026-10-31"));
  assert.match(text, /order by .* asc/);
  assert.ok(params.includes(10));
  assert.deepEqual(out.rows[0], { rank: 1, clientUserId: "d2", client: "Quiet Dental", accountNumber: "7", invoices: 0, sales: 0, share: 0 });
});

test("top clients ranks by sales with the count param (default 25)", async () => {
  const tx = fakeTx({ executes: [[
    { clientUserId: "d1", client: "Big", accountNumber: "1", invoices: "4", cents: "30000", total: "40000" },
    { clientUserId: "d2", client: "Small", accountNumber: "2", invoices: "1", cents: "10000", total: "40000" },
  ]] });
  const out = await report("clients.top").run(tx, { range: range("2026-10-01", "2026-10-31") }, null, { now: NOW });
  assert.deepEqual(out.rows.map((r) => [r.rank, r.client, r.sales, r.share]), [[1, "Big", 30000, 0.75], [2, "Small", 10000, 0.25]]);
  const [{ text, params }] = executedSql(tx);
  assert.match(text, /order by .* desc/);
  assert.ok(params.includes(25));
  const count = report("clients.top").params.find((p) => p.name === "count");
  assert.deepEqual([count.default, count.min, count.max], [25, 1, 500]);
});

test("inactive clients default to 90 days and honour the days param", async () => {
  const row = { clientUserId: "d1", client: "Gone Dental", accountNumber: "3", lastDay: "2026-07-01", lifetime: "123400" };
  const def = await report("clients.inactive").run(fakeTx({ executes: [[row]] }), {}, null, { now: NOW });
  assert.deepEqual(def.rows[0], { clientUserId: "d1", client: "Gone Dental", accountNumber: "3", lastOrder: "2026-07-01", daysSince: 123, lifetimeSales: 123400 });

  const tx90 = fakeTx({ executes: [[]] });
  await report("clients.inactive").run(tx90, {}, null, { now: NOW });
  // Lab day Nov 1, 90 days: listed only when MORE than 90 lab days have passed (activityHealth's
  // inactive rule), so the last order is on or before Aug 2 (91 days ago), before the start of Aug 3.
  const [q90] = executedSql(tx90);
  assert.ok(q90.params.includes("2026-08-02"));
  assert.ok(!q90.params.includes("2026-08-03"), "an order exactly 90 days ago is not inactive yet");
  assert.match(q90.text, /having max\(lab_orders\.received_at\) </);

  const tx30 = fakeTx({ executes: [[]] });
  await report("clients.inactive").run(tx30, { days: 30 }, null, { now: NOW });
  assert.ok(executedSql(tx30)[0].params.includes("2026-10-01"));
  assert.match(report("clients.inactive").description, /more than/);
  assert.equal(report("clients.inactive").params.find((p) => p.name === "days").default, 90);
});

test("new client orders: first-ever order inside the range only", async () => {
  const tx = fakeTx({ executes: [[{ clientUserId: "d9", client: "New Dental", accountNumber: null, firstDay: "2026-10-12", firstOrderId: "lo1", firstOrderNumber: 50012, orders: "2" }]] });
  const out = await report("clients.new-orders").run(tx, { range: range("2026-10-01", "2026-10-31") }, null, { now: NOW });
  const [{ text, params }] = executedSql(tx);
  // The first order is over ALL of the client's non-cancelled orders (no range in WHERE), tested in HAVING.
  assert.match(text, /having min\(lab_orders\.received_at\) >= /);
  assert.match(text, /where lab_orders\.status <> 'cancelled'\s+group by/);
  assert.ok(params.includes("2026-10-01") && params.includes("2026-10-31"));
  assert.deepEqual(out.rows[0], { clientUserId: "d9", client: "New Dental", accountNumber: null, firstOrder: "2026-10-12", firstOrderId: "lo1", firstOrderNumber: 50012, orders: 2 });
  assert.equal(report("clients.new-orders").columns.find((c) => c.id === "firstOrderNumber").link, "/lab/orders/{firstOrderId}");
});

test("no recent sales: sales in the 12 months before the window and none inside it", async () => {
  const tx = fakeTx({ executes: [[{ clientUserId: "d1", client: "Lapsed", accountNumber: "4", prior: "50000", lastDay: "2026-06-30" }]] });
  const out = await report("clients.no-recent-sales").run(tx, {}, null, { now: NOW });
  const [{ text, params }] = executedSql(tx);
  // 90 days through Nov 1 = Aug 4..Nov 1; the prior 12 months = Aug 4 2025..Aug 3 2026.
  for (const d of ["2026-08-04", "2026-11-01", "2025-08-04", "2026-08-03"]) assert.ok(params.includes(d), `missing ${d}`);
  assert.match(text, /status\s*=\s*'issued'/);
  assert.match(text, /having count\(\*\) filter/);
  assert.deepEqual(out.rows[0], { clientUserId: "d1", client: "Lapsed", accountNumber: "4", priorSales: 50000, lastSale: "2026-06-30" });
});

test("clients list shows no money and doctors list shows practice names, not ids", async () => {
  for (const key of ["clients.list", "clients.doctors"]) {
    assert.ok(!report(key).columns.some((c) => c.type === "money"), `${key} has a money column`);
    assert.equal(report(key).roles, undefined); // registry default = staff
  }
  const tx = fakeTx({ executes: [[{ userId: "d1", doctor: "Dr One", practice: "One Dental", accountNumber: "1", status: "active", accounts: "One Dental PLLC, Two Dental", accountCount: "2" }]] });
  const out = await report("clients.doctors").run(tx, {}, null, {});
  const [{ text }] = executedSql(tx);
  assert.match(text, /string_agg\(accounts\.name/);
  assert.match(text, /memberships\.status = 'active'/);
  assert.equal(out.rows[0].accounts, "One Dental PLLC, Two Dental");
  assert.equal(out.rows[0].accountCount, 2);
});

test("registerLabReports registers the 12 new keys with the right roles", () => {
  const registry = createRegistry({ defaultRoles: STAFF_ROLES });
  registerLabReports(registry);
  const staff = ["clients.list", "clients.doctors", "products.units", "products.units-detail"];
  const admin = [
    "clients.health", "clients.top", "clients.bottom", "clients.inactive", "clients.new-orders", "clients.no-recent-sales",
    "products.price-list", "products.sold",
  ];
  const lab = { id: "u1", role: "lab" };
  const boss = { id: "u2", role: "admin" };
  for (const key of [...staff, ...admin]) {
    const def = registry.getReport(key);
    assert.ok(def, `${key} not registered`);
    assert.equal(registry.canView(boss, def), true, `${key} admin`);
    assert.equal(registry.canView(lab, def), staff.includes(key), `${key} lab`);
  }
  assert.equal(registry.getReport("products.units-detail").paging, "server");
});
