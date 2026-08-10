import { describe, it, expect } from "vitest";
import { allocateOldestFirst, resolveChargeAmount } from "./autopay-allocation.js";

const inv = (id, balance, dueDate, invoiceNumber = `IN-${id}`) => ({ id, balance, dueDate, invoiceNumber });

describe("resolveChargeAmount", () => {
  it("charges the enrolled amount when the balance exceeds it", () => {
    expect(resolveChargeAmount({ enrolledAmount: 500, totalBalance: 1200 })).toBe(500);
  });

  // The payoff rule: the floor governs ENROLLMENT, not the final payment.
  // A $500 enrollment against a $180 balance charges $180 and completes, even
  // though $180 is under AUTOPAY_MIN_AMOUNT.
  it("charges only the remaining balance when it is below the enrolled amount", () => {
    expect(resolveChargeAmount({ enrolledAmount: 500, totalBalance: 180 })).toBe(180);
  });

  it("returns 0 when nothing is owed", () => {
    expect(resolveChargeAmount({ enrolledAmount: 500, totalBalance: 0 })).toBe(0);
  });

  it("never returns a negative amount", () => {
    expect(resolveChargeAmount({ enrolledAmount: 500, totalBalance: -12 })).toBe(0);
  });

  it("rounds to cents", () => {
    expect(resolveChargeAmount({ enrolledAmount: 500, totalBalance: 180.005 })).toBe(180.01);
  });

  it("returns 0 for a negative enrolledAmount", () => {
    expect(resolveChargeAmount({ enrolledAmount: -50, totalBalance: 100 })).toBe(0);
  });

  it("returns 0 for a NaN or undefined enrolledAmount", () => {
    expect(resolveChargeAmount({ enrolledAmount: NaN, totalBalance: 100 })).toBe(0);
    expect(resolveChargeAmount({ enrolledAmount: undefined, totalBalance: 100 })).toBe(0);
  });
});

describe("allocateOldestFirst", () => {
  it("fills the oldest invoice first, then spills into the next", () => {
    const { allocations, totalAllocated } = allocateOldestFirst(
      [inv("b", 300, "2026-03-01"), inv("a", 200, "2026-01-01"), inv("c", 400, "2026-05-01")],
      600
    );
    expect(allocations).toEqual([
      { invoiceId: "a", invoiceNumber: "IN-a", amount: 200 },
      { invoiceId: "b", invoiceNumber: "IN-b", amount: 300 },
      { invoiceId: "c", invoiceNumber: "IN-c", amount: 100 },
    ]);
    expect(totalAllocated).toBe(600);
  });

  it("stops at the total balance when the charge exceeds it", () => {
    const { allocations, totalAllocated } = allocateOldestFirst(
      [inv("a", 50, "2026-01-01"), inv("b", 25, "2026-02-01")],
      500
    );
    expect(totalAllocated).toBe(75);
    expect(allocations).toHaveLength(2);
  });

  it("omits invoices that receive nothing", () => {
    const { allocations } = allocateOldestFirst(
      [inv("a", 200, "2026-01-01"), inv("b", 300, "2026-02-01")],
      200
    );
    expect(allocations).toEqual([{ invoiceId: "a", invoiceNumber: "IN-a", amount: 200 }]);
  });

  it("skips zero and negative balances", () => {
    const { allocations } = allocateOldestFirst(
      [inv("a", 0, "2026-01-01"), inv("b", -5, "2026-02-01"), inv("c", 100, "2026-03-01")],
      100
    );
    expect(allocations).toEqual([{ invoiceId: "c", invoiceNumber: "IN-c", amount: 100 }]);
  });

  it("returns nothing for a zero charge", () => {
    expect(allocateOldestFirst([inv("a", 100, "2026-01-01")], 0)).toEqual({
      allocations: [],
      totalAllocated: 0,
    });
  });

  it("does not drift on cent-level splits", () => {
    const { allocations, totalAllocated } = allocateOldestFirst(
      [inv("a", 33.33, "2026-01-01"), inv("b", 33.33, "2026-02-01"), inv("c", 33.34, "2026-03-01")],
      100
    );
    expect(totalAllocated).toBe(100);
    expect(allocations.reduce((s, a) => s + a.amount, 0)).toBe(100);
  });

  it("orders by due date, falling back to invoice number when dates tie", () => {
    const { allocations } = allocateOldestFirst(
      [inv("b", 100, "2026-01-01", "IN-2"), inv("a", 100, "2026-01-01", "IN-1")],
      100
    );
    expect(allocations[0].invoiceNumber).toBe("IN-1");
  });

  // Reversed after a live dry run: an undated invoice must not outrank one that
  // is demonstrably older. A doctor holding two undated invoices had them paid
  // ahead of a genuinely overdue 2024 invoice, which got only the remainder.
  it("sorts an invoice with no dueDate AFTER one that has a date", () => {
    const { allocations } = allocateOldestFirst(
      [inv("b", 100, undefined), inv("a", 100, "2026-02-01")],
      200
    );
    expect(allocations.map((x) => x.invoiceId)).toEqual(["a", "b"]);
  });

  it("pays a genuinely old dated invoice before undated ones", () => {
    const { allocations } = allocateOldestFirst(
      [inv("undated1", 480, undefined), inv("undated2", 16.5, undefined), inv("old", 15, "2024-10-25")],
      100
    );
    // The 2024 invoice is the only one with a real date — it goes first.
    expect(allocations[0].invoiceId).toBe("old");
    expect(allocations[0].amount).toBe(15);
  });

  it("still orders undated invoices deterministically among themselves", () => {
    const { allocations } = allocateOldestFirst(
      [inv("b", 50, undefined, "IN-2"), inv("a", 50, undefined, "IN-1")],
      100
    );
    expect(allocations.map((x) => x.invoiceNumber)).toEqual(["IN-1", "IN-2"]);
  });

  it("returns an empty allocation for a NaN chargeAmount", () => {
    expect(allocateOldestFirst([inv("a", 100, "2026-01-01")], NaN)).toEqual({
      allocations: [],
      totalAllocated: 0,
    });
  });
});
