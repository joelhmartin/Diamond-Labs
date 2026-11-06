import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STAFF_ROLES } from "@my-app/shared";
import { fakeTx } from "../../../test/fake-tx.js";
import { executedSql } from "../../../test/sql-text.js";
import { createRegistry } from "../../../modules/reports/registry.js";
import { registerLabReports } from "./index.js";
import { ACCOUNTING_REPORTS } from "./accounting.reports.js";

const report = (key) => ACCOUNTING_REPORTS.find((r) => r.key === key);
const page = (over = {}) => ({ page: { limit: 50, offset: 0, sort: null, ...over } });
const range = { from: "2026-10-01", to: "2026-10-31", previous: { from: "2026-08-31", to: "2026-09-30" } };

const openInvoices = [
  { id: "i1", clientUserId: "doc1", status: "issued", totalCents: 30000, dueDate: "2000-01-01", paid: "10000" },
  { id: "i2", clientUserId: "doc1", status: "issued", totalCents: 4000, dueDate: "2999-01-01", paid: "0" },
  { id: "i3", clientUserId: "doc2", status: "issued", totalCents: 8000, dueDate: "2999-01-01", paid: "0" },
];
const clients = [{ id: "doc1", name: "Dr One", accountNumber: "1", practice: "One Dental" }, { id: "doc2", name: "Dr Two", accountNumber: "2", practice: null }];

test("aging summary totals equal the sum of buckets", async () => {
  const out = await report("accounting.aging-summary").run(fakeTx({ selects: [openInvoices, clients] }), { pastDueOnly: false });
  const buckets = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];
  for (const r of out.rows) assert.equal(r.balance, buckets.reduce((s, k) => s + r[k], 0));
  assert.equal(out.summary.balance, buckets.reduce((s, k) => s + out.summary[k], 0));
  assert.equal(out.summary.balance, 32000);
  assert.deepEqual(out.rows.map((r) => [r.client, r.clientUserId]), [["One Dental", "doc1"], ["Dr Two", "doc2"]]);
});

test("account balance is one row per client from the receivables rule", async () => {
  const out = await report("accounting.account-balance").run(fakeTx({ selects: [openInvoices, clients] }), {});
  assert.deepEqual(out.rows.map((r) => [r.client, r.balance, r.pastDue, r.openInvoices]), [["One Dental", 24000, 20000, 2], ["Dr Two", 8000, 0, 1]]);
  assert.equal(out.summary.balance, 32000);
});

test("statements summary: closing = opening + invoiced − paid per client", async () => {
  const invs = [
    { id: "i1", clientUserId: "doc1", invoiceNumber: 1, status: "issued", totalCents: 10000, kind: "order", issuedAt: new Date("2026-09-10T17:00:00Z"), voidedAt: null },
    { id: "i2", clientUserId: "doc1", invoiceNumber: 2, status: "issued", totalCents: 5000, kind: "order", issuedAt: new Date("2026-10-05T17:00:00Z"), voidedAt: null },
    { id: "i3", clientUserId: "doc2", invoiceNumber: 3, status: "void", totalCents: 3000, kind: "order", issuedAt: new Date("2026-10-20T17:00:00Z"), voidedAt: new Date("2026-10-25T17:00:00Z") },
  ];
  const pays = [
    { invoiceId: "i1", appliedCents: 4000, source: "admin_check", paidOn: "2026-09-20", createdAt: new Date("2026-09-20T17:00:00Z") },
    { invoiceId: "i1", appliedCents: 6000, source: "doctor_card", paidOn: null, createdAt: new Date("2026-10-02T17:00:00Z") },
    // 03:00 UTC on Nov 2 is Nov 1 in the lab: after the month, so not in it.
    { invoiceId: "i2", appliedCents: 1000, source: "doctor_card", paidOn: null, createdAt: new Date("2026-11-02T03:00:00Z") },
  ];
  const out = await report("accounting.statements-summary").run(fakeTx({ selects: [invs, pays, clients] }), { month: "2026-10-15" });
  for (const r of out.rows) assert.equal(r.closing, r.opening + r.invoiced - r.paid);
  const one = out.rows.find((r) => r.clientUserId === "doc1");
  assert.deepEqual([one.opening, one.invoiced, one.paid, one.closing], [6000, 5000, 6000, 5000]);
  const two = out.rows.find((r) => r.clientUserId === "doc2");
  assert.deepEqual([two.opening, two.invoiced, two.paid, two.closing], [0, 0, 0, 0]);
  assert.equal(out.summary.closing, out.summary.opening + out.summary.invoiced - out.summary.paid);
  assert.match(out.notice, /October 2026/);
});

