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
const verifyArgs = [];
vi.mock("../payment-recording.service.js", () => ({
  verifyAllocations: async (...args) => { verifyArgs.push(args); return verifyResult; },
  recordPaymentAndAllocations: async (args) => { recorded.push(args); return { ledgerWriteFailed: false }; },
}));

// The paying client's practice scope (the TARGET user's, never the acting staff member's).
const { toClientScope } = await import("../client-scope-rules.js");
const scopeOf = (roles) => toClientScope({ accountIds: Object.keys(roles), roles: new Map(Object.entries(roles)), via: new Map(), organizations: [] });
const scopeCalls = [];
let targetScope = scopeOf({ a1: "member" });
vi.mock("../client-scope.js", async () => ({
  ...(await import("../client-scope-rules.js")),
  loadClientScope: async (userId) => { scopeCalls.push(userId); return targetScope; },
}));

const { fakeTx, fakeDb } = await import("../../test/fake-tx.js");
const actions = await import("./invoice-actions.service.js");
const { InvoiceError } = await import("./invoice-rules.js");
const { decryptField } = await import("../../lib/crypto.js");
const source = readFileSync(fileURLToPath(new URL("./invoice-actions.service.js", import.meta.url)), "utf8");
const isCode = (code) => (e) => e instanceof InvoiceError && e.code === code;

beforeEach(() => { lockStore.clear(); recorded.length = 0; verifyResult = null; scopeCalls.length = 0; verifyArgs.length = 0; targetScope = scopeOf({ a1: "member" }); });

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
    [{ id: "a", clientUserId: "doc1", accountId: "a1", invoiceNumber: 500001, status: "issued", totalCents: 20000, dueDate: "2026-09-30", issuedAt: new Date("2026-08-31T15:00:00Z") }],
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

test("Record payment's picker and the default allocation read the same list: the target user's payable practices", async () => {
  const issuedAt = new Date("2026-08-31T15:00:00Z");
  targetScope = scopeOf({ a1: "member", a2: "org-admin", a3: "viewer" });
  const queue = () => [
    [{ id: "doc1", email: "d@x.com", name: "Dr", role: "doctor" }],
    [
      { id: "mine", clientUserId: "doc1", accountId: "a1", ownerName: "Dr One", invoiceNumber: 500002, status: "issued", totalCents: 5000, dueDate: "2026-10-31", issuedAt },
      { id: "theirs", clientUserId: "colleague", accountId: "a2", ownerName: "Dr Two", invoiceNumber: 500001, status: "issued", totalCents: 5000, dueDate: "2026-09-30", issuedAt },
    ],
    [],
  ];
  const picker = await actions.openInvoicesForClientUser("doc1", fakeTx({ selects: queue() }));
  assert.deepEqual(scopeCalls, ["doc1"], "the target's scope, loaded for the request");
  assert.deepEqual(picker.map((i) => [i.id, i.clientUserId, i.accountId]), [["theirs", "colleague", "a2"], ["mine", "doc1", "a1"]]);
  await actions.recordManualPayment({ clientUserId: "doc1", method: "check", amountCents: 7000, paidOn: "2026-09-15", byUserId: "a1" }, fakeTx({ selects: queue() }));
  // The default plan spreads over exactly the rows the picker showed, in the same order.
  assert.deepEqual(recorded[0].allocations.map((a) => a.invoiceId), picker.map((i) => i.id));
  assert.deepEqual(recorded[0].allocations.map((a) => a.amountCents), [5000, 2000]);
  assert.equal(recorded[0].user.id, "doc1", "recorded for (and receipted to) the client, not the staff member");
});

test("admin pay-as-client: the payable part of the TARGET user's scope; a viewer-only practice offers nothing", async () => {
  targetScope = scopeOf({ a3: "viewer" });
  const db = fakeTx({ selects: [[{ id: "doc1", role: "doctor" }]] });
  assert.deepEqual(await actions.openInvoicesForClientUser("doc1", db), []);
  assert.equal(db.log.length, 1, "only the client read: no invoice query for an empty payable scope");
});

test("recordManualPayment re-verifies against the target user's scope under the lock", async () => {
  const issuedAt = new Date("2026-08-31T15:00:00Z");
  const db = fakeTx({ selects: [
    [{ id: "doc1", role: "doctor" }],
    [{ id: "a", clientUserId: "doc1", accountId: "a1", invoiceNumber: 500001, status: "issued", totalCents: 20000, dueDate: null, issuedAt }],
    [],
  ] });
  await actions.recordManualPayment({ clientUserId: "doc1", method: "cash", amountCents: 100, paidOn: "2026-09-15", byUserId: "staff1" }, db);
  assert.equal(verifyArgs.length, 1);
  assert.equal(verifyArgs[0][1], targetScope, "the client's scope, not the staff member's");
  assert.equal(verifyArgs[0][2].enforceCap, true);
});

