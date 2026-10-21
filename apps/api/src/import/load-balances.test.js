process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";

const { loadBalances, writeOpening } = await import("./load-balances.js");
const { ImportRefusal } = await import("./import-errors.js");

const legacyRows = [
  { id: "id-1", invoiceNumber: 1, kind: "legacy", legacySeazonaInvoiceId: "inv-1", clientUserId: "u", legacyPatient: "enc-TestPatient-Jane", status: "issued", totalCents: 1000, issuedAt: new Date("2026-01-01T17:00:00Z") },
  { id: "id-2", invoiceNumber: 2, kind: "legacy", legacySeazonaInvoiceId: "inv-2", clientUserId: "u", status: "issued", totalCents: 500, issuedAt: new Date("2026-01-02T17:00:00Z") },
];
const parsed = { rows: [{ key: 1, cents: 400, line: 2 }], problems: [] };
const raw = { records: async () => [] };
const noPayments = async () => new Map();
const makeLock = (held = true) => ({ calls: [], tryLock: async () => held, assertHeld() { this.calls.push("assert"); }, close: async function () { this.calls.push("close"); } });
const base = { raw, target: "rehearsal", paidCents: noPayments, get lock() { return makeLock(); } };

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
  await assert.rejects(loadBalances({ ...base, db: fakeTx(), live: true, mode: "per-invoice", parsed: bad }), (e) => e instanceof ImportRefusal && /--accept-export-problems/.test(e.message) && /NO key.*PAID/.test(e.message));
  const dry = await loadBalances({ ...base, db: fakeTx({ selects: [legacyRows, []] }), live: false, mode: "per-invoice", parsed: bad });
  assert.deepEqual(dry.exportProblems, bad.problems);
  const ok = await loadBalances({ ...base, db: fakeTx({ selects: [legacyRows, []] }), live: true, mode: "per-invoice", parsed: bad, acceptExportProblems: true });
  assert.equal(ok.written.settlements, 1, "invoice 2 (unreadable balance) is left open, not settled as paid");
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

const PHI = "TestPatient-Jane";
const phiRows = legacyRows.map((r) => ({ ...r, legacyPatient: PHI, patient: PHI, fullName: PHI }));

test("no patient-like value reaches the report, the problems or the written rows", async () => {
  const bad = { rows: parsed.rows, problems: [{ kind: "export-row-no-key", count: 1, seazonaIds: [], lines: [9] }] };
  const tx = fakeTx({ selects: [phiRows, []] });
  const report = await loadBalances({ ...base, db: tx, live: true, mode: "per-invoice", parsed: bad, acceptExportProblems: true });
  assert.ok(report.written.settlements > 0);
  assert.ok(!JSON.stringify(report).includes(PHI));
  assert.ok(!JSON.stringify(tx.log.filter((e) => e.op === "insert")).includes(PHI));
  assert.ok(report.warnings[0].includes("NO key"));
});

const idList = (report, kind) => report.problems.find((p) => p.kind === kind)?.seazonaIds;

test("accepted export problems never zero a balance: those invoices stay open and are reported", async () => {
  const bad = {
    rows: [{ key: 1, cents: 400, line: 2 }],
    problems: [{ kind: "export-row-bad-balance", count: 1, seazonaIds: ["2"], lines: [3] }, { kind: "export-row-duplicate-key", count: 1, seazonaIds: ["1"], lines: [4] }],
  };
  const tx = fakeTx({ selects: [legacyRows, []] });
  const report = await loadBalances({ ...base, db: tx, live: true, mode: "per-invoice", parsed: bad, acceptExportProblems: true });
  assert.equal(tx.log.some((e) => e.op === "insert"), false, "neither invoice is settled");
  assert.deepEqual(idList(report, "invoice_left_open_export_problem"), ["1", "2"]);
  const r = report.reconciliation;
  assert.equal(r.loadedOpenCents, 1500, "both stay open at their full totals");
  assert.equal(r.exportCents, 400);
  assert.equal(r.differences.leftOpenExportProblem, 400 - 1500);
});

test("per-client: a left-open account's history stays unsettled and no opening is written", async () => {
  const users = [
    { ...doctor, id: "u", seazonaClientId: "c1", seazonaAccountNumber: "1324" },
    { ...doctor, id: "u-9", seazonaClientId: "c9", seazonaAccountNumber: "2001" },
  ];
  const other = { ...legacyRows[1], clientUserId: "u-9" };
  const bad = { rows: [{ key: "2001", cents: 700, line: 3 }], problems: [{ kind: "export-row-bad-balance", count: 1, seazonaIds: ["1324"], lines: [2] }] };
  const tx = fakeTx({ selects: [[legacyRows[0], other], [], users, [{ n: 0 }], [{ n: 0 }]] });
  const report = await loadBalances({ ...base, db: tx, live: true, mode: "per-client", parsed: bad, acceptExportProblems: true, starts: { invoice: 16211 } });
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  assert.deepEqual(inserts.find((v) => v[0]?.source === "legacy_settlement").map((r) => r.transactionId), ["legacy-full:inv-2"]);
  assert.deepEqual(inserts.filter((v) => !Array.isArray(v) && v.kind === "legacy").map((o) => o.legacySeazonaInvoiceId), ["opening:2001"]);
  assert.deepEqual(idList(report, "account_left_open_export_problem"), ["1324"]);
  assert.equal(report.counts.historyLeftOpen, 1);
});

