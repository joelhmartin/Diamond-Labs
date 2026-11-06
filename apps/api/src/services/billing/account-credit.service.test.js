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
const { recordAccountCredit, creditableInvoices } = await import("./account-credit.service.js");
const { InvoiceError } = await import("./invoice-rules.js");
const { decryptField } = await import("../../lib/crypto.js");
const { buildStatementModel } = await import("./statement-model.js");
const { ledgerEntryKind } = await import("./invoice-views.js");
const isCode = (code) => (e) => e instanceof InvoiceError && e.code === code;
const source = readFileSync(fileURLToPath(new URL("./account-credit.service.js", import.meta.url)), "utf8");

beforeEach(() => lockStore.clear());

const issuedAt = new Date("2026-08-31T15:00:00Z");
const inv = (id, number, totalCents, dueDate) => ({ id, clientUserId: "doc1", accountId: "a1", invoiceNumber: number, status: "issued", totalCents, dueDate, issuedAt, version: 1 });
const A = inv("a", 500001, 20000, "2026-09-30");
const B = inv("b", 500002, 30000, "2026-10-30");

// Select order: the practice (a client account), its open invoices, their paid sums, then under
// the lock one FOR UPDATE row per allocated invoice and one paid-sum re-read.
const queue = ({ paid = [], locked = [A, B], open = [A, B] } = {}) => [
  [{ id: "a1" }],
  open,
  paid,
  ...locked.map((r) => [r]),
  paid,
];

test("credit spreads oldest-first, one transaction id and source credit on every row; reason sealed; audits carry no text", async () => {
  const tx = fakeTx({ selects: queue() });
  const out = await recordAccountCredit({ accountId: "a1", amountCents: 25000, reason: "lost shipment Jane Doe", byUserId: "adm" }, tx);
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
  await assert.rejects(recordAccountCredit({ accountId: "a1", amountCents: 50001, reason: "x", byUserId: "adm" }, tx), isCode("OVERPAY"));
  assert.equal(tx.log.filter((l) => l.op === "insert").length, 0);
});

test("reason is required", async () => {
  await assert.rejects(recordAccountCredit({ accountId: "a1", amountCents: 100, reason: " ", byUserId: "adm" }, fakeTx({ selects: queue() })), isCode("REASON_REQUIRED"));
});

test("a payment landing between the read and the lock is re-checked: the credit is refused", async () => {
  const tx = fakeTx({ selects: [
    [{ id: "a1" }], [A, B], [],
    [A], [{ invoiceId: "a", paid: "15000" }], // under the lock, a has only 5000 left
  ] });
  await assert.rejects(recordAccountCredit({ accountId: "a1", amountCents: 20000, reason: "x", byUserId: "adm" }, tx), isCode("OVERPAY"));
  assert.equal(tx.log.filter((l) => l.op === "insert").length, 0);
});

test("a held card-payment lock is a 409 LOCKED; an unknown or non-client practice and a non-doctor are NOT_FOUND", async () => {
  await assert.rejects(recordAccountCredit({ accountId: "nope", amountCents: 100, reason: "x", byUserId: "adm" }, fakeTx({ selects: [[]] })), isCode("NOT_FOUND"));
  lockStore.set("chargeguard:inv:a", "1");
  await assert.rejects(recordAccountCredit({ accountId: "a1", amountCents: 100, reason: "x", byUserId: "adm" }, fakeTx({ selects: queue() })), isCode("LOCKED"));
  await assert.rejects(recordAccountCredit({ clientUserId: "x", amountCents: 100, reason: "x", byUserId: "adm" }, fakeTx({ selects: [[{ id: "x", role: "admin" }]] })), isCode("NOT_FOUND"));
});

