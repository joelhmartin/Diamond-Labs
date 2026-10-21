process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeTx } from "../test/fake-tx.js";

const { loadInvoices } = await import("./load-invoices.js");
const load = (n) => JSON.parse(readFileSync(new URL(`../../test-fixtures/seazona/${n}`, import.meta.url), "utf8"));
const asRecords = (list) => list.map((p) => ({ seazonaId: p.id, payload: p, lastModified: p.lastModified ?? null }));
const raw = {
  records: async (e) => ({ invoice: asRecords(load("invoices.json")), invoice_detail: asRecords(load("invoice-details.json")) })[e] ?? [],
};
const doctor = { role: "doctor", approvalStatus: "approved", status: "active", emailVerifiedAt: new Date(0), hasPassword: true, createdAt: new Date(0) };
const users = [
  { ...doctor, id: "u-1324", seazonaClientId: "c-1324", seazonaAccountNumber: "1324" },
  { ...doctor, id: "u-2001", seazonaClientId: "c-2001", seazonaAccountNumber: "2001" },
];
// Select order: seed counts (invoices, lab orders), owners, existing invoices.
const db = (existing = [], owners = users) => fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], owners, existing] });

test("dry run: counts and seeds, no writes, no PHI in the report", async () => {
  const tx = db();
  const report = await loadInvoices({ raw, db: tx, live: false, target: "rehearsal", starts: {} });
  assert.equal(report.counts.toInsert, 4);
  assert.equal(report.seeds.seazonaMax.invoice, 11130);
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.ok(!JSON.stringify(report).includes("Test Patient"));
});

test("live: invoices sealed, lines sealed, each invoice's lines follow it", async () => {
  const tx = db();
  const report = await loadInvoices({ raw, db: tx, live: true, target: "rehearsal", starts: {} });
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  const invoiceRows = inserts.find((v) => v[0]?.kind === "legacy");
  assert.equal(invoiceRows.length, 4);
  assert.match(invoiceRows[0].legacyPatient, /^enc:v1:/);
  const lineRows = inserts.filter((v) => v[0]?.priceSource === "legacy").flat();
  assert.equal(lineRows.length, 6, "inv-a, inv-c, inv-d one line each; inv-b three");
  assert.ok(lineRows.some((l) => /^enc:v1:/.test(l.legacyDescription ?? "")));
  assert.equal(report.written.invoices, 4);
  assert.ok(!JSON.stringify(inserts).includes("Test Patient"));
});

test("a re-run inserts nothing new", async () => {
  const existing = ["inv-a", "inv-b", "inv-c", "inv-d"].map((id, i) => ({ seazonaId: id, number: 11114 + i, clientUserId: "u" }));
  const tx = db(existing);
  const report = await loadInvoices({ raw, db: tx, live: true, target: "rehearsal", starts: {} });
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.equal(report.counts.alreadyLoaded, 4);
});

test("an invoice whose client is linked to a non-approved or unverified user is reported, never owned", async () => {
  const stranger = { ...users[0], role: "user", approvalStatus: "not_required" };
  const unverified = { ...users[1], emailVerifiedAt: null, hasPassword: true };
  const tx = db([], [stranger, unverified]);
  const report = await loadInvoices({ raw, db: tx, live: true, target: "rehearsal", starts: {} });
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  const p = report.problems.find((x) => x.kind === "client_owner_not_approved_doctor");
  assert.deepEqual(p.seazonaIds, ["c-1324", "c-2001"], "clients, not invoices");
  assert.equal(p.count, 2);
  assert.equal(report.counts.skippedNoOwner, 5);
});

test("an import shell (passwordless, unverified placeholder doctor) owns its client's invoices", async () => {
  const shell = { ...users[0], emailVerifiedAt: null, hasPassword: false, status: "suspended" };
  const report = await loadInvoices({ raw, db: db([], [shell, users[1]]), live: false, target: "rehearsal", starts: {} });
  assert.equal(report.counts.toInsert, 4);
});

test("a live production load is refused when the invoice start is not above Seazona's highest", async () => {
  await assert.rejects(loadInvoices({ raw, db: db(), live: true, target: "production", starts: { invoice: 11130 } }), /INVOICE_NUMBER_START/);
});

test("legacy rows keep Seazona's numbers (no allocator)", async () => {
  const tx = db();
  await loadInvoices({ raw, db: tx, live: true, target: "rehearsal", starts: {} });
  const rows = tx.log.filter((e) => e.op === "insert").map((e) => e.values).find((v) => v[0]?.kind === "legacy");
  assert.deepEqual(rows.map((r) => r.invoiceNumber), [11114, 11115, 11120, 11121]);
});

test("a re-run reattaches an unowned loaded invoice once its client has exactly one eligible owner", async () => {
  const existing = ["inv-a", "inv-b", "inv-c", "inv-d"].map((id, i) => ({ seazonaId: id, number: 11114 + i, clientUserId: id === "inv-d" ? "someone" : null }));
  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing], updates: [[{ id: "i1" }, { id: "i2" }], [{ id: "i3" }]] });
  const report = await loadInvoices({ raw, db: tx, live: true, target: "rehearsal", starts: {} });
  assert.equal(report.counts.reattached, 3);
  const sets = tx.log.filter((e) => e.op === "set").map((e) => e.values.clientUserId);
  assert.deepEqual(sets, ["u-1324", "u-2001"], "inv-d already has an owner and is never touched");
});

test("a dry run reports the reattach without writing", async () => {
  const existing = [{ seazonaId: "inv-a", number: 11114, clientUserId: null }];
  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing] });
  const report = await loadInvoices({ raw, db: tx, live: false, target: "rehearsal", starts: {} });
  assert.equal(report.counts.reattached, 1);
  assert.equal(tx.log.some((e) => e.op === "update"), false);
});

test("an ambiguous client stays unowned (not reattached)", async () => {
  const dup = [users[0], { ...users[0], id: "u-other" }, users[1]];
  const existing = [{ seazonaId: "inv-a", number: 11114, clientUserId: null }];
  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], dup, existing] });
  const report = await loadInvoices({ raw, db: tx, live: true, target: "rehearsal", starts: {} });
  assert.equal(report.counts.reattached, 0);
  assert.deepEqual(report.problems.find((p) => p.kind === "client_has_multiple_owners").seazonaIds, ["c-1324"]);
});
