import { test, afterEach } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../../../test/fake-tx.js";
import { executedSql } from "../../../test/sql-text.js";
import { SALES_REPORTS } from "./sales.reports.js";

const report = (key) => SALES_REPORTS.find((r) => r.key === key);
const range = (from, to) => ({ from, to, previous: { from: "2000-01-01", to: "2000-01-31" } });

afterEach(() => { delete process.env.REPORTS_COVERAGE_FROM; });

test("sales comparison returns 12 months × 3 years with zeros filled", async () => {
  const tx = fakeTx({ executes: [[{ month: "2024-03", cents: "100" }, { month: "2026-03", cents: "300" }, { month: "2026-12", cents: "50" }]] });
  const out = await report("sales.comparison").run(tx, { year: 2026 });
  assert.equal(out.rows.length, 12);
  assert.deepEqual(out.rows.map((r) => r.month), ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  assert.deepEqual(out.rows[2], { month: "Mar", y2: 100, y1: 0, y0: 300 });
  assert.deepEqual(out.rows[11], { month: "Dec", y2: 0, y1: 0, y0: 50 });
  for (const r of out.rows) for (const k of ["y0", "y1", "y2"]) assert.equal(typeof r[k], "number");
  assert.deepEqual(out.summary, { month: "Total", y2: 100, y1: 0, y0: 350 });
  assert.match(out.notice, /2024, 2025 and 2026/);
  const [{ params }] = executedSql(tx);
  assert.ok(params.includes("2024-01-01") && params.includes("2026-12-31"));
  assert.equal(report("sales.comparison").chart.type, "groupedBar");
});

test("sales comparison defaults to the run clock's lab year", async () => {
  const tx = fakeTx({ executes: [[]] });
  const out = await report("sales.comparison").run(tx, {}, null, { now: new Date("2023-06-01T17:00:00Z"), today: "2023-06-01" });
  assert.match(out.notice, /2021, 2022 and 2023/);
  assert.ok(executedSql(tx)[0].params.includes("2021-01-01"));
});

test("sales summary reports gross, discount, net, tax and shipping for the range and the period before", async () => {
  const tx = fakeTx({ executes: [
    [{ net: "8500", discount: "-1500", tax: "700", shipping: "1200", total: "10400", invoices: "3" }],
    [{ net: "1000", discount: "0", tax: "0", shipping: "0", total: "1000", invoices: "1" }],
  ] });
  const out = await report("sales.summary").run(tx, { range: range("2026-10-01", "2026-10-31") });
  assert.deepEqual(out.rows[0], { period: "This period", from: "2026-10-01", to: "2026-10-31", invoices: 3, gross: 10000, discount: -1500, net: 8500, tax: 700, shipping: 1200, total: 10400 });
  assert.equal(out.rows[1].period, "Previous period");
  assert.equal(out.rows[1].net, 1000);
  // Imported lines are never discounts; gross = net − discounts still reconciles; the range is flagged as not itemised.
  assert.match(executedSql(tx)[0].text, /invoice_lines\.price_source <> 'legacy'/);
  assert.equal(out.rows[0].gross - out.rows[0].net, -out.rows[0].discount);
  assert.match(out.notice, /not itemised/);
});

test("category sales carries the coverage notice when from < REPORTS_COVERAGE_FROM", async () => {
  process.env.REPORTS_COVERAGE_FROM = "2026-11-15";
  const rows = [{ category: "Night guards", units: "4", amount: "40000" }, { category: "Adjustments", units: "1", amount: "-500" }];
  const before = await report("sales.category").run(fakeTx({ executes: [rows] }), { range: range("2026-11-01", "2026-11-30") });
  assert.match(before.notice, /2026-11-15/);
  assert.deepEqual(before.rows[0], { category: "Night guards", units: 4, amount: 40000 });
  assert.deepEqual(before.summary, { category: "Total", units: 5, amount: 39500 });
  const after = await report("sales.category").run(fakeTx({ executes: [rows] }), { range: range("2026-11-15", "2026-11-30") });
  assert.equal(after.notice, undefined);
});

test("category sales maps legacy lines to the catalog by code and never counts shipping", async () => {
  const tx = fakeTx({ executes: [[]] });
  await report("sales.category").run(tx, { range: range("2026-11-01", "2026-11-30") });
  const [{ text }] = executedSql(tx);
  assert.match(text, /invoice_lines\.kind <> 'shipping'/);
  assert.match(text, /left join product_variants as by_code on invoice_lines\.variant_id is null and by_code\.code = invoice_lines\.code/);
  assert.match(text, /status\s*=\s*'issued'/);
});

test("daily sales fills every day and totals the range", async () => {
  const tx = fakeTx({ executes: [[{ day: "2026-10-02", cents: "900", invoices: "2" }]] });
  const out = await report("sales.daily").run(tx, { range: range("2026-10-01", "2026-10-03") });
  assert.deepEqual(out.rows.map((r) => [r.day, r.sales, r.invoices]), [["2026-10-01", 0, 0], ["2026-10-02", 900, 2], ["2026-10-03", 0, 0]]);
  assert.deepEqual(out.summary, { day: "Total", sales: 900, invoices: 2 });
});

test("lab sales splits by channel with a share of the whole", async () => {
  const tx = fakeTx({ executes: [[{ kind: "order", invoices: "3", cents: "7500" }, { kind: "shop", invoices: "1", cents: "2500" }]] });
  const out = await report("sales.lab").run(tx, { range: range("2026-10-01", "2026-10-31") });
  assert.deepEqual(out.rows.map((r) => [r.channel, r.sales, r.share]), [["Lab order", 7500, 0.75], ["Shop", 2500, 0.25], ["Imported (Seazona)", 0, 0]]);
});

test("net sales chart is a line of monthly net", async () => {
  const out = await report("sales.net-chart").run(fakeTx({ executes: [[{ month: "2026-10", cents: "5" }]] }), { range: range("2026-09-01", "2026-10-31") });
  assert.deepEqual(out.rows, [{ month: "2026-09", net: 0 }, { month: "2026-10", net: 5 }]);
  assert.equal(report("sales.net-chart").chart.type, "line");
});

test("sales by doctor pages per client, sorted with an id tiebreaker, share of the range total", async () => {
  const tx = fakeTx({ executes: [
    [{ total: "2", cents: "10000" }],
    [{ clientUserId: "doc1", client: "One Dental", accountNumber: "1", invoices: "3", cents: "7500", lastDay: "2026-10-30" }],
  ] });
  const out = await report("sales.by-client").run(tx, { range: range("2026-10-01", "2026-10-31") }, null, { page: { limit: 1, offset: 0, sort: { id: "client", desc: false } } });
  assert.equal(out.total, 2);
  assert.deepEqual(out.rows[0], { clientUserId: "doc1", client: "One Dental", accountNumber: "1", invoices: 3, sales: 7500, share: 0.75, lastInvoice: "2026-10-30" });
  assert.equal(out.summary.sales, 10000);
  const [, rows] = executedSql(tx);
  assert.match(rows.text, /order by coalesce\(doctor_profiles\.company_name, users\.name\) asc nulls last, users\.id asc/);
});
