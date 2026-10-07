import { describe, it, expect } from "vitest";
import {
  allocationSchema,
  chargeSavedSchema,
  hostedTokenSchema,
  hostedCompleteSchema,
  checkoutSchema,
  refundSchema,
} from "@my-app/shared";

describe("allocationSchema", () => {
  it("accepts a valid allocation", () => {
    expect(allocationSchema.safeParse({ invoiceId: "abc", amount: 12.5 }).success).toBe(true);
    expect(allocationSchema.safeParse({ invoiceId: "abc", invoiceNumber: "1001", amount: 0.01 }).success).toBe(true);
  });
  it("rejects a missing/empty invoiceId", () => {
    expect(allocationSchema.safeParse({ invoiceId: "", amount: 5 }).success).toBe(false);
    expect(allocationSchema.safeParse({ amount: 5 }).success).toBe(false);
  });
  it("rejects non-positive and over-cap amounts", () => {
    expect(allocationSchema.safeParse({ invoiceId: "a", amount: 0 }).success).toBe(false);
    expect(allocationSchema.safeParse({ invoiceId: "a", amount: -1 }).success).toBe(false);
    expect(allocationSchema.safeParse({ invoiceId: "a", amount: 100000.01 }).success).toBe(false);
  });
  it("rejects more than 2 decimal places", () => {
    expect(allocationSchema.safeParse({ invoiceId: "a", amount: 10.001 }).success).toBe(false);
    expect(allocationSchema.safeParse({ invoiceId: "a", amount: 10.99 }).success).toBe(true);
  });
});

