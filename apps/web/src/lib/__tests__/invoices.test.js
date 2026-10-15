import { test } from "vitest";
import assert from "node:assert/strict";
import { typedCents, recentMonths, isPayable, statusOf, dayText, refundSelection, activityLabel } from "../invoices.js";

test("typed amounts become cents; blank, junk and negatives are nothing", () => {
  assert.equal(typedCents("12.50"), 1250);
  assert.equal(typedCents("12."), 1200, "mid-typing a decimal point");
  assert.equal(typedCents("$1,000"), 100000);
  assert.equal(typedCents(""), 0);
  assert.equal(typedCents("abc"), 0);
  assert.equal(typedCents("-5"), 0);
  assert.equal(typedCents("1.999"), 0);
});

test("statement months run newest first and cross the year", () => {
  assert.deepEqual(recentMonths("2026-02-10", 3), [
    { value: "2026-02", label: "February 2026" },
    { value: "2026-01", label: "January 2026" },
    { value: "2025-12", label: "December 2025" },
  ]);
});

test("only an issued invoice with a balance can be paid; status words come from shared", () => {
  assert.equal(isPayable({ status: "issued", balanceCents: 1 }), true);
  assert.equal(isPayable({ status: "issued", balanceCents: 0 }), false);
  assert.equal(isPayable({ status: "void", balanceCents: 100 }), false);
  assert.equal(statusOf({ status: "issued", balanceCents: 100, dueDate: "2026-10-01" }, "2026-10-15"), "Past due");
});

test("a ledger date or a timestamp both read as the lab's calendar day", () => {
  assert.equal(dayText("2026-10-09"), "10/09/2026");
  assert.equal(dayText("2026-11-01T04:30:00.000Z"), "10/31/2026");
  assert.equal(dayText(null), "—");
});

test("refund lines: full when every invoice is included at its full amount, otherwise the slices", () => {
  const lines = [
    { invoiceId: "a", maxCents: 6000, include: true, amountStr: "60.00" },
    { invoiceId: "b", maxCents: 4000, include: true, amountStr: "40" },
  ];
  assert.equal(refundSelection(lines).isFull, true);
  const partial = refundSelection([{ ...lines[0], include: false }, { ...lines[1], amountStr: "15.5" }]);
  assert.deepEqual([partial.isFull, partial.totalCents, partial.allocations], [false, 1550, [{ invoiceId: "b", amountCents: 1550 }]]);
  assert.equal(refundSelection([{ ...lines[0], amountStr: "60.01" }]).allValid, false, "never more than was charged");
  assert.equal(refundSelection([{ ...lines[0], include: false }]).anySelected, false);
});

test("activity words: known actions are phrased, unknown ones still render", () => {
  assert.equal(activityLabel("invoice.issued"), "Issued");
  assert.equal(activityLabel("invoice.some_new_thing"), "Some new thing");
  assert.equal(activityLabel(undefined), "Activity");
});
