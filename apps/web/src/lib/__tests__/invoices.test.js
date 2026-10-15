import { test } from "vitest";
import assert from "node:assert/strict";
import { typedCents, recentMonths, isPayable, statusOf, dayText } from "../invoices.js";

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
