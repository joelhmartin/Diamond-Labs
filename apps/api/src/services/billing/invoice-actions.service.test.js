import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// The per-invoice locks go through config/redis.js; an in-memory store stands in.
const lockStore = new Map();
vi.mock("../../config/redis.js", () => ({
  redis: {
    async set(key, val, _ex, _ttl, nx) { if (nx && lockStore.has(key)) return null; lockStore.set(key, val); return "OK"; },
    async del(key) { lockStore.delete(key); return 1; },
    async get(key) { return lockStore.get(key) ?? null; },
  },
}));
const recorded = [];
let verifyResult = null;
vi.mock("../payment-recording.service.js", () => ({
  verifyAllocations: async () => verifyResult,
  recordPaymentAndAllocations: async (args) => { recorded.push(args); return { ledgerWriteFailed: false }; },
}));

const { fakeTx, fakeDb } = await import("../../test/fake-tx.js");
const actions = await import("./invoice-actions.service.js");
const { InvoiceError } = await import("./invoice-rules.js");
const { decryptField } = await import("../../lib/crypto.js");
const source = readFileSync(fileURLToPath(new URL("./invoice-actions.service.js", import.meta.url)), "utf8");
const isCode = (code) => (e) => e instanceof InvoiceError && e.code === code;

beforeEach(() => { lockStore.clear(); recorded.length = 0; verifyResult = null; });

const draftRow = { id: "inv1", invoiceNumber: 500001, status: "draft", version: 2, totalCents: 10000, notes: null, voidReason: null, clientUserId: "doc1" };
const lineRow = { id: "l1", position: 0, kind: "item", description: "DDSO", qty: 1, unitCents: 10000, lineCents: 10000, taxable: false, priceSource: "client", priceNote: null };

test("editDraft: a stale version is refused before any write", async () => {
  const tx = fakeTx({ selects: [[draftRow]] });
  await assert.rejects(actions.editDraft("inv1", { edit: { op: "notes", notes: "x" }, expectedVersion: 1, byUserId: "a1" }, fakeDb(tx)), isCode("STALE"));
  assert.equal(tx.log.filter((l) => ["update", "insert", "delete"].includes(l.op)).length, 0);
});

test("editDraft: a price override seals its reason, recomputes totals and audits without the reason", async () => {
  const tx = fakeTx({ selects: [[draftRow], [lineRow]], updates: [undefined, [{ ...draftRow, version: 3, totalCents: 9000 }]] });
  const out = await actions.editDraft("inv1", {
    edit: { op: "update", lineId: "l1", unitCents: 9000, reason: "courtesy for Jane Doe" }, expectedVersion: 2, byUserId: "a1",
  }, fakeDb(tx));
  assert.equal(out.version, 3);
  const sets = tx.log.filter((l) => l.op === "set").map((l) => l.values);
  assert.equal(decryptField(sets[0].priceNote), "courtesy for Jane Doe");
  assert.equal(sets[1].totalCents, 9000);
  const audit = tx.log.filter((l) => l.op === "insert").at(-1).values;
  assert.equal(audit.action, "invoice.edited");
  assert.ok(!JSON.stringify(audit.metadata).includes("Jane"));
});

test("issueInvoice: an unpriced draft can't be issued by hand either", async () => {
  const tx = fakeTx({ selects: [[draftRow], [{ ...lineRow, priceSource: "unpriced" }]] });
  await assert.rejects(actions.issueInvoice("inv1", { expectedVersion: 2, byUserId: "a1" }, fakeDb(tx)), isCode("INVALID"));
});

test("voidInvoice: refused once money is applied; runs under the invoice's payment lock", async () => {
  const issued = { ...draftRow, status: "issued" };
  const tx = fakeTx({ selects: [[issued], [{ invoiceId: "inv1", paid: "2500" }]] });
  await assert.rejects(actions.voidInvoice("inv1", { reason: "wrong client", expectedVersion: 2, byUserId: "a1" }, fakeDb(tx)), isCode("INVALID_TRANSITION"));
  assert.equal(tx.log.filter((l) => l.op === "set").length, 0);
  lockStore.set("chargeguard:inv:inv1", "1"); // a doctor's card payment is mid-flight
  await assert.rejects(actions.voidInvoice("inv1", { reason: "x", expectedVersion: 2, byUserId: "a1" }, fakeDb(fakeTx())), isCode("LOCKED"));
});

test("recordCredit: a ledger row with a sealed reason, a credit: id and no card", async () => {
  const issued = { ...draftRow, status: "issued" };
  const tx = fakeTx({ selects: [[issued], [{ invoiceId: "inv1", paid: "4000" }]] });
  const out = await actions.recordCredit("inv1", { amountCents: 2500, reason: "shade mismatch", byUserId: "a1" }, fakeDb(tx));
  assert.equal(out.balanceCents, 3500);
  const [row, audit] = tx.log.filter((l) => l.op === "insert").map((l) => l.values);
  assert.deepEqual([row.source, row.appliedCents, row.userId, row.invoiceId], ["credit", 2500, "doc1", "inv1"]);
  assert.equal(row.transactionId, `credit:${row.id}`);
  assert.equal(decryptField(row.note), "shade mismatch");
  assert.deepEqual(audit.metadata, { invoiceNumber: 500001, amountCents: 2500 });
  await assert.rejects(
    actions.recordCredit("inv1", { amountCents: 6001, reason: "x", byUserId: "a1" }, fakeDb(fakeTx({ selects: [[issued], [{ invoiceId: "inv1", paid: "4000" }]] }))),
    isCode("OVERPAY"),
  );
});

