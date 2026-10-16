import { test } from "vitest";
import assert from "node:assert/strict";
import { invoiceStatusLabel, manualPaymentSource, MANUAL_PAYMENT_METHODS, AGING_BUCKETS } from "./billing.js";

test("an invoice reads as Draft, Void, Paid, Past due or Open", () => {
  const today = "2026-10-15";
  assert.equal(invoiceStatusLabel({ status: "draft", balanceCents: 500 }, today), "Draft");
  assert.equal(invoiceStatusLabel({ status: "void", balanceCents: 0 }, today), "Void");
  assert.equal(invoiceStatusLabel({ status: "issued", balanceCents: 0, dueDate: "2026-09-01" }, today), "Paid");
  assert.equal(invoiceStatusLabel({ status: "issued", balanceCents: -100, dueDate: "2026-09-01" }, today), "Paid");
  assert.equal(invoiceStatusLabel({ status: "issued", balanceCents: 100, dueDate: "2026-10-14" }, today), "Past due");
  assert.equal(invoiceStatusLabel({ status: "issued", balanceCents: 100, dueDate: "2026-10-15" }, today), "Open", "due today is not past due");
  assert.equal(invoiceStatusLabel({ status: "issued", balanceCents: 100, dueDate: null }, today), "Open");
});

test("manual payment methods map to ledger sources", () => {
  assert.deepEqual(MANUAL_PAYMENT_METHODS.map(manualPaymentSource), ["admin_check", "admin_cash", "admin_ach", "admin_other"]);
});

test("the five aging buckets, in print order", () => {
  assert.deepEqual(AGING_BUCKETS.map((b) => b.label), ["Current", "1–30", "31–60", "61–90", "90+"]);
});
