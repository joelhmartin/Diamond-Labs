import { test } from "vitest";
import assert from "node:assert/strict";
import { priceLines } from "../../lib/pricing.js";
import {
  InvoiceError, addDaysIso, computeTotals, hasUnpriced, asRemakeLines, planDraftInvoice, planShopInvoice,
  assertFreshInvoice, planLineEdit, planIssue, planVoid, deriveBalance, canActOnInvoice, planCredit, planManualPayment,
} from "./invoice-rules.js";
import { invoiceErrorReply } from "./invoice-errors.js";

const now = new Date("2026-10-15T15:00:00Z");
const TAX = { taxRateBps: 800 };
const isCode = (code) => (e) => e instanceof InvoiceError && e.code === code;
const line = (over = {}) => ({
  id: "l1", position: 0, kind: "item", description: "DDSO Nylon", qty: 1, unitCents: 10000, lineCents: 10000,
  taxable: false, priceSource: "client", ...over,
});
const draft = (over = {}) => ({ id: "inv1", invoiceNumber: 500001, status: "draft", version: 2, totalCents: 10000, ...over });

test("tax is charged once, on the taxable non-shipping lines", () => {
  const t = computeTotals([
    line({ unitCents: 1250, qty: 2, taxable: true }),
    line({ unitCents: 1000, taxable: false }),
    line({ kind: "shipping", unitCents: 1200, taxable: true }),
  ], TAX);
  assert.deepEqual(t, { subtotalCents: 3500, taxCents: 200, shippingCents: 1200, totalCents: 4900 });
});

test("computeTotals agrees with the shop's priceLines for the same lines", () => {
  const variants = new Map([
    ["a", { id: "a", name: "Mute", active: true, basePriceCents: 2199, taxable: true }],
    ["b", { id: "b", name: "Case", active: true, basePriceCents: 500, taxable: false }],
  ]);
  const quote = priceLines({
    lines: [{ variantId: "a", qty: 3 }, { variantId: "b", qty: 1 }],
    variants, config: { taxRateBps: 800, shippingFlatCents: 1200, maxQty: 999 },
  });
  const { lines } = planShopInvoice({ invoiceId: "inv", invoiceNumber: 1, labOrderId: "lo", clientUserId: null, quote, now, todayIso: "2026-10-15" });
  const { subtotalCents, taxCents, shippingCents, totalCents } = quote;
  assert.deepEqual(computeTotals(lines, TAX), { subtotalCents, taxCents, shippingCents, totalCents });
});

test("a shop invoice is issued, due the day it was paid, and copies the charged totals", () => {
  const quote = {
    lines: [{ variantId: "a", code: "61", name: "Mute", qty: 1, unitCents: 2199, lineCents: 2199, taxable: true, priceSource: "base" }],
    subtotalCents: 2199, taxCents: 176, shippingCents: 1200, totalCents: 3575,
  };
  const { invoice, lines } = planShopInvoice({ invoiceId: "inv", invoiceNumber: 500002, labOrderId: "lo1", clientUserId: null, quote, now, todayIso: "2026-10-15" });
  assert.equal(invoice.kind, "shop");
  assert.equal(invoice.status, "issued");
  assert.equal(invoice.issuedAt, now);
  assert.equal(invoice.dueDate, "2026-10-15");
  assert.equal(invoice.totalCents, 3575);
  assert.equal(invoice.clientUserId, null);
  assert.deepEqual(lines.map((l) => [l.kind, l.description, l.lineCents, l.priceSource]), [
    ["item", "Mute", 2199, "base"], ["shipping", "Shipping", 1200, "base"],
  ]);
});

