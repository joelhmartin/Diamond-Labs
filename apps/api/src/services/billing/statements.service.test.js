import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { fakeTx } = await import("../../test/fake-tx.js");
const svc = await import("./statements.service.js");
const source = readFileSync(fileURLToPath(new URL("./statements.service.js", import.meta.url)), "utf8");

const OPEN = [
  { id: "i1", clientUserId: "doc1", accountId: "A1", status: "issued", totalCents: 30000, dueDate: "2000-01-01", paid: "10000" },
  { id: "i2", clientUserId: "doc1", accountId: "A1", status: "issued", totalCents: 5000, dueDate: "2000-01-01", paid: "5000" },
  { id: "i3", clientUserId: "doc2", accountId: "A2", status: "issued", totalCents: 8000, dueDate: "2999-01-01", paid: "0" },
  { id: "i4", clientUserId: "doc3", accountId: "A3", status: "issued", totalCents: 2000, dueDate: "2000-01-01", paid: "0" },
];
const PRACTICES = [
  { id: "A1", name: "Alpha Dental", accountNumber: "1", ownerUserId: "doc1" },
  { id: "A2", name: "Beta Ortho", accountNumber: "2", ownerUserId: "doc2" },
  { id: "A3", name: "Gamma Perio", accountNumber: "3", ownerUserId: "doc3" },
];
const ORGS = [{ accountId: "A1", id: "G1", name: "North Group", settings: {} }, { accountId: "A2", id: "G1", name: "North Group", settings: {} }];

test("receivables: issued invoices with what is still owed, aged per practice account", async () => {
  const db = fakeTx({ selects: [OPEN, PRACTICES, ORGS] });
  const ar = await svc.listReceivables({}, db);
  assert.deepEqual(ar.rows.map((r) => [r.accountId, r.name, r.balanceCents, r.pastDueCents, r.openInvoices]), [["A1", "Alpha Dental", 20000, 20000, 1], ["A3", "Gamma Perio", 2000, 2000, 1], ["A2", "Beta Ortho", 8000, 0, 1]]);
  assert.deepEqual(ar.rows.map((r) => [r.organizationId, r.organizationName, r.ownerUserId]), [["G1", "North Group", "doc1"], [null, null, "doc3"], ["G1", "North Group", "doc2"]]);
  assert.equal(ar.rows[0].buckets.d90_plus, 20000);
  assert.equal(ar.totals.balanceCents, 30000);
  assert.equal(ar.groups, undefined, "no rollup unless asked");
  assert.match(ar.asOf, /^\d{4}-\d{2}-\d{2}$/);
});

test("group rollup total equals the sum of its practices", async () => {
  const ar = await svc.listReceivables({ groupBy: "organization" }, fakeTx({ selects: [OPEN, PRACTICES, ORGS] }));
  assert.equal(ar.groups.length, 1);
  const [g] = ar.groups;
  const members = ar.rows.filter((r) => g.accountIds.includes(r.accountId));
  assert.deepEqual([g.organizationId, g.name, [...g.accountIds].sort()], ["G1", "North Group", ["A1", "A2"]]);
  assert.equal(g.totalCents, members.reduce((n, r) => n + r.balanceCents, 0));
  assert.equal(g.totalCents, 28000);
  for (const k of Object.keys(g.buckets)) assert.equal(g.buckets[k], members.reduce((n, r) => n + r.buckets[k], 0), k);
  assert.equal(Object.values(g.buckets).reduce((n, v) => n + v, 0), g.totalCents);
});

