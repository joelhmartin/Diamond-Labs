import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { fakeTx } = await import("../../test/fake-tx.js");
const svc = await import("./statements.service.js");
const source = readFileSync(fileURLToPath(new URL("./statements.service.js", import.meta.url)), "utf8");

test("receivables: issued invoices with what is still owed, aged and grouped by client", async () => {
  const db = fakeTx({ selects: [
    [
      { id: "i1", clientUserId: "doc1", status: "issued", totalCents: 30000, dueDate: "2000-01-01", paid: "10000" },
      { id: "i2", clientUserId: "doc1", status: "issued", totalCents: 5000, dueDate: "2000-01-01", paid: "5000" },
      { id: "i3", clientUserId: "doc2", status: "issued", totalCents: 8000, dueDate: "2999-01-01", paid: "0" },
    ],
    [{ id: "doc1", name: "Dr One", accountNumber: "1", practice: "One Dental" }, { id: "doc2", name: "Dr Two", accountNumber: "2", practice: null }],
  ] });
  const ar = await svc.listReceivables({}, db);
  assert.deepEqual(ar.rows.map((r) => [r.clientUserId, r.balanceCents, r.pastDueCents, r.openInvoices]), [["doc1", 20000, 20000, 1], ["doc2", 8000, 0, 1]]);
  assert.equal(ar.rows[0].buckets.d90_plus, 20000);
  assert.equal(ar.totals.balanceCents, 28000);
  assert.match(ar.asOf, /^\d{4}-\d{2}-\d{2}$/);
});

test("a statement is only for an active practice; drafts carry no money", async () => {
  assert.equal(await svc.practiceStatementFor("acc-x", "2026-10", {}, fakeTx({ selects: [[]] })), null);
  assert.match(source, /ne\(invoices\.status, "draft"\)/);
});

test("a practice statement covers that practice's invoices and is headed with its name and account number", async () => {
  const { renderSql } = await import("../../test/sql-text.js");
  const scope = renderSql(svc.statementActivityFilters(["A1"]).invoiceScope);
  assert.match(scope.text, /invoices\.account_id in \(\$\d+\)/);
  assert.doesNotMatch(scope.text, /client_user_id/);
  const db = fakeTx({ selects: [
    [{ id: "A1", name: "Alpha Dental", accountNumber: "1001" }],
    [{ id: "i1", accountId: "A1", invoiceNumber: 1, status: "issued", totalCents: 5000, issuedAt: new Date("2026-10-02T15:00:00Z"), dueDate: "2026-11-01" }],
    [],
  ] });
  const m = await svc.practiceStatementFor("A1", "2026-10", { generatedAt: new Date("2026-11-02T15:00:00Z") }, db);
  assert.deepEqual([m.heading, m.closingCents], [{ name: "Alpha Dental", accountNumber: "1001" }, 5000]);
  assert.deepEqual(m.billTo, ["Alpha Dental", "Account 1001"]);
  // No practices: no query at all.
  const none = fakeTx();
  assert.deepEqual(await svc.loadStatementActivity([], none), { invoices: [], payments: [] });
  assert.equal(none.log.length, 0);
});

test("one activity load splits per practice; a group's combined total is the sum of its practices", async () => {
  const split = svc.activityByAccount({
    invoices: [{ id: "i1", accountId: "A1" }, { id: "i2", accountId: "A2" }, { id: "i3", accountId: "Z" }],
    payments: [{ invoiceId: "i2", appliedCents: 1 }, { invoiceId: "i3", appliedCents: 1 }],
  }, ["A1", "A2", "A3"]);
  assert.deepEqual([...split.keys()], ["A1", "A2", "A3"]);
  assert.deepEqual(split.get("A2").payments, [{ invoiceId: "i2", appliedCents: 1 }]);
  assert.deepEqual(split.get("A3"), { invoices: [], payments: [] });
  const db = fakeTx({ selects: [
    [{ id: "A1", name: "Alpha", accountNumber: "1" }, { id: "A2", name: "Beta", accountNumber: "2" }],
    [
      { id: "i1", accountId: "A1", invoiceNumber: 1, status: "issued", totalCents: 5000, issuedAt: new Date("2026-10-02T15:00:00Z"), dueDate: "2026-11-01" },
      { id: "i2", accountId: "A2", invoiceNumber: 2, status: "issued", totalCents: 1234, issuedAt: new Date("2026-09-02T15:00:00Z"), dueDate: "2026-10-01" },
    ],
    [{ invoiceId: "i2", invoiceNumber: 2, appliedCents: 234, source: "card", paidOn: "2026-10-03", createdAt: new Date("2026-10-03T15:00:00Z") }],
  ] });
  const m = await svc.combinedStatementFor({ id: "G1", name: "Group", accountIds: ["A1", "A2", "gone"] }, "2026-10", { generatedAt: new Date("2026-11-02T15:00:00Z") }, db);
  assert.deepEqual(m.sections.map((x) => [x.heading, x.closingCents]), [["Alpha · Account 1", 5000], ["Beta · Account 2", 1000]]);
  assert.equal(m.closingCents, 6000);
});

