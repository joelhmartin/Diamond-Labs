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
  assert.deepEqual(receipts[0].invoices, [{ number: "500001", amountCents: 30000 }, { number: "500002", amountCents: 12550 }]);
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

const inv = (over = {}) => ({ id: "inv1", invoiceNumber: 500001, clientUserId: "doc1", ownerSeazonaClientId: "c1", status: "issued", totalCents: 30000, ...over });

test("verifyAllocations: a second login of the same practice may pay; another practice may not", async () => {
  invoiceRows = [inv()];
  assert.equal(await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], { id: "frontdesk", seazonaClientId: "c1" }), null);
  assert.equal((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], { id: "other", seazonaClientId: "c2" })).kind, "forbidden");
});

test("verifyAllocations: a null practice key on either side matches the owner only", async () => {
  invoiceRows = [inv()];
  assert.equal((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], { id: "frontdesk", seazonaClientId: null })).kind, "forbidden");
  invoiceRows = [inv({ ownerSeazonaClientId: null })];
  assert.equal((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], { id: "frontdesk", seazonaClientId: "c1" })).kind, "forbidden");
  assert.equal(await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], doctor), null, "the owner, with no practice key");
});

test("verifyAllocations: the practice shares one cap per invoice — a second login can't re-pay", async () => {
  invoiceRows = [inv()];
  paid = new Map([["inv1", 30000]]); // the first login paid in full
  const again = await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], { id: "frontdesk", seazonaClientId: "c1" }, { enforceCap: true });
  assert.equal(again.kind, "validation");
});

test("verifyAllocations: someone else's invoice and a missing one read the same (403)", async () => {
  invoiceRows = [inv({ clientUserId: "doc2" })];
  const other = await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], doctor);
  invoiceRows = [];
  const missing = await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], doctor);
  assert.equal(other.kind, "forbidden");
  assert.deepEqual(other, missing);
});

test("verifyAllocations: drafts and voids can't be paid; an invoice may appear once", async () => {
  invoiceRows = [inv({ status: "draft" })];
  assert.match((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], doctor)).message, /hasn't been issued/);
  invoiceRows = [inv({ status: "void" })];
  assert.match((await verifyAllocations([{ invoiceId: "inv1", amountCents: 100 }], doctor)).message, /is void/);
  const dup = await verifyAllocations([{ invoiceId: "inv1", amountCents: 1 }, { invoiceId: "inv1", amountCents: 1 }], doctor);
  assert.equal(dup.kind, "validation");
});

test("verifyAllocations: the cap is what's left after payments, credits and refunds", async () => {
  invoiceRows = [inv()];
  paid = new Map([["inv1", 20000]]);
  assert.equal(await verifyAllocations([{ invoiceId: "inv1", amountCents: 10000 }], doctor, { enforceCap: true }), null);
  const over = await verifyAllocations([{ invoiceId: "inv1", amountCents: 10001 }], doctor, { enforceCap: true });
  assert.equal(over.kind, "validation");
  assert.match(over.message, /exceeds its balance of \$100\.00/);
  assert.equal(await verifyAllocations([{ invoiceId: "inv1", amountCents: 30000 }], doctor), null, "no cap without enforceCap (ownership pass)");
});

test("verifyAllocations fills in the invoice number from our invoice", async () => {
  invoiceRows = [inv()];
  const a = [{ invoiceId: "inv1", amountCents: 100 }];
  await verifyAllocations(a, doctor);
  assert.equal(a[0].invoiceNumber, "500001");
});