test("a lab order's draft prices each line and keeps unpriced ones visible", () => {
  const { invoice, lines } = planDraftInvoice({
    invoiceId: "inv", invoiceNumber: 500003, labOrder: { id: "lo1", clientUserId: "doc1" }, now, taxRateBps: 800,
    pricedLines: [
      { labOrderLineId: "lol1", variantId: "v1", code: "2608", description: "DDSO Nylon", qty: 1, unitCents: 40500, taxable: false, priceSource: "client" },
      { labOrderLineId: "lol2", variantId: null, code: "9999", description: "Unknown code", qty: 1, unitCents: 0, taxable: false, priceSource: "unpriced" },
    ],
  });
  assert.deepEqual([invoice.status, invoice.kind, invoice.labOrderId, invoice.clientUserId, invoice.version], ["draft", "order", "lo1", "doc1", 1]);
  assert.equal(invoice.totalCents, 40500);
  assert.equal(hasUnpriced(lines), true);
  assert.deepEqual(lines.map((l) => [l.position, l.labOrderLineId, l.lineCents]), [[0, "lol1", 40500], [1, "lol2", 0]]);
});

test("a remake's lines are free unless staff edit them", () => {
  const out = asRemakeLines([{ description: "DDSO", qty: 1, unitCents: 40500, priceSource: "client" }]);
  assert.deepEqual(out.map((l) => [l.unitCents, l.priceSource]), [[0, "remake"]]);
});

test("addDaysIso crosses months and leap days, and refuses junk", () => {
  assert.equal(addDaysIso("2026-10-15", 30), "2026-11-14");
  assert.equal(addDaysIso("2028-02-28", 1), "2028-02-29");
  assert.equal(addDaysIso("2026-01-01", -1), "2025-12-31");
  assert.throws(() => addDaysIso("10/15/2026", 1), RangeError);
});

test("a stale version is refused", () => {
  assert.throws(() => assertFreshInvoice(draft(), 1), isCode("STALE"));
  assert.throws(() => assertFreshInvoice(draft(), undefined), isCode("STALE"));
  assert.doesNotThrow(() => assertFreshInvoice(draft(), 2));
});

test("editing: a price override needs a reason, marks the line manual, and keeps the reason out of audit", () => {
  const lines = [line()];
  assert.throws(() => planLineEdit(draft(), lines, { op: "update", lineId: "l1", unitCents: 9000 }, { now, ...TAX }), isCode("REASON_REQUIRED"));
  const plan = planLineEdit(draft(), lines, { op: "update", lineId: "l1", unitCents: 9000, reason: " courtesy discount " }, { now, ...TAX });
  assert.deepEqual(plan.op.update, { id: "l1", values: { unitCents: 9000, priceSource: "manual", priceNote: "courtesy discount", lineCents: 9000 } });
  assert.equal(plan.patch.totalCents, 9000);
  assert.equal(plan.patch.version, 3);
  assert.deepEqual(plan.audit, { op: "update", lineId: "l1", unitCents: 9000, priceOverride: true });
});

test("editing: a quantity change keeps the price source", () => {
  const plan = planLineEdit(draft(), [line()], { op: "update", lineId: "l1", qty: 3 }, { now, ...TAX });
  assert.deepEqual(plan.op.update, { id: "l1", values: { qty: 3, lineCents: 30000 } });
  assert.equal(plan.patch.subtotalCents, 30000);
});

test("editing: free-form lines; only an adjustment may be negative; shipping is never taxed", () => {
  const lines = [line()];
  const ship = planLineEdit(draft(), lines, { op: "add", kind: "shipping", description: "  Shipping ", qty: 1, unitCents: 1500, taxable: true }, { now, ...TAX });
  const ins = ship.op.insert;
  assert.deepEqual([ins.kind, ins.description, ins.position, ins.taxable, ins.priceSource, ins.lineCents], ["shipping", "Shipping", 1, false, "manual", 1500]);
  assert.equal(ship.patch.shippingCents, 1500);
  assert.equal(ship.patch.totalCents, 11500);
  assert.throws(() => planLineEdit(draft(), lines, { op: "add", kind: "fee", description: "Rush", qty: 1, unitCents: -100 }, { now, ...TAX }), isCode("INVALID"));
  assert.throws(() => planLineEdit(draft(), lines, { op: "add", kind: "fee", description: "  ", qty: 1, unitCents: 100 }, { now, ...TAX }), isCode("INVALID"));
  const adj = planLineEdit(draft(), lines, { op: "add", kind: "adjustment", description: "Goodwill", qty: 1, unitCents: -2500 }, { now, ...TAX });
  assert.equal(adj.patch.totalCents, 7500);
});