test("receivables read one SQL-aggregated query (no id list) and keep deriveBalance as the balance rule", async () => {
  assert.match(source, /openReceivableInvoices\(/);
  const db = fakeTx({ selects: [[{ id: "i1", clientUserId: "d", status: "issued", totalCents: 100, dueDate: null, paid: "100" }]] });
  assert.equal((await svc.listReceivables({}, db)).rows.length, 0, "a fully paid invoice never reaches AR");
  assert.doesNotMatch(source, /sum\(\$\{invoicePayments/);
});

test("loadClient carries the practice phone and delivery preferences (the Ship form's starting ship-to)", async () => {
  const c = await svc.loadClient("d1", fakeTx({ selects: [[{
    id: "d1", name: "Dr", email: "d@x.com", role: "doctor", accountNumber: null,
    profile: { companyName: "P", address1: "1 St", address2: null, city: "Austin", state: "TX", zip: "78701", phone: "512-555-0100", deliveryMethod: "UPS Ground", deliveryNotes: "Back door" },
  }]] }));
  assert.deepEqual([c.phone, c.deliveryMethod, c.deliveryNotes], ["512-555-0100", "UPS Ground", "Back door"]);
});

test("an unowned legacy invoice (null client) is left out of AR and never reaches the client lookup", async () => {
  const db = fakeTx({ selects: [[{ id: "i1", clientUserId: null, status: "issued", totalCents: 100, dueDate: null, paid: "0" }]] });
  const ar = await svc.listReceivables({}, db);
  assert.equal(ar.rows.length, 0);
  // The ledger's query builds two selects (a paid-sum subquery and the rows); a third would be the users lookup.
  assert.equal(db.log.filter((e) => e.op === "select").length, 2, "no users query for an empty id list");
});

test("statement activity can be bounded to a month end: invoices and ledger rows after it are not loaded", async () => {
  const { renderSql } = await import("../../test/sql-text.js");
  const { invoiceScope, paymentBound } = svc.statementActivityFilters(null, { through: "2026-10-31" });
  const inv = renderSql(invoiceScope);
  assert.match(inv.text, /invoices\.issued_at < \(\(\$\d+::date \+ 1\)::timestamp at time zone 'America\/Chicago'\)/);
  assert.ok(inv.params.includes("2026-10-31"));
  const pay = renderSql(paymentBound);
  // ledgerRowDay <= through, written index-friendly (ledgerRowDayBetween): no coalesce in the filter.
  assert.match(pay.text, /\(invoice_payments\.paid_on <= \$\d+::date\) or \(invoice_payments\.paid_on is null and invoice_payments\.created_at < \(\(\$\d+::date \+ 1\)::timestamp at time zone 'America\/Chicago'\)\)/);
  assert.doesNotMatch(pay.text, /coalesce/);
  assert.deepEqual(pay.params, ["2026-10-31", "2026-10-31"]);
  // Unbounded (the existing callers): no date clause at all.
  const open = svc.statementActivityFilters(["acc1"]);
  assert.doesNotMatch(renderSql(open.invoiceScope).text, /issued_at/);
  assert.equal(open.paymentBound, undefined);
});