test("the report reconciles to the cent: export = loaded open + every difference", async () => {
  const rows = [
    { id: "a", invoiceNumber: 10, kind: "legacy", legacySeazonaInvoiceId: "s10", clientUserId: "u", status: "issued", totalCents: 1000, issuedAt: new Date("2026-01-01T17:00:00Z") },
    { id: "b", invoiceNumber: 11, kind: "legacy", legacySeazonaInvoiceId: "s11", clientUserId: "u", status: "issued", totalCents: 1000, issuedAt: new Date("2026-01-01T17:00:00Z") },
    { id: "c", invoiceNumber: 12, kind: "legacy", legacySeazonaInvoiceId: "s12", clientUserId: "u", status: "issued", totalCents: 1000, issuedAt: new Date("2026-01-01T17:00:00Z") },
    { id: "d", invoiceNumber: 13, kind: "legacy", legacySeazonaInvoiceId: "s13", clientUserId: "u", status: "void", totalCents: 800, issuedAt: new Date("2026-01-01T17:00:00Z") },
    { id: "e", invoiceNumber: 14, kind: "legacy", legacySeazonaInvoiceId: "s14", clientUserId: null, status: "issued", totalCents: 600, issuedAt: new Date("2026-01-01T17:00:00Z") },
    { id: "f", invoiceNumber: 15, kind: "legacy", legacySeazonaInvoiceId: "s15", clientUserId: "u", status: "issued", totalCents: 900, issuedAt: new Date("2026-01-01T17:00:00Z") },
    { id: "g", invoiceNumber: 16, kind: "legacy", legacySeazonaInvoiceId: "s16", clientUserId: "u", status: "issued", totalCents: -500, issuedAt: new Date("2026-01-01T17:00:00Z") },
  ];
  const p = {
    rows: [
      { key: 10, cents: 400 }, { key: 11, cents: -250 }, { key: 12, cents: 1700 }, { key: 13, cents: 50 },
      { key: 14, cents: 600 }, { key: 15, cents: 300 }, { key: 16, cents: 0 }, { key: 99, cents: 123 },
    ],
    problems: [],
  };
  const paidCents = async () => new Map([["f", 100]]);
  const report = await loadBalances({ ...base, paidCents, db: fakeTx({ selects: [rows, []] }), live: false, mode: "per-invoice", parsed: p });
  const r = report.reconciliation;
  assert.deepEqual(r.differences, {
    credits: -250, unmatched: 123, overTotal: 700, negativeTotal: 500, openOnVoid: 50, skippedRealPayments: 300 - 900,
    leftOpenExportProblem: 0, unownedOpening: 600, accountWithoutClient: 0,
  });
  assert.equal(r.exportCents, 400 - 250 + 1700 + 50 + 600 + 300 + 123);
  assert.equal(r.exportCents, r.loadedOpenCents + Object.values(r.differences).reduce((n, c) => n + c, 0));
  assert.deepEqual(idList(report, "invoice_negative_total"), ["16"]);
});

test("per-client reconciles too, including unowned and unknown accounts and credits", async () => {
  const users = [
    { ...doctor, id: "u1", seazonaClientId: "c1", seazonaAccountNumber: " AB1 " },
    { ...doctor, id: "u2", seazonaClientId: "c2", seazonaAccountNumber: "2001" },
    { ...doctor, id: "u3", seazonaClientId: "c2", seazonaAccountNumber: "2001" },
  ];
  const p = { rows: [{ key: "ab1", cents: 900 }, { key: "2001", cents: 300 }, { key: "ZZ9", cents: 70 }, { key: "AB1x", cents: -5 }], problems: [] };
  const tx = fakeTx({ selects: [[], [], users, [{ n: 0 }], [{ n: 0 }]] });
  const report = await loadBalances({ ...base, db: tx, live: false, mode: "per-client", parsed: p });
  const r = report.reconciliation;
  assert.equal(r.loadedOpenCents, 900, "' AB1 ' and 'ab1' are the same account");
  assert.deepEqual(r.differences, { credits: 0, unmatched: 0, overTotal: 0, negativeTotal: 0, openOnVoid: 0, skippedRealPayments: 0, leftOpenExportProblem: 0, unownedOpening: 300, accountWithoutClient: 70 - 5 });
  assert.equal(r.exportCents, 900 + 300 + 70 - 5);
});

test("the load lock: held elsewhere refuses; a live run without one is a coding error; it is checked before writes and released after", async () => {
  await assert.rejects(loadBalances({ ...base, lock: makeLock(false), db: fakeTx(), live: true, mode: "per-invoice", parsed }), /load lock is held/);
  await assert.rejects(loadBalances({ ...base, lock: null, db: fakeTx(), live: true, mode: "per-invoice", parsed }), /load lock/);
  const lock = makeLock();
  await loadBalances({ ...base, lock, db: fakeTx({ selects: [legacyRows, []] }), live: true, mode: "per-invoice", parsed });
  assert.deepEqual(lock.calls, ["assert", "close"]);
  const lost = { ...makeLock(), assertHeld() { throw new Error("lost"); } };
  const tx = fakeTx({ selects: [legacyRows, []] });
  await assert.rejects(loadBalances({ ...base, lock: lost, db: tx, live: true, mode: "per-invoice", parsed }), /lost/);
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
});