test("editing: remove, notes, and refusals", () => {
  const lines = [line(), line({ id: "l2", position: 1, unitCents: 500 })];
  const rm = planLineEdit(draft(), lines, { op: "remove", lineId: "l2" }, { now, ...TAX });
  assert.deepEqual(rm.op, { delete: "l2" });
  assert.equal(rm.patch.totalCents, 10000);
  const notes = planLineEdit(draft(), lines, { op: "notes", notes: "  call before shipping " }, { now, ...TAX });
  assert.equal(notes.patch.notes, "call before shipping");
  assert.equal(planLineEdit(draft(), lines, { op: "notes", notes: "   " }, { now, ...TAX }).patch.notes, null);
  assert.throws(() => planLineEdit(draft(), lines, { op: "remove", lineId: "nope" }, { now, ...TAX }), isCode("NOT_FOUND"));
  assert.throws(() => planLineEdit(draft(), lines, { op: "update", lineId: "l1", qty: 1 }, { now, ...TAX }), isCode("INVALID"), "a no-op is refused");
  assert.throws(() => planLineEdit(draft(), lines, { op: "update", lineId: "l1", qty: 1000 }, { now, ...TAX }), isCode("INVALID"));
});

test("an issued or void invoice can't be edited", () => {
  for (const status of ["issued", "void"]) {
    assert.throws(() => planLineEdit(draft({ status }), [line()], { op: "notes", notes: "x" }, { now, ...TAX }), isCode("INVALID_TRANSITION"));
  }
});

test("issue: due = issue date + terms; an unpriced line or a negative total holds it at draft", () => {
  const plan = planIssue(draft(), [line()], { now, termsDays: 30, issueDateIso: "2026-10-15" });
  assert.deepEqual(plan.patch, { status: "issued", issuedAt: now, dueDate: "2026-11-14", version: 3, updatedAt: now });
  assert.throws(
    () => planIssue(draft(), [line({ priceSource: "unpriced", description: "Mystery splint" })], { now, termsDays: 30, issueDateIso: "2026-10-15" }),
    (e) => isCode("INVALID")(e) && /Mystery splint/.test(e.message),
  );
  assert.throws(() => planIssue(draft({ totalCents: -1 }), [line()], { now, termsDays: 30, issueDateIso: "2026-10-15" }), isCode("INVALID"));
  assert.throws(() => planIssue(draft({ status: "issued" }), [line()], { now, termsDays: 30, issueDateIso: "2026-10-15" }), isCode("INVALID_TRANSITION"));
});

test("void: needs a reason; an issued invoice only while net paid is zero", () => {
  assert.throws(() => planVoid(draft(), { paidCents: 0, reason: "  ", now }), isCode("REASON_REQUIRED"));
  assert.equal(planVoid(draft(), { paidCents: 0, reason: "Lab order cancelled", now }).patch.status, "void");
  assert.throws(() => planVoid(draft({ status: "issued" }), { paidCents: 2500, reason: "Wrong client", now }), isCode("INVALID_TRANSITION"));
  const v = planVoid(draft({ status: "issued" }), { paidCents: 0, reason: " Wrong client ", now });
  assert.deepEqual(v.patch, { status: "void", voidedAt: now, voidReason: "Wrong client", version: 3, updatedAt: now });
  assert.throws(() => planVoid(draft({ status: "void" }), { paidCents: 0, reason: "again", now }), isCode("INVALID_TRANSITION"));
});

