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

test("a statement is only for a doctor; drafts carry no money", async () => {
  assert.equal(await svc.statementFor("u1", "2026-10", {}, fakeTx({ selects: [[{ id: "u1", role: "admin", profile: null }]] })), null);
  assert.match(source, /ne\(invoices\.status, "draft"\)/);
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