test("payments received excludes negative reversal rows and labels source", async () => {
  const tx = fakeTx({ executes: [
    [{ total: "2" }],
    [
      { id: "p1", day: "2026-10-02", source: "admin_check", reference: "1001", invoiceId: "i1", invoiceNumber: "1234", clientUserId: "doc1", client: "One Dental", amount: "5000" },
      { id: "p2", day: "2026-10-03", source: null, reference: null, invoiceId: null, invoiceNumber: "88", clientUserId: null, client: null, amount: "700" },
    ],
  ] });
  const out = await report("accounting.payments-received").run(tx, { range, source: "all" }, null, page());
  assert.equal(out.total, 2);
  assert.deepEqual(out.rows.map((r) => [r.sourceLabel, r.amount, r.invoiceNumber]), [["Check", 5000, "1234"], ["Unknown", 700, "88"]]);
  const [count, rows] = executedSql(tx);
  for (const q of [count, rows]) {
    assert.match(q.text, /invoice_payments\.applied_cents > 0/);
    assert.ok(q.params.includes("credit") && q.params.includes("legacy_settlement"));
    // The day filter is the index-friendly ledgerRowDayBetween, never the coalesce.
    assert.match(q.text, /\(invoice_payments\.paid_on >= \$\d+::date and invoice_payments\.paid_on <= \$\d+::date\) or \(invoice_payments\.paid_on is null and/);
    assert.doesNotMatch(q.text, /where[^]*coalesce\(invoice_payments\.paid_on[^)]*\) between/);
  }
  const adj = fakeTx({ executes: [[]] });
  await report("accounting.adjustments").run(adj, { range });
  assert.match(executedSql(adj)[0].text, /source = \$\d+ and \(\(invoice_payments\.paid_on >= /);
  assert.match(rows.text, /order by .*invoice_payments\.id/);
  assert.match(rows.text, /limit \$\d+ offset \$\d+/);
});

test("server-paged invoices sort on the asked column with an id tiebreaker", async () => {
  const tx = fakeTx({ executes: [[{ total: "1" }], [{ id: "i9", invoiceNumber: 9, day: "2026-10-04", status: "issued", kind: "order", clientUserId: "doc1", client: "One Dental", subtotal: "100", tax: "0", shipping: "0", total: "100", dueDate: "2026-11-03" }]] });
  const out = await report("accounting.invoices").run(tx, { range, status: "all" }, null, page({ sort: { id: "total", desc: true } }));
  assert.equal(out.rows[0].total, 100);
  const [, rows] = executedSql(tx);
  assert.match(rows.text, /order by invoices\.total_cents desc nulls last, invoices\.id desc/);
});

test("invoices & payments shows paid and balance from the ledger rule", async () => {
  const tx = fakeTx({ executes: [[{ total: "1" }], [{ id: "i1", invoiceNumber: 1, day: "2026-10-04", status: "issued", clientUserId: "doc1", client: "One Dental", total: "10000", paid: "2500", lastPaid: "2026-10-09" }]] });
  const out = await report("accounting.invoices-payments").run(tx, { range }, null, page());
  assert.deepEqual([out.rows[0].paid, out.rows[0].balance, out.rows[0].lastPaid], [2500, 7500, "2026-10-09"]);
});

test("discounts are negative adjustment lines and say the remake reduction is not stored", async () => {
  const tx = fakeTx({ executes: [[{ day: "2026-10-04", invoiceId: "i1", invoiceNumber: 1, clientUserId: "doc1", client: "One Dental", description: "Courtesy", amount: "-1500" }]] });
  const out = await report("accounting.discounts").run(tx, { range });
  assert.equal(out.summary.amount, -1500);
  assert.match(out.notice, /remake/i);
  assert.match(executedSql(tx)[0].text, /invoice_lines\.kind = 'adjustment' and invoice_lines\.line_cents < 0/);
});

test("an imported negative adjustment line is not a discount, and pre-cutover ranges say discounts are not itemised", async () => {
  try {
    const tx = fakeTx({ executes: [[]] });
    const out = await report("accounting.discounts").run(tx, { range });
    // map-invoices.js writes every imported line with price_source 'legacy' (its balancing "Seazona adjustment" line included).
    assert.match(executedSql(tx)[0].text, /invoice_lines\.line_cents < 0 and invoice_lines\.price_source <> 'legacy'/);
    assert.match(out.notice, /not itemised/); // REPORTS_COVERAGE_FROM unset: cutover not recorded yet
    process.env.REPORTS_COVERAGE_FROM = "2026-10-15";
    assert.match((await report("accounting.discounts").run(fakeTx({ executes: [[]] }), { range })).notice, /before 2026-10-15\) are not itemised/);
    const after = await report("accounting.discounts").run(fakeTx({ executes: [[]] }), { range: { ...range, from: "2026-10-15" } });
    assert.doesNotMatch(after.notice, /not itemised/);
    assert.match(after.notice, /remake/i);
  } finally {
    delete process.env.REPORTS_COVERAGE_FROM;
  }
  // The Adjustments report keeps imported lines: its line filter is only the kind.
  const adj = fakeTx({ executes: [[]] });
  await report("accounting.adjustments").run(adj, { range });
  assert.doesNotMatch(executedSql(adj)[0].text, /price_source/);
});

test("receivables and the default statement month follow the run clock, not the wall clock", async () => {
  const ctx = { now: new Date("2026-03-04T17:00:00Z"), today: "2026-03-04" };
  const due = [{ id: "i1", clientUserId: "doc1", status: "issued", totalCents: 5000, dueDate: "2026-03-01", paid: "0" }];
  const bal = await report("accounting.account-balance").run(fakeTx({ selects: [due, clients] }), {}, null, ctx);
  assert.equal(bal.notice, "As of 2026-03-04.");
  assert.equal(bal.rows[0].pastDue, 5000);
  const aging = await report("accounting.aging-summary").run(fakeTx({ selects: [due, clients] }), {}, null, ctx);
  assert.equal(aging.notice, "As of 2026-03-04.");
  assert.equal(aging.rows[0].d1_30, 5000);
  const stmt = await report("accounting.statements-summary").run(fakeTx({ selects: [[], [], []] }), {}, null, ctx);
  assert.match(stmt.notice, /February 2026/);
  const jan = await report("accounting.statements-summary").run(fakeTx({ selects: [[], [], []] }), {}, null, { today: "2026-01-10" });
  assert.match(jan.notice, /December 2025/);
});

test("statements summary loads activity only through the month's last day", () => {
  const src = readFileSync(fileURLToPath(new URL("./accounting.reports.js", import.meta.url)), "utf8");
  assert.match(src, /loadStatementActivity\(null, tx, \{ through: bounds\.endIso \}\)/);
});

test("invoices summary by day or month carries no client id, so the client link is not drawn", async () => {
  for (const by of ["day", "month"]) {
    const tx = fakeTx({ executes: [[{ bucket: "2026-10", clientUserId: null, invoices: "2", subtotal: "100", tax: "0", shipping: "0", total: "100" }]] });
    const out = await report("accounting.invoices-summary").run(tx, { range, by });
    assert.equal(out.rows[0].clientUserId, null);
    assert.match(executedSql(tx)[0].text, /null as clientUserId/);
  }
  const month = fakeTx({ executes: [[]] });
  await report("accounting.invoices-summary").run(month, { range, by: "month" });
  assert.match(executedSql(month)[0].text, /to_char\(\(invoices\.issued_at at time zone 'America\/Chicago'\)::date, 'YYYY-MM'\) as bucket/);
});

test("payments received sorts invoice numbers numerically and methods by the label shown", async () => {
  const run = async (id) => {
    const tx = fakeTx({ executes: [[{ total: "0" }], []] });
    await report("accounting.payments-received").run(tx, { range, source: "all" }, null, page({ sort: { id, desc: false } }));
    return executedSql(tx)[1];
  };
  assert.match((await run("invoiceNumber")).text, /order by lpad\(coalesce\(invoices\.invoice_number::text, invoice_payments\.invoice_number\), 20, '0'\) asc/);
  const label = await run("sourceLabel");
  assert.match(label.text, /order by case invoice_payments\.source when \$\d+ then \$\d+ .* else 'Unknown' end asc/);
  assert.ok(label.params.includes("admin_check") && label.params.includes("Check"));
});

const GLUE = ["lab-metrics.js", "accounting.reports.js", "sales.reports.js", "lookups.js", "clients.reports.js", "client-health.js", "products.reports.js"];

test("no accounting or sales report selects legacy_patient or decrypts", () => {
  for (const f of GLUE) {
    const src = readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), "utf8");
    assert.doesNotMatch(src, /legacyPatient|legacy_patient|priceNote|price_note|\.note\b|\.notes\b/, f);
    assert.doesNotMatch(src, /crypto|decrypt|unseal|openOrder|openLedgerRow|openRx/i, f);
  }
});