test("balance = total − (payments + credits − refunds); a void owes nothing; a draft is never paid", () => {
  const issued = { status: "issued", totalCents: 10000 };
  assert.deepEqual(deriveBalance(issued, 0), { paidCents: 0, balanceCents: 10000, paid: false });
  assert.deepEqual(deriveBalance(issued, 6000 + 1500 - 2000), { paidCents: 5500, balanceCents: 4500, paid: false });
  assert.deepEqual(deriveBalance(issued, 10000), { paidCents: 10000, balanceCents: 0, paid: true });
  assert.equal(deriveBalance({ status: "draft", totalCents: 10000 }, 0).paid, false);
  assert.deepEqual(deriveBalance({ status: "void", totalCents: 10000 }, 0), { paidCents: 0, balanceCents: 0, paid: false });
  assert.throws(() => deriveBalance(issued, 12.5), TypeError);
});

test("practice visibility: the owner, or a login of the same practice — nobody else", () => {
  const invoice = { clientUserId: "doc1" };
  assert.equal(canActOnInvoice({ id: "doc1", seazonaClientId: null }, invoice, null), true, "the owner always");
  assert.equal(canActOnInvoice({ id: "frontdesk", seazonaClientId: "c1" }, invoice, "c1"), true, "a same-practice second login");
  assert.equal(canActOnInvoice({ id: "other", seazonaClientId: "c2" }, invoice, "c1"), false, "another practice");
  assert.equal(canActOnInvoice({ id: "frontdesk", seazonaClientId: null }, invoice, "c1"), false, "null on the user's side");
  assert.equal(canActOnInvoice({ id: "frontdesk", seazonaClientId: "c1" }, invoice, null), false, "null on the owner's side");
  assert.equal(canActOnInvoice({ id: "x", seazonaClientId: null }, invoice, null), false, "two nulls are not a match");
  assert.equal(canActOnInvoice({ id: "doc1" }, { clientUserId: null }, null), false, "a guest invoice is nobody's to see");
  assert.equal(canActOnInvoice(null, invoice, "c1"), false);
});

test("invoice errors map to the status a screen can act on", () => {
  assert.equal(invoiceErrorReply(new InvoiceError("STALE", "This invoice changed — reload.")).status, 409);
  assert.equal(invoiceErrorReply(new InvoiceError("NOT_FOUND", "x")).status, 404);
  assert.equal(invoiceErrorReply(new InvoiceError("INVALID_TRANSITION", "x")).status, 422);
  assert.equal(invoiceErrorReply(new InvoiceError("OVERPAY", "x")).body.error.code, "OVERPAY");
  assert.equal(invoiceErrorReply(new InvoiceError("LOCKED", "x")).status, 409, "a payment in progress: retry shortly");
  assert.equal(invoiceErrorReply(new Error("boom")), null);
});

test("editing: setting an unpriced line to $0 is a real change (it becomes priced, manual) and still needs a reason", () => {
  const lines = [line({ unitCents: 0, lineCents: 0, priceSource: "unpriced" })];
  assert.throws(() => planLineEdit(draft({ totalCents: 0 }), lines, { op: "update", lineId: "l1", unitCents: 0 }, { now, ...TAX }), isCode("REASON_REQUIRED"));
  const plan = planLineEdit(draft({ totalCents: 0 }), lines, { op: "update", lineId: "l1", unitCents: 0, reason: "no charge" }, { now, ...TAX });
  assert.deepEqual(plan.op.update.values, { unitCents: 0, priceSource: "manual", priceNote: "no charge", lineCents: 0 });
  assert.equal(hasUnpriced([{ ...lines[0], ...plan.op.update.values }]), false);
  // A priced line set to its current price is still a no-op.
  assert.throws(() => planLineEdit(draft(), [line()], { op: "update", lineId: "l1", unitCents: 10000, reason: "x" }, { now, ...TAX }), isCode("INVALID"));
});

test("editing: a taxable line's tax is recomputed from the edited lines", () => {
  const lines = [line({ taxable: true })];
  const plan = planLineEdit(draft(), lines, { op: "update", lineId: "l1", qty: 2 }, { now, ...TAX });
  assert.deepEqual(
    [plan.patch.subtotalCents, plan.patch.taxCents, plan.patch.totalCents],
    [20000, 1600, 21600],
  );
});

