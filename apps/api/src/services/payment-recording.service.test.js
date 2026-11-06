import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const inserted = [];
let insertFails = false;
let invoiceRows = [];
vi.mock("../config/database.js", () => ({
  db: {
    insert: () => ({ values: async (v) => { if (insertFails) throw new Error("db down"); inserted.push(...v); } }),
    select: () => ({ from: () => ({ leftJoin: () => ({ where: async () => invoiceRows }) }) }),
  },
}));
let paid = new Map();
vi.mock("./billing/ledger.service.js", () => ({ paidCentsByInvoice: async () => paid }));
const receipts = [];
vi.mock("./email.service.js", () => ({ sendPaymentReceipt: async (args) => { receipts.push(args); return true; } }));
const audits = [];
vi.mock("./audit.service.js", () => ({ logSafe: (e) => { audits.push(e); }, log: async () => {} }));

const { recordPaymentAndAllocations, verifyAllocations } = await import("./payment-recording.service.js");
const source = readFileSync(fileURLToPath(new URL("./payment-recording.service.js", import.meta.url)), "utf8");

beforeEach(() => {
  inserted.length = 0; receipts.length = 0; audits.length = 0;
  insertFails = false; invoiceRows = []; paid = new Map();
});

const doctor = { id: "doc1", email: "d@x.com" };
const allocations = () => [
  { invoiceId: "inv1", invoiceNumber: "500001", amountCents: 30000 },
  { invoiceId: "inv2", invoiceNumber: "500002", amountCents: 12550 },
];

test("one ledger row per allocated invoice, in cents, against the local invoice", async () => {
  const out = await recordPaymentAndAllocations({ user: doctor, amountCents: 42550, transactionId: "tx1", allocations: allocations(), source: "doctor_card" });
  assert.deepEqual(out, { ledgerWriteFailed: false });
  assert.deepEqual(inserted.map((r) => [r.userId, r.invoiceId, r.invoiceNumber, r.appliedCents, r.transactionId, r.source]), [
    ["doc1", "inv1", "500001", 30000, "tx1", "doctor_card"],
    ["doc1", "inv2", "500002", 12550, "tx1", "doctor_card"],
  ]);
  assert.equal(receipts[0].amountCents, 42550);
  assert.deepEqual(receipts[0].invoices, [{ number: "500001", accountNumber: null, amountCents: 30000 }, { number: "500002", accountNumber: null, amountCents: 12550 }]);
});

test("manual payments carry their received date and reference", async () => {
  await recordPaymentAndAllocations({
    user: doctor, amountCents: 30000, transactionId: "OFFLINE-x", allocations: allocations().slice(0, 1),
    source: "admin_check", wasCharged: false, paidOn: "2026-10-14", reference: "1042",
  });
  assert.deepEqual([inserted[0].paidOn, inserted[0].reference], ["2026-10-14", "1042"]);
  assert.equal(receipts[0].wasCharged, false);
});

test("nothing is written to Seazona — our ledger is the system of record", () => {
  assert.doesNotMatch(source, /seazonaService|seazona\.service/);
});

test("a ledger failure after a charge is reported, never thrown; the charged doctor still gets a receipt", async () => {
  insertFails = true;
  const out = await recordPaymentAndAllocations({ user: doctor, amountCents: 42550, transactionId: "tx1", allocations: allocations(), source: "doctor_card" });
  assert.deepEqual(out, { ledgerWriteFailed: true });
  assert.equal(receipts.length, 1);
  assert.equal(audits[0].metadata.ledgerWriteFailed, true);
});

test("a manual record that failed to save sends no receipt (nothing was recorded)", async () => {
  insertFails = true;
  await recordPaymentAndAllocations({ user: doctor, amountCents: 30000, transactionId: "OFFLINE-x", allocations: allocations().slice(0, 1), source: "admin_cash", wasCharged: false });
  assert.equal(receipts.length, 0);
});