test("ungrouped practice is a plain row", async () => {
  const ar = await svc.listReceivables({ groupBy: "organization" }, fakeTx({ selects: [OPEN, PRACTICES, ORGS] }));
  const plain = ar.rows.find((r) => r.accountId === "A3");
  assert.equal(plain.organizationId, null);
  assert.ok(ar.groups.every((g) => !g.accountIds.includes("A3")));
  assert.equal(ar.totals.balanceCents, ar.groups.reduce((n, g) => n + g.totalCents, 0) + plain.balanceCents, "groups plus plain rows cover the total once");
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
  const db = fakeTx({ selects: [[{ id: "i1", clientUserId: "d", accountId: "A1", status: "issued", totalCents: 100, dueDate: null, paid: "100" }]] });
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

test("an invoice with a client but no practice account is an Unassigned row keyed by the client; a guest invoice is left out", async () => {
  const db = fakeTx({ selects: [
    [
      ...OPEN,
      { id: "u1", clientUserId: "doc9", accountId: null, status: "issued", totalCents: 700, dueDate: "2000-01-01", paid: "0" },
      { id: "g1", clientUserId: null, accountId: null, status: "issued", totalCents: 100, dueDate: null, paid: "0" },
    ],
    PRACTICES, ORGS,
    [{ id: "doc9", name: "Dr Nine", accountNumber: "9", practice: "Nine Dental" }],
  ] });
  const ar = await svc.listReceivables({ groupBy: "organization" }, db);
  const row = ar.rows.find((r) => r.unassigned);
  assert.deepEqual([row.accountId, row.ownerUserId, row.name, row.organizationId, row.balanceCents, row.pastDueCents], [null, "doc9", "Nine Dental", null, 700, 700]);
  assert.equal(ar.rows.length, 4);
  assert.equal(ar.totals.balanceCents, 30700, "grand totals include the unassigned money");
  assert.ok(ar.groups.every((g) => !g.accountIds.includes(null)), "never in a group");
  assert.equal(ar.groups[0].totalCents, 28000);
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

test("a practice statement is billed to the practice at its owner's doctor-profile address (the one header builder)", async () => {
  const db = fakeTx({ selects: [
    [{ id: "A1", name: "Alpha Dental", accountNumber: "1001", address1: "1 Main St", address2: "Suite 2", city: "Austin", state: "TX", zip: "78701" }],
    [],
  ] });
  const m = await svc.practiceStatementFor("A1", "2026-10", { generatedAt: new Date("2026-11-02T15:00:00Z") }, db);
  assert.deepEqual(m.billTo, ["Alpha Dental", "1 Main St", "Suite 2", "Austin, TX 78701", "Account 1001"]);
  // The address is the account OWNER's profile, joined in the same query.
  const q = db.log.find((l) => l.op === "select");
  assert.ok(q.calls.includes("leftJoin"));
  assert.match(source, /leftJoin\(doctorProfiles, eq\(doctorProfiles\.userId, accounts\.ownerId\)\)/);
  // An owner with no profile: no address, never someone else's.
  assert.deepEqual(svc.practiceHeader({ id: "A2", name: "Beta", accountNumber: null }), { practice: "Beta", accountNumber: null, address1: null, address2: null, city: null, state: null, zip: null });
  // The combined statement is billed to the group by name only (a group has no single owner).
  const group = fakeTx({ selects: [[{ id: "A1", name: "Alpha Dental", accountNumber: "1001", address1: "1 Main St", city: "Austin", state: "TX", zip: "78701" }], []] });
  const c = await svc.combinedStatementFor({ id: "G1", name: "Smile Group", accountIds: ["A1"] }, "2026-10", { generatedAt: new Date("2026-11-02T15:00:00Z") }, group);
  assert.deepEqual(c.billTo, ["Smile Group"]);
});

test("the receivables query takes groupBy (account by default) and the invoice list filters by practice account", async () => {
  const { receivablesQuerySchema, invoiceListQuerySchema } = await import("@my-app/shared");
  assert.equal(receivablesQuerySchema.parse({}).groupBy, "account");
  assert.equal(receivablesQuerySchema.parse({ groupBy: "organization" }).groupBy, "organization");
  assert.equal(receivablesQuerySchema.safeParse({ groupBy: "client" }).success, false);
  assert.equal(invoiceListQuerySchema.parse({ accountId: "A1" }).accountId, "A1");
  const { renderSql } = await import("../../test/sql-text.js");
  const { invoiceListWhere } = await import("./invoice-queries.js");
  assert.match(renderSql(invoiceListWhere({ accountId: "A1" })).text, /invoices\.account_id = \$\d+/);
});
