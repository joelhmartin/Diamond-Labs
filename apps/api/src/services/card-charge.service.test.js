import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const calls = [];
let capResult = null;
let ledgerWriteFailed = false;
let chargeError = null;
vi.mock("./authorizenet.service.js", () => ({
  chargeCustomerProfile: async (args) => {
    calls.push(["charge", args]);
    if (chargeError) throw chargeError;
    return { transactionId: "tx9", responseCode: "1", authCode: "A1" };
  },
}));
vi.mock("./payment-recording.service.js", () => ({
  verifyAllocations: async (allocs, user, opts) => {
    calls.push(["verify", user.id, opts]);
    if (!capResult) allocs.forEach((a) => { a.invoiceNumber = "500001"; });
    return capResult;
  },
  recordPaymentAndAllocations: async (args) => { calls.push(["record", args]); return { ledgerWriteFailed }; },
}));

const { chargeSavedCardAndRecord } = await import("./card-charge.service.js");
const source = readFileSync(fileURLToPath(new URL("./card-charge.service.js", import.meta.url)), "utf8");

beforeEach(() => { calls.length = 0; capResult = null; ledgerWriteFailed = false; chargeError = null; });

const input = (over = {}) => ({
  payer: { id: "doc1", email: "d@x.com" }, customerProfileId: "cp1", paymentProfileId: "pp1", amountCents: 12550,
  allocations: [{ invoiceId: "inv1", amountCents: 12550 }], source: "doctor_card", ...over,
});

test("verifies the cap, charges dollars on the wire, then records cents against the payer", async () => {
  const out = await chargeSavedCardAndRecord(input());
  assert.deepEqual(calls.map((c) => c[0]), ["verify", "charge", "record"]);
  assert.deepEqual(calls[0][2], { enforceCap: true });
  assert.deepEqual(calls[1][1], { customerProfileId: "cp1", paymentProfileId: "pp1", amount: "125.50", invoiceNumber: "500001" });
  assert.equal(calls[2][1].amountCents, 12550);
  assert.equal(calls[2][1].source, "doctor_card");
  assert.equal(calls[2][1].transactionId, "tx9");
  assert.deepEqual(out, { transactionId: "tx9", responseCode: "1", authCode: "A1", amountCents: 12550 });
});

test("the admin route passes its own source and the target doctor as payer", async () => {
  await chargeSavedCardAndRecord(input({ payer: { id: "doc2" }, source: "admin_card" }));
  assert.equal(calls[0][1], "doc2");
  assert.equal(calls[2][1].user.id, "doc2");
  assert.equal(calls[2][1].source, "admin_card");
});

test("a failed cap check throws before any money moves", async () => {
  capResult = { kind: "validation", message: "over" };
  await assert.rejects(chargeSavedCardAndRecord(input()), (e) => e.allocationError === capResult);
  assert.deepEqual(calls.map((c) => c[0]), ["verify"], "no charge, no record");
});

test("a declined card throws and records nothing", async () => {
  chargeError = new Error("declined");
  await assert.rejects(chargeSavedCardAndRecord(input()), /declined/);
  assert.deepEqual(calls.map((c) => c[0]), ["verify", "charge"]);
});

test("a ledger failure after the charge is surfaced as a flag, not thrown", async () => {
  ledgerWriteFailed = true;
  const out = await chargeSavedCardAndRecord(input());
  assert.equal(out.ledgerWriteFailed, true);
  assert.equal(out.transactionId, "tx9");
});

test("no Seazona anywhere in the card path", () => {
  assert.doesNotMatch(source, /seazona/i);
});