test("audit carries amounts, the source and invoice numbers only", async () => {
  await recordPaymentAndAllocations({ user: doctor, amountCents: 42550, transactionId: "tx1", allocations: allocations(), source: "autopay", actorUserId: "admin1", auditAction: "payment.manual_recorded" });
  assert.deepEqual(audits[0], {
    userId: "admin1", action: "payment.manual_recorded", targetType: "transaction", targetId: "tx1",
    metadata: { amountCents: 42550, source: "autopay", invoices: ["500001", "500002"], ledgerWriteFailed: false },
  });
});

const inv = (over = {}) => ({ id: "inv1", invoiceNumber: 500001, accountId: "a1", accountNumber: "1324", clientUserId: "doc1", status: "issued", totalCents: 30000, ...over });
const { toClientScope } = await import("./client-scope-rules.js");
// A ClientScope as loadClientScope builds it: roles per account ("org-admin" for a group admin's).
const scopeOf = (roles) => toClientScope({ accountIds: Object.keys(roles), roles: new Map(Object.entries(roles)), via: new Map(), organizations: [] });
const member = scopeOf({ a1: "member" });

test("group admin pays invoices of two practices in one charge", async () => {
  const admin = { id: "gadmin", email: "ga@x.com" };
  const groupScope = scopeOf({ a1: "org-admin", a2: "org-admin" });
  invoiceRows = [inv(), inv({ id: "inv2", invoiceNumber: 500002, accountId: "a2", accountNumber: "2001", clientUserId: "doc2", totalCents: 12550 })];
  const allocs = [{ invoiceId: "inv1", amountCents: 30000 }, { invoiceId: "inv2", amountCents: 12550 }];
  assert.equal(await verifyAllocations(allocs, groupScope, { enforceCap: true }), null);
  await recordPaymentAndAllocations({ user: admin, amountCents: 42550, transactionId: "tx9", allocations: allocs, source: "doctor_card" });
  assert.deepEqual(inserted.map((r) => [r.invoiceId, r.transactionId, r.userId]), [["inv1", "tx9", "gadmin"], ["inv2", "tx9", "gadmin"]]);
});

test("practice staff cannot pay a sibling practice's invoice: it reads as not found", async () => {
  invoiceRows = [inv({ accountId: "a2" })];
  const sibling = await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], member);
  invoiceRows = [];
  const missing = await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], member);
  assert.equal(sibling.kind, "not_found");
  assert.deepEqual(sibling, missing, "not found and not yours read the same, so ids can't be probed");
});

test("viewer allocation refused", async () => {
  invoiceRows = [inv()];
  const viewer = scopeOf({ a1: "viewer" });
  assert.equal((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], viewer)).kind, "not_found");
  assert.equal(await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], member), null, "a member of the same practice may pay");
});

test("verifyAllocations: an invoice with no practice (null account) is nobody's to pay; no scope pays nothing", async () => {
  invoiceRows = [inv({ accountId: null })];
  assert.equal((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], member)).kind, "not_found");
  invoiceRows = [inv()];
  assert.equal((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], undefined)).kind, "not_found");
});

test("verifyAllocations: one cap per invoice — a second login of the practice can't re-pay", async () => {
  invoiceRows = [inv()];
  paid = new Map([["inv1", 30000]]); // the first login paid in full
  const again = await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], member, { enforceCap: true });
  assert.equal(again.kind, "validation");
});

test("mixed allocation with one foreign invoice is refused as a whole", async () => {
  invoiceRows = [inv(), inv({ id: "inv2", invoiceNumber: 500002, accountId: "a9" })];
  const out = await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }, { invoiceId: "inv2", amountCents: 100 }], member);
  assert.equal(out.kind, "not_found");
});