test("registerLabReports registers the 9 accounting + 8 sales reports (Sales By Rep pending), admin only, in 8 groups", () => {
  const registry = createRegistry({ defaultRoles: STAFF_ROLES });
  registerLabReports(registry);
  const keys = [
    "accounting.account-balance", "accounting.adjustments", "accounting.aging-summary", "accounting.discounts", "accounting.invoices",
    "accounting.invoices-summary", "accounting.invoices-payments", "accounting.payments-received", "accounting.statements-summary",
    "sales.comparison", "sales.summary", "sales.daily", "sales.lab", "sales.net-chart", "sales.category", "sales.by-client", "sales.by-rep",
  ];
  for (const k of keys) assert.deepEqual(registry.getReport(k)?.roles, ["admin"], k);
  const admin = { id: "a", role: "admin" };
  const moneyGroups = (r) => /^(accounting|sales)\./.test(r.key);
  assert.deepEqual(registry.listReports(admin).filter(moneyGroups).map((r) => r.key).sort(), [...keys].sort());
  assert.equal(registry.listReports({ id: "l", role: "lab" }).filter(moneyGroups).length, 0);
  assert.deepEqual(registry.listGroups().map((g) => g.title), [
    "Accounting", "Clients", "Departments", "Operations", "Planning", "Productivity", "Products & Services", "Sales",
  ]);
  for (const k of ["accounting.invoices", "accounting.invoices-payments", "accounting.payments-received", "sales.by-client"]) {
    assert.equal(registry.getReport(k).paging, "server", k);
  }
  assert.equal(registry.getReport("sales.by-client").title, "Sales By Doctor");
  assert.deepEqual(keys.filter((k) => registry.getReport(k).featured), ["sales.comparison", "sales.summary"]);
  assert.deepEqual(registry.getLookup("client").roles, ["admin"]);
  for (const k of ["product", "category", "department", "staff"]) assert.equal(registry.getLookup(k).roles, undefined, k);
});

test("lookups trim and cap the typed text; staff search filters the assignable list to 20", async () => {
  const { LAB_LOOKUPS, lookupTerm } = await import("./lookups.js");
  assert.equal(lookupTerm(`  ${"x".repeat(150)}  `).length, 100);
  assert.equal(lookupTerm(undefined), "");
  const staff = LAB_LOOKUPS.find((l) => l.key === "staff");
  const people = Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, name: i === 3 ? "Ann Tech" : `Person ${i}`, role: "lab" }));
  assert.deepEqual(await staff.search(fakeTx({ selects: [people] }), "  ann "), [{ value: "u3", label: "Ann Tech" }]);
  assert.equal((await staff.search(fakeTx({ selects: [people] }), "")).length, 20);
  const client = LAB_LOOKUPS.find((l) => l.key === "client");
  assert.equal(await client.label(fakeTx({ selects: [[]] }), "nobody"), null);
  assert.equal(await client.label(fakeTx({ selects: [[{ label: "One Dental" }]] }), "doc1"), "One Dental");
});