test("editing: a negative price on a non-adjustment update is refused", () => {
  assert.throws(
    () => planLineEdit(draft(), [line()], { op: "update", lineId: "l1", unitCents: -500, reason: "oops" }, { now, ...TAX }),
    isCode("INVALID"),
  );
});

test("credit: an issued invoice, a reason, and no more than is owed", () => {
  const issued = draft({ status: "issued" });
  assert.deepEqual(planCredit(issued, { amountCents: 2500, reason: " shade mismatch ", balanceCents: 10000 }), { reason: "shade mismatch" });
  assert.throws(() => planCredit(issued, { amountCents: 2500, reason: " ", balanceCents: 10000 }), isCode("REASON_REQUIRED"));
  assert.throws(() => planCredit(issued, { amountCents: 10001, reason: "x", balanceCents: 10000 }), isCode("OVERPAY"));
  assert.throws(() => planCredit(draft(), { amountCents: 100, reason: "x", balanceCents: 10000 }), isCode("INVALID_TRANSITION"));
  assert.throws(() => planCredit(issued, { amountCents: 0, reason: "x", balanceCents: 10000 }), isCode("INVALID"));
});

const open = [
  { id: "a", invoiceNumber: 500001, balanceCents: 20000, dueDate: "2026-09-30", issuedOn: "2026-08-31" },
  { id: "b", invoiceNumber: 500002, balanceCents: 30000, dueDate: "2026-10-30", issuedOn: "2026-09-30" },
];

test("manual payment: oldest-first by default; overpaying the open balance is refused", () => {
  assert.deepEqual(planManualPayment({ openInvoices: open, amountCents: 25000, paidOn: "2026-10-14", todayIso: "2026-10-15" }), [
    { invoiceId: "a", invoiceNumber: "500001", amountCents: 20000 },
    { invoiceId: "b", invoiceNumber: "500002", amountCents: 5000 },
  ]);
  assert.throws(() => planManualPayment({ openInvoices: open, amountCents: 50001, paidOn: "2026-10-14", todayIso: "2026-10-15" }), isCode("OVERPAY"));
});

test("manual payment: chosen invoices must be open, once each, within balance, adding up", () => {
  const chosen = planManualPayment({ openInvoices: open, amountCents: 30000, allocations: [{ invoiceId: "b", amountCents: 30000 }], paidOn: "2026-10-14", todayIso: "2026-10-15" });
  assert.deepEqual(chosen, [{ invoiceId: "b", invoiceNumber: "500002", amountCents: 30000 }]);
  const pay = (allocations, amountCents) => () => planManualPayment({ openInvoices: open, amountCents, allocations, paidOn: "2026-10-14", todayIso: "2026-10-15" });
  assert.throws(pay([{ invoiceId: "zzz", amountCents: 100 }], 100), isCode("INVALID"));
  assert.throws(pay([{ invoiceId: "a", amountCents: 20001 }], 20001), isCode("OVERPAY"));
  assert.throws(pay([{ invoiceId: "a", amountCents: 100 }, { invoiceId: "a", amountCents: 100 }], 200), isCode("INVALID"));
  assert.throws(pay([{ invoiceId: "a", amountCents: 100 }], 200), isCode("INVALID"));
});

test("manual payment: the received date can't be in the future or before the invoice was issued", () => {
  const pay = (paidOn, allocations) => () => planManualPayment({ openInvoices: open, amountCents: 1000, allocations, paidOn, todayIso: "2026-10-15" });
  assert.throws(pay("2026-10-16"), (e) => isCode("INVALID")(e) && /future/.test(e.message));
  assert.throws(pay("2026-09-29", [{ invoiceId: "b", amountCents: 1000 }]), (e) => isCode("INVALID")(e) && /#500002/.test(e.message));
  assert.doesNotThrow(pay("2026-09-30", [{ invoiceId: "b", amountCents: 1000 }]), "the issue day itself is fine");
  assert.throws(pay("10/14/2026"), isCode("INVALID"));
  assert.throws(pay("2026-02-30"), isCode("INVALID"), "a date that doesn't exist");
});