test("receipt goes to the payer only and lists invoice numbers only", async () => {
  invoiceRows = [inv(), inv({ id: "inv2", invoiceNumber: 500002, accountId: "a2", accountNumber: "2001" })];
  const allocs = [{ invoiceId: "inv1", amountCents: 100 }, { invoiceId: "inv2", amountCents: 200 }];
  assert.equal(await verifyAllocations(allocs, scopeOf({ a1: "org-admin", a2: "org-admin" })), null);
  await recordPaymentAndAllocations({ user: { id: "gadmin", email: "ga@x.com", name: "Pat Payer" }, amountCents: 300, transactionId: "tx1", allocations: allocs, source: "doctor_card" });
  assert.equal(receipts.length, 1, "one receipt");
  assert.equal(receipts[0].to, "ga@x.com", "to the payer, never the practices' members");
  assert.deepEqual(receipts[0].invoices, [
    { number: "500001", accountNumber: "1324", amountCents: 100 },
    { number: "500002", accountNumber: "2001", amountCents: 200 },
  ]);
  assert.doesNotMatch(JSON.stringify(receipts[0]), /Pat Payer|doc1/, "no names, no owners");
});

test("verifyAllocations: the not-found refusal is sent as 404 NOT_FOUND, never 403", async () => {
  const { sendAllocationError } = await import("../routes/payment-replies.js");
  const reply = { code(c) { this.status = c; return this; }, send(b) { this.body = b; return this; } };
  sendAllocationError(reply, { kind: "not_found", message: "Invoice 1 is not on this account." });
  assert.equal(reply.status, 404);
  assert.equal(reply.body.error.code, "NOT_FOUND");
});

test("verifyAllocations: drafts and voids can't be paid; an invoice may appear once", async () => {
  invoiceRows = [inv({ status: "draft" })];
  assert.match((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], member)).message, /hasn't been issued/);
  invoiceRows = [inv({ status: "void" })];
  assert.match((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], member)).message, /is void/);
  const dup = await verifyAllocations([{ invoiceId: "inv1", amountCents: 1 }, { invoiceId: "inv1", amountCents: 1 }], member);
  assert.equal(dup.kind, "validation");
});

test("verifyAllocations: the cap is what's left after payments, credits and refunds", async () => {
  invoiceRows = [inv()];
  paid = new Map([["inv1", 20000]]);
  assert.equal(await verifyAllocations([{ invoiceId: "inv1", amountCents: 10000 }], member, { enforceCap: true }), null);
  const over = await verifyAllocations([{ invoiceId: "inv1", amountCents: 10001 }], member, { enforceCap: true });
  assert.equal(over.kind, "validation");
  assert.match(over.message, /exceeds its balance of \$100\.00/);
  assert.equal(await verifyAllocations([{ invoiceId: "inv1", amountCents: 30000 }], member), null, "no cap without enforceCap (ownership pass)");
});

test("verifyAllocations fills in the invoice number from our invoice", async () => {
  invoiceRows = [inv()];
  const a = [{ invoiceId: "inv1", amountCents: 100 }];
  await verifyAllocations(a, member);
  assert.equal(a[0].invoiceNumber, "500001");
});

test("fails closed on dollar-shaped input: nothing inserted, the loud reconcile path is taken", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const bad = [
    { amountCents: 425.5, allocations: allocations() },
    { amountCents: undefined, allocations: allocations() },
    { amountCents: 42550, allocations: [{ invoiceId: "inv1", invoiceNumber: "500001", amount: 300 }] },
    { amountCents: 42550, allocations: [{ invoiceId: "inv1", invoiceNumber: "500001", amountCents: 300.25 }] },
  ];
  for (const b of bad) {
    const out = await recordPaymentAndAllocations({ user: doctor, transactionId: "tx1", source: "doctor_card", ...b });
    assert.deepEqual(out, { ledgerWriteFailed: true });
  }
  assert.equal(inserted.length, 0);
  assert.equal(errors.mock.calls.filter((c) => String(c[0]).includes("[PAYMENT][LEDGER_WRITE_FAILED]")).length, bad.length);
  errors.mockRestore();
});