test("one source for the practice's open invoices: the endpoint and recordManualPayment share the loader", () => {
  const route = readFileSync(fileURLToPath(new URL("../../routes/admin-invoice.routes.js", import.meta.url)), "utf8");
  assert.match(route, /request\.query\.open\s*\?\s*actions\.openInvoicesForClientUser\(request\.params\.userId\)/);
  assert.match(source, /export async function openInvoicesForClientUser[\s\S]*?payableOpenInvoices\(await loadPayingClient\(/);
  const loader = source.slice(source.indexOf("export async function payableOpenInvoices"));
  assert.match(loader, /const scope = await loadClientScope\(client\.id, database\);[\s\S]*?openInvoicesForAccounts\(payableAccountIds\(scope\), database\)/);
  const manual = source.slice(source.indexOf("export async function recordManualPayment"));
  assert.match(manual, /const \{ scope, openInvoices \} = await payableOpenInvoices\(client, database\)/);
  assert.doesNotMatch(source, /seazonaClientId|openInvoicesForClient\b/);
});

test("recordManualPayment: a race lost under the lock is refused, nothing recorded; non-doctors are not clients", async () => {
  verifyResult = { kind: "validation", message: "exceeds its balance" };
  const db = fakeTx({ selects: [
    [{ id: "doc1", email: "d@x.com", role: "doctor" }],
    [{ id: "a", clientUserId: "doc1", accountId: "a1", invoiceNumber: 500001, status: "issued", totalCents: 20000, dueDate: null, issuedAt: new Date("2026-08-31T15:00:00Z") }],
    [],
  ] });
  await assert.rejects(actions.recordManualPayment({ clientUserId: "doc1", method: "cash", amountCents: 100, paidOn: "2026-09-15", byUserId: "a1" }, db), isCode("OVERPAY"));
  assert.equal(recorded.length, 0);
  await assert.rejects(
    actions.recordManualPayment({ clientUserId: "x", method: "cash", amountCents: 100, paidOn: "2026-09-15" }, fakeTx({ selects: [[{ id: "x", role: "admin" }]] })),
    isCode("NOT_FOUND"),
  );
});

test("loadPayingClient: a doctor, or a non-doctor who runs a practice (owner, admin or group admin), from their own scope", async () => {
  const userRow = (role) => [[{ id: "u1", email: "u@x.com", name: "U", role }]];
  // A doctor needs no scope read.
  assert.equal((await actions.loadPayingClient("u1", fakeTx({ selects: userRow("doctor") }))).id, "u1");
  assert.deepEqual(scopeCalls, []);
  for (const role of ["owner", "admin", "org-admin"]) {
    targetScope = scopeOf({ a1: "viewer", a2: role });
    const client = await actions.loadPayingClient("u1", fakeTx({ selects: userRow("user") }));
    assert.equal(client.id, "u1", role);
  }
  assert.deepEqual(scopeCalls, ["u1", "u1", "u1"], "the TARGET's scope, never the staff member's");
});

test("loadPayingClient refuses anyone else as NOT_FOUND: plain members, viewers, no practice, unknown users", async () => {
  for (const roles of [{ a1: "member" }, { a1: "manager" }, { a1: "viewer" }, {}]) {
    targetScope = scopeOf(roles);
    await assert.rejects(actions.loadPayingClient("u1", fakeTx({ selects: [[{ id: "u1", role: "user" }]] })), isCode("NOT_FOUND"), JSON.stringify(roles));
  }
  targetScope = scopeOf({ a1: "owner" });
  await assert.rejects(actions.loadPayingClient("nobody", fakeTx({ selects: [[]] })), isCode("NOT_FOUND"));
});

test("recordManualPayment for a group-admin billing manager (not a doctor): recorded against their payable practices", async () => {
  targetScope = scopeOf({ a2: "org-admin" });
  const db = fakeTx({ selects: [
    [{ id: "bm1", email: "bm@x.com", name: "Billing", role: "user" }],
    [{ id: "g", clientUserId: "doc9", accountId: "a2", invoiceNumber: 500009, status: "issued", totalCents: 8000, dueDate: "2026-09-30", issuedAt: new Date("2026-08-31T15:00:00Z") }],
    [],
  ] });
  await actions.recordManualPayment({ clientUserId: "bm1", method: "ach", amountCents: 8000, paidOn: "2026-09-15", byUserId: "staff1" }, db);
  assert.deepEqual(recorded[0].allocations, [{ invoiceId: "g", invoiceNumber: "500009", amountCents: 8000 }]);
  assert.equal(recorded[0].user.id, "bm1", "receipted to the billing manager who paid");
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
