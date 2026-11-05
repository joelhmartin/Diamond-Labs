import { test } from "vitest";
import assert from "node:assert/strict";
import { STAFF_ROLES, LAB_TIMEZONE } from "@my-app/shared";
import { createRegistry } from "../../../modules/reports/registry.js";
import { createRunSlots } from "../../../modules/reports/runner.js";
import { resolveDashboard, createDashboardCache } from "../../../modules/reports/dashboards.js";
import { fakeTx, fakeDb } from "../../../test/fake-tx.js";
import { executedSql } from "../../../test/sql-text.js";
import { registerLabReports } from "./index.js";
import { LAB_METRICS, sameDayLastYear, monthToDateBefore, reportHref } from "./dashboards.js";

const boss = { id: "u1", role: "admin" };
const lab = { id: "u2", role: "lab" };
const NOW = new Date("2026-11-05T17:00:00Z"); // 11:00 in Chicago
const ctx = (over = {}) => ({ now: NOW, today: "2026-11-05", tz: LAB_TIMEZONE, ...over });
const metric = (key) => LAB_METRICS.find((m) => m.key === key);

function registry() {
  const r = createRegistry({ defaultRoles: STAFF_ROLES });
  registerLabReports(r);
  return r;
}

/** Every query answers [] (zeros): enough to resolve a whole dashboard. */
const resolve = (reg, key, actor) => resolveDashboard({
  registry: reg, db: fakeDb(fakeTx({ executes: [] })), key, actor, now: NOW, tz: LAB_TIMEZONE,
  cache: createDashboardCache(), slots: createRunSlots(),
});

test("pulse for a lab user has no money tiles", async () => {
  const reg = registry();
  const forLab = await resolve(reg, "pulse", lab);
  const ids = forLab.tiles.map((t) => t.id);
  assert.ok(!ids.includes("sales-today"), "sales today is absent, not $0");
  assert.ok(forLab.tiles.every((t) => t.data?.format !== "money"));
  assert.deepEqual(ids, ["past-due", "at-risk", "new-today", "shipped-today", "shipped-yesterday", "on-hold", "at-risk-list", "feed"]);
  for (const t of forLab.tiles) assert.equal(t.ok, true, `${t.id}: ${t.error?.message}`);

  const forAdmin = await resolve(reg, "pulse", boss);
  assert.ok(forAdmin.tiles.map((t) => t.id).includes("sales-today"));
  for (const t of forAdmin.tiles) assert.equal(t.ok, true, `${t.id}: ${t.error?.message}`);
});

test("dashboards: Pulse first, Insights and Sales admin only; every tile resolves", async () => {
  const reg = registry();
  assert.deepEqual(reg.listDashboards(boss).map((d) => d.key), ["pulse", "operations", "insights", "sales"]);
  assert.deepEqual(reg.listDashboards(lab).map((d) => d.key), ["pulse", "operations"]);
  await assert.rejects(resolve(reg, "insights", lab), (e) => e.code === "FORBIDDEN");
  await assert.rejects(resolve(reg, "sales", lab), (e) => e.code === "FORBIDDEN");
  for (const key of ["operations", "insights", "sales"]) {
    const out = await resolve(reg, key, boss);
    for (const t of out.tiles) assert.equal(t.ok, true, `${key}/${t.id}: ${t.error?.message}`);
  }
  // Every money metric is admin only.
  for (const m of LAB_METRICS.filter((x) => x.key.startsWith("sales."))) assert.deepEqual(m.roles, ["admin"], m.key);
});

test("sales.ytd previous is the same day-of-year last year", async () => {
  assert.equal(sameDayLastYear("2026-11-05"), "2025-11-05");
  assert.equal(sameDayLastYear("2028-02-29"), "2027-02-28");
  const tx = fakeTx({ executes: [[{ cents: "500000" }], [{ cents: "400000" }]] });
  const out = await metric("sales.ytd").run(tx, {}, boss, ctx());
  assert.equal(out.value, 500000);
  assert.equal(out.previous, 400000);
  assert.equal(out.format, "money");
  assert.equal(out.href, "/reports/sales.comparison");
  const [now, before] = executedSql(tx);
  assert.ok(now.params.includes("2026-01-01") && now.params.includes("2026-11-05"));
  assert.ok(before.params.includes("2025-01-01") && before.params.includes("2025-11-05"));
  // Leap day: Jan 1 .. Feb 28 of the year before.
  const leap = fakeTx({ executes: [[{ cents: "1" }], [{ cents: "1" }]] });
  await metric("sales.ytd").run(leap, {}, boss, ctx({ today: "2028-02-29" }));
  assert.ok(executedSql(leap)[1].params.includes("2027-02-28"));
});