test("the credit sends no email and runs under the invoice locks", () => {
  assert.doesNotMatch(source, /email\.service|sendStatementNotice|notify/);
  assert.match(source, /underInvoiceLocks\(/);
});

test("the statement model shows each row as Credit", async () => {
  const tx = fakeTx({ selects: queue() });
  const out = await recordAccountCredit({ accountId: "a1", amountCents: 25000, reason: "x", byUserId: "adm" }, tx);
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

// ---- one receivables row, never its siblings ----

const SIB = { ...inv("s", 500003, 40000, "2026-08-01"), accountId: "b2", clientUserId: "doc1" }; // sibling practice B, same owner, oldest due
const U = { ...inv("u", 500004, 10000, "2026-07-01"), accountId: null }; // doc1's unassigned invoice

test("a credit on practice A never touches sibling practice B's invoices, even with the same owner and an older due date", async () => {
  // Even if a query answered B's row, the JS re-filter drops it: the plan is A's only.
  const tx = fakeTx({ selects: queue({ open: [SIB, A, B] }) });
  const out = await recordAccountCredit({ accountId: "a1", amountCents: 25000, reason: "x", byUserId: "adm" }, tx);
  assert.deepEqual(out.allocations.map((a) => a.invoiceId), ["a", "b"]);
  const rows = tx.log.filter((l) => l.op === "insert").map((l) => l.values).filter((v) => v.source);
  assert.ok(rows.every((r) => r.invoiceId !== "s"));
  // Naming B's invoice outright is refused before anything is written.
  const named = fakeTx({ selects: queue({ open: [SIB, A, B] }) });
  await assert.rejects(recordAccountCredit({ accountId: "a1", amountCents: 100, reason: "x", allocations: [{ invoiceId: "s", amountCents: 100 }], byUserId: "adm" }, named), (e) => isCode("INVALID")(e) && /isn't open/.test(e.message));
  assert.equal(named.log.filter((l) => l.op === "insert").length, 0);
  // The picker is the same list.
  assert.deepEqual((await creditableInvoices({ accountId: "a1" }, fakeTx({ selects: [[{ id: "a1" }], [SIB, A], []] }))).map((i) => i.id), ["a"]);
});

test("an invoice moved to another practice between the read and the lock is refused, nothing written", async () => {
  const tx = fakeTx({ selects: queue({ locked: [{ ...A, accountId: "b2" }, B] }) });
  await assert.rejects(recordAccountCredit({ accountId: "a1", amountCents: 25000, reason: "x", byUserId: "adm" }, tx), isCode("INVALID"));
  assert.equal(tx.log.filter((l) => l.op === "insert").length, 0);
});

test("an Unassigned row's credit (by client) lands on that client's unassigned invoices only, never a practice's", async () => {
  // Select order: the client, their unassigned open invoices, paid sums, the lock row, paid re-read.
  const client = [{ id: "doc1", email: "d@x.com", name: "Dr", role: "doctor" }];
  const tx = fakeTx({ selects: [client, [U, A], [], [U], []] });
  const out = await recordAccountCredit({ clientUserId: "doc1", amountCents: 10000, reason: "x", byUserId: "adm" }, tx);
  assert.deepEqual(out.allocations.map((a) => [a.invoiceId, a.amountCents]), [["u", 10000]]);
  await assert.rejects(recordAccountCredit({ clientUserId: "doc1", amountCents: 10001, reason: "x", byUserId: "adm" }, fakeTx({ selects: [client, [U, A], []] })), isCode("OVERPAY"));
  assert.deepEqual((await creditableInvoices({ clientUserId: "doc1" }, fakeTx({ selects: [client, [U, A, SIB], []] }))).map((i) => i.id), ["u"]);
  // Assigned to a practice since the read: refused under the lock.
  const moved = fakeTx({ selects: [client, [U], [], [{ ...U, accountId: "a1" }], []] });
  await assert.rejects(recordAccountCredit({ clientUserId: "doc1", amountCents: 100, reason: "x", byUserId: "adm" }, moved), isCode("INVALID"));
});
