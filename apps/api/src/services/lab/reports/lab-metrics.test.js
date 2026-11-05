import { test, afterEach } from "vitest";
import assert from "node:assert/strict";
import { isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { fakeTx } from "../../../test/fake-tx.js";
import {
  salesCents, salesByDay, salesByMonth, salesBreakdown, clientName, coverageNotice, labDayBetween,
  beforeCoverage, discountCoverageNotice, turnaroundDaysSql,
} from "./lab-metrics.js";
import { remakeCoverageNotice } from "./productivity.reports.js";
import { invoices } from "../../../db/schema/index.js";
import { sqlText, executedSql as executed } from "../../../test/sql-text.js";

afterEach(() => { delete process.env.REPORTS_COVERAGE_FROM; });

test("daily sales buckets by lab-local issue day", async () => {
  // The rule: 04:30 UTC on Nov 1 is still Oct 31 in the lab.
  assert.equal(isoDateIn(LAB_TIMEZONE, new Date("2026-11-01T04:30:00Z")), "2026-10-31");
  const tx = fakeTx({ executes: [[{ day: "2026-10-31", cents: "5000", invoices: "1" }]] });
  const rows = await salesByDay(tx, { from: "2026-10-31", to: "2026-11-01" });
  assert.deepEqual(rows, [{ day: "2026-10-31", cents: 5000, invoices: 1 }, { day: "2026-11-01", cents: 0, invoices: 0 }]);
  const [{ text, params }] = executed(tx);
  // Bucketed and filtered on the lab-local day, never the UTC day.
  assert.match(text, /\(invoices\.issued_at at time zone 'America\/Chicago'\)::date/);
  assert.match(text, /invoices\.issued_at >= \(\$\d+::date\)::timestamp at time zone 'America\/Chicago'/);
  assert.match(text, /invoices\.issued_at < \(\(\$\d+::date \+ 1\)::timestamp at time zone 'America\/Chicago'\)/);
  assert.ok(params.includes("2026-10-31") && params.includes("2026-11-01"));
});

test("sales excludes void and draft and uses subtotal not total", async () => {
  const tx = fakeTx({ executes: [[{ cents: "123456" }]] });
  assert.equal(await salesCents(tx, { from: "2026-01-01", to: "2026-01-31", clientUserId: "doc1" }), 123456);
  const [{ text, params }] = executed(tx);
  assert.match(text, /status\s*=\s*'issued'/);
  assert.match(text, /subtotal_cents/);
  assert.doesNotMatch(text, /(?<!sub)total_cents/);
  // Piece 5's opening-balance invoices carry an AR balance, not a sale.
  assert.ok(params.includes("opening:%"));
  assert.ok(params.includes("doc1"));
});

test("sales summary: gross 10000, discount -1500 gives net 8500; tax and shipping are reported separately", async () => {
  const tx = fakeTx({ executes: [[{ net: "8500", discount: "-1500", tax: "700", shipping: "1200", total: "10400", invoices: "3" }]] });
  const out = await salesBreakdown(tx, { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(out, { grossCents: 10000, discountCents: -1500, netCents: 8500, taxCents: 700, shippingCents: 1200, totalCents: 10400, invoices: 3 });
  const [{ text }] = executed(tx);
  assert.match(text, /invoice_lines\.kind = 'adjustment' and invoice_lines\.line_cents < 0/);
  assert.match(text, /status\s*=\s*'issued'/);
});

test("an empty range reads as zeros, not NaN", async () => {
  const out = await salesBreakdown(fakeTx({ executes: [[]] }), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(out, { grossCents: 0, discountCents: 0, netCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0, invoices: 0 });
});

test("monthly sales fill every month in the range with zeros", async () => {
  const tx = fakeTx({ executes: [[{ month: "2026-02", cents: "700" }]] });
  const rows = await salesByMonth(tx, { from: "2026-01-15", to: "2026-03-02" });
  assert.deepEqual(rows, [{ month: "2026-01", cents: 0 }, { month: "2026-02", cents: 700 }, { month: "2026-03", cents: 0 }]);
  assert.match(executed(tx)[0].text, /to_char\(\(invoices\.issued_at at time zone 'America\/Chicago'\)::date, 'YYYY-MM'\)/);
});

test("the client name is the practice, falling back to the user's name", () => {
  assert.equal(sqlText(clientName), "coalesce(doctor_profiles.company_name, users.name)");
});

test("labDayBetween is the one lab-day range filter", () => {
  const text = sqlText(labDayBetween(invoices.issuedAt, { from: "2026-03-08", to: "2026-03-08" }));
  assert.match(text, /^invoices\.issued_at >= .* and invoices\.issued_at < .*$/);
});

test("coverage notice appears only for ranges that start before REPORTS_COVERAGE_FROM", () => {
  assert.equal(coverageNotice({ from: "2020-01-01", to: "2026-01-01" }), null);
  process.env.REPORTS_COVERAGE_FROM = "2026-11-15";
  assert.match(coverageNotice({ from: "2026-11-01", to: "2026-11-30" }), /2026-11-15/);
  assert.equal(coverageNotice({ from: "2026-11-15", to: "2026-11-30" }), null);
});

test("beforeCoverage is the one coverage condition (unset = imported history is in range)", () => {
  assert.equal(beforeCoverage({ from: "2026-11-01" }, undefined), true);
  assert.equal(beforeCoverage({ from: "2026-11-14" }, "2026-11-15"), true);
  assert.equal(beforeCoverage({ from: "2026-11-15" }, "2026-11-15"), false);
  assert.equal(beforeCoverage(undefined, "2026-11-15"), true);
  // All three notices agree with it.
  for (const notice of [discountCoverageNotice, remakeCoverageNotice]) {
    assert.ok(notice({ from: "2026-11-14" }, "2026-11-15"));
    assert.equal(notice({ from: "2026-11-15" }, "2026-11-15"), null);
    assert.ok(notice({ from: "2026-11-15" }, undefined));
  }
  assert.ok(coverageNotice({ from: "2026-11-14" }, "2026-11-15"));
  assert.equal(coverageNotice({ from: "2026-11-01" }, undefined), null, "product coverage stays quiet until cutover is recorded");
});

test("turnaroundDaysSql never goes below zero, like turnaroundDays()", () => {
  assert.match(sqlText(turnaroundDaysSql), /^greatest\(0, /);
});