test("sales.mtd is dollars with the invoice count as detail; previous is the same days last month", async () => {
  assert.deepEqual(monthToDateBefore("2026-11-05"), { from: "2026-10-01", to: "2026-10-05" });
  assert.deepEqual(monthToDateBefore("2026-03-31"), { from: "2026-02-01", to: "2026-02-28" });
  const tx = fakeTx({ executes: [[{ day: "2026-11-02", cents: "1000", invoices: "2" }, { day: "2026-11-04", cents: "500", invoices: "1" }], [{ cents: "900" }]] });
  const out = await metric("sales.mtd").run(tx, {}, boss, ctx());
  assert.deepEqual(out, {
    value: 1500, previous: 900, format: "money", href: "/reports/sales.daily?p.range=mtd",
    detail: [{ id: "invoices", label: "invoices", value: 3 }],
  });
});

test("insights.active-clients value excludes inactive, and the data carries declining and inactive counts", async () => {
  const recentAt = "2026-11-01T15:00:00Z";
  const oldAt = "2026-03-01T15:00:00Z";
  // The SQL returns both; health bands on the lab day (lastOrderDay).
  const row = (id, recent, base, lastOrderAt) => ({ clientUserId: id, client: id, recent: String(recent), base: String(base), lastOrderAt, lastOrderDay: lastOrderAt.slice(0, 10) });
  const tx = fakeTx({ executes: [[
    row("healthy", 6, 30, recentAt), // 6 vs 5/month
    row("declining", 1, 30, recentAt), // 1 vs 5/month
    row("gone1", 0, 12, oldAt),
    row("gone2", 0, 0, oldAt),
  ], []] });
  const out = await metric("insights.active-clients").run(tx, {}, boss, ctx());
  assert.equal(out.value, 2);
  assert.equal(out.format, "int");
  assert.equal(out.href, "/reports/clients.health");
  assert.deepEqual(out.detail, [{ id: "declining", label: "declining", value: 1 }, { id: "inactive", label: "inactive", value: 2 }]);
});

test("insights.orders-30 compares with the prior 30 days; avg turnaround uses the shipped, clamped rule", async () => {
  const days = Array.from({ length: 60 }, (_, i) => ({ day: addDaysIso("2026-09-07", i), orders: "1", rush: "0", remakes: "0", units: "1" }));
  const tx = fakeTx({ executes: [days] });
  const out = await metric("insights.orders-30").run(tx, {}, boss, ctx());
  assert.equal(out.value, 30);
  assert.equal(out.previous, 30);
  const [{ params }] = executedSql(tx);
  assert.ok(params.includes("2026-09-07") && params.includes("2026-11-05"));

  const t = fakeTx({ executes: [[{ orders: "4", avgDays: "3.5" }], [{ orders: "2", avgDays: "5" }]] });
  const avg = await metric("insights.avg-turnaround-30").run(t, {}, boss, ctx());
  assert.deepEqual({ value: avg.value, previous: avg.previous, format: avg.format }, { value: 3.5, previous: 5, format: "duration_days" });
  const [a] = executedSql(t);
  assert.match(a.text, /greatest\(0, /);
  assert.match(a.text, /lab_orders\.status = 'shipped'/);
});

test("board metrics read boardDayCounts and link to their report with params", async () => {
  const tx = fakeTx({ executes: [[{ pastDue: "3", dueToday: "2", dueTomorrow: "1", onHold: "4", atRisk: "5" }]] });
  const out = await metric("ops.past-due").run(tx, {}, lab, ctx());
  assert.deepEqual(out, { value: 3, previous: null, format: "int", href: "/reports/departments.monitoring-boards" });
  const today = fakeTx({ executes: [[{ day: "2026-11-05", orders: "7" }]] });
  const n = await metric("ops.new-today").run(today, {}, lab, ctx());
  assert.equal(n.value, 7);
  assert.equal(n.href, "/reports/operations.daily-orders?p.range=today");
  assert.equal(reportHref("sales.daily", { range: "2026-01-01..2026-02-01" }), "/reports/sales.daily?p.range=2026-01-01..2026-02-01");
});

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
