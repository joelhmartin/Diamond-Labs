import { test } from "vitest";
import assert from "node:assert/strict";
import { allocateOldestFirst, resolveChargeCents, sortOldestFirst } from "./allocation.js";

const inv = (id, balanceCents, dueDate, invoiceNumber = `IN-${id}`) => ({ id, balanceCents, dueDate, invoiceNumber });

test("the enrolled amount, or the whole balance when that is less; never negative", () => {
  assert.equal(resolveChargeCents({ enrolledCents: 50000, totalBalanceCents: 120000 }), 50000);
  // The payoff rule: the floor governs ENROLLMENT, not the final payment.
  assert.equal(resolveChargeCents({ enrolledCents: 50000, totalBalanceCents: 18000 }), 18000);
  assert.equal(resolveChargeCents({ enrolledCents: 50000, totalBalanceCents: 0 }), 0);
  assert.equal(resolveChargeCents({ enrolledCents: 50000, totalBalanceCents: -1200 }), 0);
  assert.equal(resolveChargeCents({ enrolledCents: -5000, totalBalanceCents: 10000 }), 0);
  assert.equal(resolveChargeCents({ enrolledCents: NaN, totalBalanceCents: 10000 }), 0);
  assert.equal(resolveChargeCents({ enrolledCents: 100.5, totalBalanceCents: 10000 }), 0, "dollars are refused");
});

test("fills the oldest invoice first, then spills into the next", () => {
  const { allocations, totalAllocatedCents } = allocateOldestFirst(
    [inv("b", 30000, "2026-03-01"), inv("a", 20000, "2026-01-01"), inv("c", 40000, "2026-05-01")],
    60000,
  );
  assert.deepEqual(allocations, [
    { invoiceId: "a", invoiceNumber: "IN-a", amountCents: 20000 },
    { invoiceId: "b", invoiceNumber: "IN-b", amountCents: 30000 },
    { invoiceId: "c", invoiceNumber: "IN-c", amountCents: 10000 },
  ]);
  assert.equal(totalAllocatedCents, 60000);
});

test("stops at the total balance, omits invoices that get nothing, skips zero and negative balances", () => {
  assert.equal(allocateOldestFirst([inv("a", 5000, "2026-01-01"), inv("b", 2500, "2026-02-01")], 50000).totalAllocatedCents, 7500);
  assert.deepEqual(allocateOldestFirst([inv("a", 20000, "2026-01-01"), inv("b", 30000, "2026-02-01")], 20000).allocations.map((x) => x.invoiceId), ["a"]);
  assert.deepEqual(
    allocateOldestFirst([inv("a", 0, "2026-01-01"), inv("b", -500, "2026-02-01"), inv("c", 10000, "2026-03-01")], 10000).allocations.map((x) => x.invoiceId),
    ["c"],
  );
});

test("a zero, NaN or dollar charge allocates nothing", () => {
  for (const charge of [0, NaN, 100.5]) {
    assert.deepEqual(allocateOldestFirst([inv("a", 10000, "2026-01-01")], charge), { allocations: [], totalAllocatedCents: 0 });
  }
});

test("sortOldestFirst is the order the pay screens list invoices in", () => {
  const sorted = sortOldestFirst([inv("c", 1, undefined), inv("b", 1, "2026-03-01"), inv("a", 1, "2026-01-01")]);
  assert.deepEqual(sorted.map((i) => i.id), ["a", "b", "c"]);
});

test("ties on due date fall back to invoice number, compared as numbers", () => {
  const { allocations } = allocateOldestFirst(
    [{ id: "x", invoiceNumber: 100000, balanceCents: 100, dueDate: "2026-01-01" }, { id: "y", invoiceNumber: 99999, balanceCents: 100, dueDate: "2026-01-01" }],
    100,
  );
  assert.equal(allocations[0].invoiceNumber, "99999");
});

// An undated invoice must not outrank one that is demonstrably older (a live dry
// run once paid two undated invoices ahead of an overdue 2024 one).
test("an invoice with no due date sorts after every dated one, deterministically among themselves", () => {
  assert.deepEqual(allocateOldestFirst([inv("b", 10000, undefined), inv("a", 10000, "2026-02-01")], 20000).allocations.map((x) => x.invoiceId), ["a", "b"]);
  const { allocations } = allocateOldestFirst([inv("u1", 48000, undefined), inv("u2", 1650, undefined), inv("old", 1500, "2024-10-25")], 10000);
  assert.deepEqual([allocations[0].invoiceId, allocations[0].amountCents], ["old", 1500]);
  assert.deepEqual(
    allocateOldestFirst([inv("b", 5000, undefined, "IN-2"), inv("a", 5000, undefined, "IN-1")], 10000).allocations.map((x) => x.invoiceNumber),
    ["IN-1", "IN-2"],
  );
});
