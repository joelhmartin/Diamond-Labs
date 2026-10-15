import { test } from "vitest";
import assert from "node:assert/strict";
import { buildStatementModel, monthBounds, statementEvents } from "./statement-model.js";

const invoices = [
  { id: "a", invoiceNumber: 500001, status: "issued", totalCents: 30000, issuedAt: new Date("2026-09-10T15:00:00Z"), dueDate: "2026-10-10", voidedAt: null, labOrderNumber: 100200 },
  { id: "b", invoiceNumber: 500002, status: "issued", totalCents: 20000, issuedAt: new Date("2026-10-05T15:00:00Z"), dueDate: "2026-11-04", voidedAt: null, labOrderNumber: 100201 },
  { id: "c", invoiceNumber: 500003, status: "void", totalCents: 5000, issuedAt: new Date("2026-09-20T15:00:00Z"), dueDate: "2026-10-20", voidedAt: new Date("2026-10-02T15:00:00Z"), labOrderNumber: null },
  // A draft that was voided carries no money.
  { id: "d", invoiceNumber: 500004, status: "void", totalCents: 7000, issuedAt: null, dueDate: null, voidedAt: new Date("2026-10-03T15:00:00Z"), labOrderNumber: null },
];
const payments = [
  { invoiceId: "a", invoiceNumber: "500001", appliedCents: 10000, source: "doctor_card", paidOn: null, createdAt: new Date("2026-09-25T15:00:00Z") },
  // 11:30 pm in Chicago on Oct 31 is 04:30 UTC on Nov 1: it belongs to October.
  { invoiceId: "a", invoiceNumber: "500001", appliedCents: 5000, source: "autopay", paidOn: null, createdAt: new Date("2026-11-01T04:30:00Z") },
  { invoiceId: "b", invoiceNumber: "500002", appliedCents: 2000, source: "credit", paidOn: "2026-10-12", createdAt: new Date("2026-10-12T15:00:00Z") },
  // A check received Oct 9, entered Oct 20: dated by when it was received.
  { invoiceId: "b", invoiceNumber: "500002", appliedCents: 8000, source: "admin_check", paidOn: "2026-10-09", createdAt: new Date("2026-10-20T15:00:00Z") },
  { invoiceId: "b", invoiceNumber: "500002", appliedCents: 0, source: null, paidOn: null, createdAt: new Date("2026-10-15T15:00:00Z") },
  { invoiceId: "a", invoiceNumber: "500001", appliedCents: -1000, source: "refund", paidOn: null, createdAt: new Date("2026-10-16T15:00:00Z") },
];
const client = { name: "Dr Amy Lee", practice: "Lee Dental", accountNumber: "1324" };
const activity = { invoices, payments };

test("monthBounds knows month lengths and refuses junk", () => {
  assert.deepEqual(monthBounds("2028-02"), { startIso: "2028-02-01", endIso: "2028-02-29", label: "February 2028" });
  assert.equal(monthBounds("2026-10").endIso, "2026-10-31");
  assert.throws(() => monthBounds("2026-13"), RangeError);
});

test("opening + the month's dated activity = closing, in the lab's timezone", () => {
  const m = buildStatementModel(client, activity, { month: "2026-10" }, { generatedAt: new Date("2026-11-15T15:00:00Z") });
  assert.equal(m.openingCents, 25000, "Sep: +300.00 +50.00 −100.00");
  assert.deepEqual(m.lines.map((l) => [l.date, l.kind, l.amountCents, l.balanceCents]), [
    ["2026-10-02", "void", -5000, 20000],
    ["2026-10-05", "invoice", 20000, 40000],
    ["2026-10-09", "payment", -8000, 32000],
    ["2026-10-12", "credit", -2000, 30000],
    ["2026-10-16", "refund", 1000, 31000],
    ["2026-10-31", "payment", -5000, 26000],
  ]);
  assert.equal(m.closingCents, 26000);
  assert.deepEqual(m.lines.map((l) => l.description), [
    "Void — invoice #500003",
    "Invoice #500002 · Order #100201",
    "Payment (Check) — invoice #500002",
    "Credit — invoice #500002",
    "Refund — invoice #500001",
    "Payment (AutoPay) — invoice #500001",
  ]);
  assert.deepEqual(m.lines[0].cells, ["10/02/2026", "Void — invoice #500003", "-$50.00", "$200.00"]);
  assert.equal(m.filename, "statement-2026-10.pdf");
});

test("the closing balance is aged per invoice as of the month's end, and the two agree", () => {
  const m = buildStatementModel(client, activity, { month: "2026-10" }, { generatedAt: new Date("2026-11-15T15:00:00Z") });
  assert.equal(m.period.asOfIso, "2026-10-31");
  assert.deepEqual(m.aging.buckets, { current: 10000, d1_30: 16000, d31_60: 0, d61_90: 0, d90_plus: 0 });
  assert.equal(m.aging.totalCents, m.closingCents);
  assert.deepEqual(m.aging.cells[1], ["1–30", "$160.00"]);
});

test("the next month opens where this one closed; the current month ages as of today", () => {
  const nov = buildStatementModel(client, activity, { month: "2026-11" }, { generatedAt: new Date("2026-11-15T15:00:00Z") });
  assert.equal(nov.openingCents, 26000);
  assert.deepEqual(nov.lines, []);
  assert.equal(nov.period.asOfIso, "2026-11-15");
});

test("drafts and the refund guard row never appear", () => {
  const kinds = statementEvents(activity).map((e) => `${e.kind}:${e.invoiceId}`);
  assert.ok(!kinds.some((k) => k.endsWith(":d")));
  assert.equal(statementEvents(activity).filter((e) => e.amountCents === 0).length, 0);
});