describe("chargeSavedSchema", () => {
  const ok = {
    paymentProfileId: "pp_1",
    amount: 30,
    allocations: [
      { invoiceId: "a", amount: 10 },
      { invoiceId: "b", amount: 20 },
    ],
  };
  it("accepts a body whose allocations sum to amount", () => {
    expect(chargeSavedSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects when allocations do not sum to amount", () => {
    expect(chargeSavedSchema.safeParse({ ...ok, amount: 25 }).success).toBe(false);
  });
  it("tolerates sub-cent float drift in the sum", () => {
    const r = chargeSavedSchema.safeParse({
      paymentProfileId: "pp",
      amount: 0.3,
      allocations: [{ invoiceId: "a", amount: 0.1 }, { invoiceId: "b", amount: 0.2 }],
    });
    expect(r.success).toBe(true);
  });
  it("requires a paymentProfileId and at least one allocation", () => {
    expect(chargeSavedSchema.safeParse({ amount: 10, allocations: [{ invoiceId: "a", amount: 10 }] }).success).toBe(false);
    expect(chargeSavedSchema.safeParse({ paymentProfileId: "p", amount: 10, allocations: [] }).success).toBe(false);
  });
});

describe("hostedTokenSchema", () => {
  it("requires at least one allocation and passes through extra fields", () => {
    const r = hostedTokenSchema.safeParse({
      allocations: [{ invoiceId: "a", amount: 5 }],
      saveCard: true,
      iframeCommunicatorUrl: "https://x/IFrameCommunicator.html",
    });
    expect(r.success).toBe(true);
    expect(r.data.saveCard).toBe(true);
    expect(r.data.iframeCommunicatorUrl).toContain("IFrameCommunicator");
  });
  it("rejects an empty allocation list", () => {
    expect(hostedTokenSchema.safeParse({ allocations: [] }).success).toBe(false);
  });
});

describe("hostedCompleteSchema", () => {
  it("requires transId, refId and allocations", () => {
    expect(
      hostedCompleteSchema.safeParse({ transId: "t1", refId: "Habc", allocations: [{ invoiceId: "a", amount: 5 }] }).success
    ).toBe(true);
    expect(hostedCompleteSchema.safeParse({ transId: "t1", allocations: [{ invoiceId: "a", amount: 5 }] }).success).toBe(false);
    expect(hostedCompleteSchema.safeParse({ refId: "H", allocations: [{ invoiceId: "a", amount: 5 }] }).success).toBe(false);
  });
});

describe("refundSchema", () => {
  it("accepts a transactionId alone (full reversal)", () => {
    expect(refundSchema.safeParse({ transactionId: "1234567890" }).success).toBe(true);
  });
  it("requires a non-empty transactionId", () => {
    expect(refundSchema.safeParse({}).success).toBe(false);
    expect(refundSchema.safeParse({ transactionId: "" }).success).toBe(false);
  });
  it("accepts partial allocations", () => {
    expect(
      refundSchema.safeParse({
        transactionId: "t",
        allocations: [{ invoiceId: "a", amount: 40 }, { invoiceId: "b", amount: 10.5 }],
      }).success
    ).toBe(true);
  });
  it("rejects an empty allocations array (must omit for full, or send ≥1)", () => {
    expect(refundSchema.safeParse({ transactionId: "t", allocations: [] }).success).toBe(false);
  });
  it("rejects an allocation with a missing invoiceId or bad amount", () => {
    expect(refundSchema.safeParse({ transactionId: "t", allocations: [{ amount: 5 }] }).success).toBe(false);
    expect(refundSchema.safeParse({ transactionId: "t", allocations: [{ invoiceId: "a", amount: 0 }] }).success).toBe(false);
    expect(refundSchema.safeParse({ transactionId: "t", allocations: [{ invoiceId: "a", amount: 10.001 }] }).success).toBe(false);
  });
});

describe("checkoutSchema", () => {
  const base = {
    opaqueData: { dataDescriptor: "d", dataValue: "v" },
    amount: 50,
    items: [{ variantId: "SKU1", qty: 2 }],
    email: "buyer@example.com",
    shipping: { name: "A B", address1: "1 St", city: "Town", state: "TX", postalCode: "75001" },
  };
  it("accepts a valid guest checkout body and strips extra item fields (server prices from variantId)", () => {
    const r = checkoutSchema.safeParse({
      ...base,
      amount: 50,
      phone: "555",
      idempotencyKey: "uuid",
      items: [{ variantId: "5", qty: 1, name: "Widget", price: 9.99 }],
    });
    expect(r.success).toBe(true);
    expect(r.data.items[0]).toEqual({ variantId: "5", qty: 1 });
  });
  it("requires opaqueData, email, items and a complete shipping address", () => {
    expect(checkoutSchema.safeParse({ ...base, opaqueData: { dataDescriptor: "d" } }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, shipping: { name: "A" } }).success).toBe(false);
  });
  it("requires the quoted amount the shopper agreed to, cent-precise", () => {
    const { amount, ...noAmount } = base;
    expect(checkoutSchema.safeParse(noAmount).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, amount: 10.001 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, amount: 0 }).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...base, amount: "43.60" }).data.amount).toBe(43.6);
  });
  it("rejects non-positive or non-integer item quantities", () => {
    expect(checkoutSchema.safeParse({ ...base, items: [{ variantId: "x", qty: 0 }] }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, items: [{ variantId: "x", qty: 1.5 }] }).success).toBe(false);
  });
});

describe("checkoutSchema amount typing", () => {
  const body = (amount) => ({
    opaqueData: { dataDescriptor: "d", dataValue: "v" },
    amount,
    items: [{ variantId: "v1", qty: 1 }],
    email: "a@b.co",
    shipping: { name: "n", address1: "a", city: "c", state: "TX", postalCode: "75001" },
  });
  it("accepts numbers and numeric strings, including zero", () => {
    expect(checkoutSchema.safeParse(body(43.6)).success).toBe(true);
    expect(checkoutSchema.safeParse(body("43.60")).success).toBe(true);
    expect(checkoutSchema.safeParse(body(0)).success).toBe(true);
  });
  it("rejects null, booleans, arrays and blank strings that coerce to a number", () => {
    for (const bad of [null, false, true, [], [5], "", "  "]) {
      expect(checkoutSchema.safeParse(body(bad)).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
