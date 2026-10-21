process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";

const { loadBalances, writeOpening } = await import("./load-balances.js");
const { ImportRefusal } = await import("./import-errors.js");

const legacyRows = [
  { id: "id-1", invoiceNumber: 1, kind: "legacy", legacySeazonaInvoiceId: "inv-1", clientUserId: "u", status: "issued", totalCents: 1000, issuedAt: new Date("2026-01-01T17:00:00Z") },
  { id: "id-2", invoiceNumber: 2, kind: "legacy", legacySeazonaInvoiceId: "inv-2", clientUserId: "u", status: "issued", totalCents: 500, issuedAt: new Date("2026-01-02T17:00:00Z") },
];
const parsed = { rows: [{ key: 1, cents: 400, line: 2 }], problems: [] };
const raw = { records: async () => [] };
const noPayments = async () => new Map();
const base = { raw, target: "rehearsal", paidCents: noPayments };

test("per-invoice live: settlement rows are written once", async () => {
  const tx = fakeTx({ selects: [legacyRows, []] });
  const report = await loadBalances({ ...base, db: tx, live: true, mode: "per-invoice", parsed, fileId: "f1" });
  const rows = tx.log.filter((e) => e.op === "insert").flatMap((e) => e.values);
  assert.deepEqual(rows.map((r) => [r.transactionId, r.appliedCents]), [["legacy:inv-1", 600], ["legacy:inv-2", 500]]);
  assert.equal(report.counts.openCents, 400);
  assert.equal(report.written.settlements, 2);

  const again = fakeTx({ selects: [legacyRows, [{ transactionId: "legacy:inv-1" }, { transactionId: "legacy:inv-2" }]] });
  await loadBalances({ ...base, db: again, live: true, mode: "per-invoice", parsed, fileId: "f1" });
  assert.equal(again.log.some((e) => e.op === "insert"), false);
});

test("a dry run writes nothing and the report carries counts and ids only", async () => {
  const tx = fakeTx({ selects: [legacyRows, []] });
  const report = await loadBalances({ ...base, db: tx, live: false, mode: "per-invoice", parsed });
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.equal(report.counts.settlements, 2);
});

test("an invoice with real payments is skipped and reported, and only unsettled invoices are summed", async () => {
  const asked = [];
  const paidCents = async (ids) => { asked.push(ids); return new Map([["id-1", 250]]); };
  const tx = fakeTx({ selects: [legacyRows, [{ transactionId: "legacy:inv-2" }]] });
  const report = await loadBalances({ ...base, paidCents, db: tx, live: true, mode: "per-invoice", parsed });
  assert.deepEqual(asked, [["id-1"]], "inv-2 already has its settlement row, so its payments are not looked up");
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.deepEqual(report.problems.find((p) => p.kind === "invoice_has_real_payments_not_settled"), { kind: "invoice_has_real_payments_not_settled", count: 1, seazonaIds: ["1"] });
});

test("a live run refuses an export with problems unless accepted; the problems are always in the report", async () => {
  const bad = { rows: parsed.rows, problems: [{ kind: "export-row-bad-balance", count: 1, seazonaIds: ["2"], lines: [7] }] };
  await assert.rejects(loadBalances({ ...base, db: fakeTx(), live: true, mode: "per-invoice", parsed: bad }), (e) => e instanceof ImportRefusal && /--accept-export-problems/.test(e.message) && !/Test/.test(e.message));
  const dry = await loadBalances({ ...base, db: fakeTx({ selects: [legacyRows, []] }), live: false, mode: "per-invoice", parsed: bad });
  assert.deepEqual(dry.exportProblems, bad.problems);
  const ok = await loadBalances({ ...base, db: fakeTx({ selects: [legacyRows, []] }), live: true, mode: "per-invoice", parsed: bad, acceptExportProblems: true });
  assert.equal(ok.written.settlements, 2);
});

test("switching paths on a loaded target is refused", async () => {
  const tx = fakeTx({ selects: [legacyRows, [{ transactionId: "legacy-full:inv-1" }]] });
  await assert.rejects(loadBalances({ ...base, db: tx, live: false, mode: "per-invoice", parsed }), ImportRefusal);
  const opened = [...legacyRows, { ...legacyRows[0], id: "o", legacySeazonaInvoiceId: "opening:9" }];
  await assert.rejects(loadBalances({ ...base, db: fakeTx({ selects: [opened, []] }), live: false, mode: "per-invoice", parsed }), /already loaded per-client/);
  const full = fakeTx({ selects: [legacyRows, [{ transactionId: "legacy:inv-1" }]] });
  await assert.rejects(loadBalances({ ...base, db: full, live: false, mode: "per-client", parsed }), /already loaded per-invoice/);
  await assert.rejects(loadBalances({ ...base, db: fakeTx(), live: false, mode: "both", parsed }), /per-invoice or per-client/);
  await assert.rejects(loadBalances({ raw, db: fakeTx(), live: false, target: "rehearsal", mode: "per-invoice", parsed }), /paidCents/);
});

const doctor = { role: "doctor", approvalStatus: "approved", status: "active", emailVerifiedAt: new Date(0), hasPassword: true, createdAt: new Date(0) };
const acct = { rows: [{ key: "1324", cents: 900, line: 2 }, { key: "2001", cents: 700, line: 3 }], problems: [] };
// Select order: legacy invoices, settlement rows, account owners, seed counts (invoices, lab orders).
const clientTx = (users) => fakeTx({ selects: [legacyRows, [], users, [{ n: 0 }], [{ n: 0 }]] });

test("per-client live: history settles in full, one opening invoice per owing account, ambiguous account opens unowned", async () => {
  const users = [
    { ...doctor, id: "u-1324", seazonaClientId: "c1", seazonaAccountNumber: "1324" },
    { ...doctor, id: "u-a", seazonaClientId: "c2", seazonaAccountNumber: "2001" },
    { ...doctor, id: "u-b", seazonaClientId: "c2", seazonaAccountNumber: "2001" },
  ];
  const tx = clientTx(users);
  const report = await loadBalances({ ...base, db: tx, live: true, mode: "per-client", parsed: acct, starts: { invoice: 16211 } });
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  const settlements = inserts.find((v) => v[0]?.source === "legacy_settlement");
  assert.deepEqual(settlements.map((r) => [r.transactionId, r.appliedCents]), [["legacy-full:inv-1", 1000], ["legacy-full:inv-2", 500]]);
  const openings = inserts.filter((v) => !Array.isArray(v) && v.kind === "legacy");
  assert.deepEqual(openings.map((o) => o.legacySeazonaInvoiceId), ["opening:1324", "opening:2001"]);
  assert.equal(report.counts.unownedOpenings, 1);
  assert.equal(report.written.openings, 2);
  assert.deepEqual(report.problems.find((p) => p.kind === "account_has_multiple_owners").seazonaIds, ["2001"]);
});

test("an opening invoice takes the next live invoice number and is sealed", async () => {
  const tx = fakeTx({ selects: [[{ max: 16210 }]] });
  const invoice = await writeOpening(tx, { opening: { accountNumber: "1324", clientUserId: "u", cents: 900 }, start: 16211, cutoverAt: new Date("2026-11-07T02:00:00Z") });
  assert.equal(invoice.invoiceNumber, 16211);
  assert.ok(tx.log.some((e) => e.op === "execute"), "under the invoice-number advisory lock");
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  assert.equal(inserts[0].legacySeazonaInvoiceId, "opening:1324");
  assert.equal(inserts[1][0].description, "Opening balance (carried from Seazona)");
});
