import { test } from "vitest";
import assert from "node:assert/strict";
import {
  invoiceStatusLabel, manualPaymentSource, MANUAL_PAYMENT_METHODS, AGING_BUCKETS,
  PRICE_SOURCES, PRICE_SOURCE_LABELS, LEGACY_SETTLEMENT_SOURCE, OPENING_BALANCE_PREFIX, isOpeningBalanceInvoice,
  HISTORY_EXCLUDED_SOURCES, SHOP_PAYMENT_SOURCE, LEGACY_LINE_DESCRIPTION,
} from "./billing.js";

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

test("legacy vocabulary: a price source, a ledger source, and the opening-balance marker", () => {
  assert.ok(PRICE_SOURCES.includes("legacy"));
  assert.equal(PRICE_SOURCE_LABELS.legacy, "Seazona");
  assert.ok("legacy".length <= 10, "invoice_lines.price_source is varchar(10)");
  assert.equal(LEGACY_SETTLEMENT_SOURCE, "legacy_settlement");
  assert.deepEqual(HISTORY_EXCLUDED_SOURCES, [SHOP_PAYMENT_SOURCE, LEGACY_SETTLEMENT_SOURCE]);
  assert.equal(LEGACY_LINE_DESCRIPTION, "Carried over from Seazona");
});

test("only a legacy invoice keyed opening:<client> is an opening balance", () => {
  assert.equal(isOpeningBalanceInvoice({ kind: "legacy", legacySeazonaInvoiceId: `${OPENING_BALANCE_PREFIX}1324` }), true);
  assert.equal(isOpeningBalanceInvoice({ kind: "legacy", legacySeazonaInvoiceId: "8f2c-uuid" }), false);
  assert.equal(isOpeningBalanceInvoice({ kind: "order", legacySeazonaInvoiceId: "opening:1324" }), false);
  assert.equal(isOpeningBalanceInvoice(null), false);
});