test("recordManualPayment: oldest-first, re-verified under the lock, recorded as received (not charged)", async () => {
  const db = fakeTx({ selects: [
    [{ id: "doc1", email: "d@x.com", name: "Dr", role: "doctor" }],
    [{ id: "a", clientUserId: "doc1", invoiceNumber: 500001, status: "issued", totalCents: 20000, dueDate: "2026-09-30", issuedAt: new Date("2026-08-31T15:00:00Z") }],
    [],
  ] });
  const out = await actions.recordManualPayment({
    clientUserId: "doc1", method: "check", reference: " 1042 ", amountCents: 15000, paidOn: "2026-09-15", byUserId: "a1",
  }, db);
  assert.match(out.transactionId, /^OFFLINE-/);
  assert.deepEqual(recorded[0].allocations, [{ invoiceId: "a", invoiceNumber: "500001", amountCents: 15000 }]);
  assert.deepEqual(
    [recorded[0].source, recorded[0].wasCharged, recorded[0].paidOn, recorded[0].reference, recorded[0].actorUserId, recorded[0].auditAction],
    ["admin_check", false, "2026-09-15", "1042", "a1", "payment.manual_recorded"],
  );
});

test("Record payment's picker and the default allocation read the same practice-wide list", async () => {
  const issuedAt = new Date("2026-08-31T15:00:00Z");
  const queue = () => [
    [{ id: "doc1", email: "d@x.com", name: "Dr", role: "doctor", seazonaClientId: "c1" }],
    [{ id: "doc1" }, { id: "colleague" }],
    [
      { id: "mine", clientUserId: "doc1", ownerSeazonaClientId: "c1", ownerName: "Dr One", invoiceNumber: 500002, status: "issued", totalCents: 5000, dueDate: "2026-10-31", issuedAt },
      { id: "theirs", clientUserId: "colleague", ownerSeazonaClientId: "c1", ownerName: "Dr Two", invoiceNumber: 500001, status: "issued", totalCents: 5000, dueDate: "2026-09-30", issuedAt },
    ],
    [],
  ];
  recorded.length = 0;
  const picker = await actions.openInvoicesForClientUser("doc1", fakeTx({ selects: queue() }));
  assert.deepEqual(picker.map((i) => [i.id, i.clientUserId, i.ownerName]), [["theirs", "colleague", "Dr Two"], ["mine", "doc1", "Dr One"]]);
  await actions.recordManualPayment({ clientUserId: "doc1", method: "check", amountCents: 7000, paidOn: "2026-09-15", byUserId: "a1" }, fakeTx({ selects: queue() }));
  // The default plan spreads over exactly the rows the picker showed, in the same order.
  assert.deepEqual(recorded[0].allocations.map((a) => a.invoiceId), picker.map((i) => i.id));
  assert.deepEqual(recorded[0].allocations.map((a) => a.amountCents), [5000, 2000]);
});

test("one source for the practice's open invoices: the endpoint and recordManualPayment share the loader", () => {
  const route = readFileSync(fileURLToPath(new URL("../../routes/admin-invoice.routes.js", import.meta.url)), "utf8");
  assert.match(route, /request\.query\.open\s*\?\s*actions\.openInvoicesForClientUser\(request\.params\.userId\)/);
  assert.match(source, /export async function openInvoicesForClientUser[\s\S]*?openInvoicesForClient\(await loadPayingClient/);
  const manual = source.slice(source.indexOf("export async function recordManualPayment"));
  assert.match(manual, /await loadPayingClient\(clientUserId, database\);[\s\S]*?await openInvoicesForClient\(client, database\)/);
});

test("recordManualPayment: a race lost under the lock is refused, nothing recorded; non-doctors are not clients", async () => {
  verifyResult = { kind: "validation", message: "exceeds its balance" };
  const db = fakeTx({ selects: [
    [{ id: "doc1", email: "d@x.com", role: "doctor" }],
    [{ id: "a", clientUserId: "doc1", invoiceNumber: 500001, status: "issued", totalCents: 20000, dueDate: null, issuedAt: new Date("2026-08-31T15:00:00Z") }],
    [],
  ] });
  await assert.rejects(actions.recordManualPayment({ clientUserId: "doc1", method: "cash", amountCents: 100, paidOn: "2026-09-15", byUserId: "a1" }, db), isCode("OVERPAY"));
  assert.equal(recorded.length, 0);
  await assert.rejects(
    actions.recordManualPayment({ clientUserId: "x", method: "cash", amountCents: 100, paidOn: "2026-09-15" }, fakeTx({ selects: [[{ id: "x", role: "admin" }]] })),
    isCode("NOT_FOUND"),
  );
});

test("every balance-changing action holds the same per-invoice lock card payments take", () => {
  const bodyOf = (marker) => {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, marker);
    const next = source.indexOf("\nexport ", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  };
  for (const fn of ["export function voidInvoice", "export function recordCredit", "export async function recordManualPayment"]) {
    assert.match(bodyOf(fn), /underInvoiceLocks\(/, fn);
  }
  assert.match(source, /\.for\("update"\)/);
});
