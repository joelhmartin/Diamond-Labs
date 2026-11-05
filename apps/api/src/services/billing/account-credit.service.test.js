import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const lockStore = new Map();
vi.mock("../../config/redis.js", () => ({
  redis: {
    async set(key, val, _ex, _ttl, nx) { if (nx && lockStore.has(key)) return null; lockStore.set(key, val); return "OK"; },
    async del(key) { lockStore.delete(key); return 1; },
    async get(key) { return lockStore.get(key) ?? null; },
  },
}));

const { fakeTx } = await import("../../test/fake-tx.js");
const { recordAccountCredit } = await import("./account-credit.service.js");
const { InvoiceError } = await import("./invoice-rules.js");
const { decryptField } = await import("../../lib/crypto.js");
const { buildStatementModel } = await import("./statement-model.js");
const { ledgerEntryKind } = await import("./invoice-views.js");
const isCode = (code) => (e) => e instanceof InvoiceError && e.code === code;
const source = readFileSync(fileURLToPath(new URL("./account-credit.service.js", import.meta.url)), "utf8");

beforeEach(() => lockStore.clear());

const issuedAt = new Date("2026-08-31T15:00:00Z");
const inv = (id, number, totalCents, dueDate) => ({ id, clientUserId: "doc1", invoiceNumber: number, status: "issued", totalCents, dueDate, issuedAt, version: 1 });
const A = inv("a", 500001, 20000, "2026-09-30");
const B = inv("b", 500002, 30000, "2026-10-30");

// Select order: client (no practice id, so no practice lookup), open invoices, their paid sums, then under
// the lock one FOR UPDATE row per allocated invoice and one paid-sum re-read.
const queue = ({ paid = [], locked = [A, B] } = {}) => [
  [{ id: "doc1", email: "d@x.com", name: "Dr", role: "doctor" }],
  [A, B],
  paid,
  ...locked.map((r) => [r]),
  paid,
];

test("credit spreads oldest-first, one transaction id and source credit on every row; reason sealed; audits carry no text", async () => {
  const tx = fakeTx({ selects: queue() });
  const out = await recordAccountCredit({ clientUserId: "doc1", amountCents: 25000, reason: "lost shipment Jane Doe", byUserId: "adm" }, tx);
  assert.deepEqual(out.allocations.map((a) => [a.invoiceId, a.amountCents]), [["a", 20000], ["b", 5000]]);
  assert.match(out.transactionId, /^credit:/);
  const inserts = tx.log.filter((l) => l.op === "insert").map((l) => l.values);
  const rows = inserts.filter((v) => v.source);
  const audits = inserts.filter((v) => v.action);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.transactionId === out.transactionId && r.source === "credit" && r.userId === "doc1"));
  assert.ok(rows.every((r) => decryptField(r.note) === "lost shipment Jane Doe"));
  assert.deepEqual(rows.map((r) => r.appliedCents), [20000, 5000]);
  assert.deepEqual(audits.map((a) => [a.action, a.targetId, a.metadata.amountCents, a.metadata.accountCredit]), [
    ["invoice.credited", "a", 20000, true], ["invoice.credited", "b", 5000, true],
  ]);
  assert.ok(!JSON.stringify(audits).includes("Jane"));
});

test("credit larger than the open balance is OVERPAY and writes nothing", async () => {
  const tx = fakeTx({ selects: queue() });
  await assert.rejects(recordAccountCredit({ clientUserId: "doc1", amountCents: 50001, reason: "x", byUserId: "adm" }, tx), isCode("OVERPAY"));
  assert.equal(tx.log.filter((l) => l.op === "insert").length, 0);
});

test("reason is required", async () => {
  await assert.rejects(recordAccountCredit({ clientUserId: "doc1", amountCents: 100, reason: " ", byUserId: "adm" }, fakeTx({ selects: queue() })), isCode("REASON_REQUIRED"));
});

test("a payment landing between the read and the lock is re-checked: the credit is refused", async () => {
  const tx = fakeTx({ selects: [
    [{ id: "doc1", role: "doctor" }], [A, B], [],
    [A], [{ invoiceId: "a", paid: "15000" }], // under the lock, a has only 5000 left
  ] });
  await assert.rejects(recordAccountCredit({ clientUserId: "doc1", amountCents: 20000, reason: "x", byUserId: "adm" }, tx), isCode("OVERPAY"));
  assert.equal(tx.log.filter((l) => l.op === "insert").length, 0);
});

test("a held card-payment lock is a 409 LOCKED; non-doctors are not clients", async () => {
  lockStore.set("chargeguard:inv:a", "1");
  await assert.rejects(recordAccountCredit({ clientUserId: "doc1", amountCents: 100, reason: "x", byUserId: "adm" }, fakeTx({ selects: queue() })), isCode("LOCKED"));
  await assert.rejects(recordAccountCredit({ clientUserId: "x", amountCents: 100, reason: "x", byUserId: "adm" }, fakeTx({ selects: [[{ id: "x", role: "admin" }]] })), isCode("NOT_FOUND"));
});

test("the credit sends no email and runs under the invoice locks", () => {
  assert.doesNotMatch(source, /email\.service|sendStatementNotice|notify/);
  assert.match(source, /underInvoiceLocks\(/);
});

test("the statement model shows each row as Credit", async () => {
  const tx = fakeTx({ selects: queue() });
  const out = await recordAccountCredit({ clientUserId: "doc1", amountCents: 25000, reason: "x", byUserId: "adm" }, tx);
  const payments = tx.log.filter((l) => l.op === "insert").map((l) => l.values).filter((v) => v.source)
    .map((r) => ({ ...r, paidOn: "2026-10-15", createdAt: new Date("2026-10-15T15:00:00Z") }));
  assert.ok(payments.every((p) => ledgerEntryKind(p) === "credit" && p.transactionId === out.transactionId));
  const model = buildStatementModel(
    { name: "Dr", email: "d@x.com" },
    { invoices: [{ ...A, labOrderNumber: null, voidedAt: null }, { ...B, labOrderNumber: null, voidedAt: null }], payments },
    { month: "2026-10" },
    { generatedAt: new Date("2026-11-01T15:00:00Z"), labName: "Lab" },
  );
  const credits = model.lines.filter((l) => l.kind === "credit");
  assert.deepEqual(credits.map((l) => l.description), ["Credit — invoice #500001", "Credit — invoice #500002"]);
  assert.equal(model.closingCents, 25000);
});
