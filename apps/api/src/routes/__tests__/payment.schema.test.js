import { describe, it, expect } from "vitest";
import {
  allocationSchema,
  chargeSavedSchema,
  hostedTokenSchema,
  hostedCompleteSchema,
  checkoutSchema,
  refundSchema,
  adminPaymentsQuerySchema,
} from "@my-app/shared";

describe("allocationSchema", () => {
  it("is a local invoice id and integer cents", () => {
    expect(allocationSchema.safeParse({ invoiceId: "inv1", amountCents: 1250 }).success).toBe(true);
    expect(allocationSchema.safeParse({ invoiceId: "inv1", amountCents: 12.5 }).success).toBe(false);
    expect(allocationSchema.safeParse({ invoiceId: "", amountCents: 5 }).success).toBe(false);
    expect(allocationSchema.safeParse({ invoiceId: "a", amountCents: 0 }).success).toBe(false);
    expect(allocationSchema.safeParse({ invoiceId: "a", amountCents: 10_000_001 }).success).toBe(false);
  });
});

describe("chargeSavedSchema", () => {
  const ok = { paymentProfileId: "pp_1", amountCents: 3000, allocations: [{ invoiceId: "a", amountCents: 1000 }, { invoiceId: "b", amountCents: 2000 }] };
  it("accepts allocations that sum exactly to the charge", () => {
    expect(chargeSavedSchema.safeParse(ok).success).toBe(true);
    expect(chargeSavedSchema.safeParse({ ...ok, amountCents: 2999 }).success).toBe(false);
  });
  it("refuses the same invoice twice", () => {
    expect(chargeSavedSchema.safeParse({ ...ok, allocations: [{ invoiceId: "a", amountCents: 1500 }, { invoiceId: "a", amountCents: 1500 }] }).success).toBe(false);
  });
  it("requires a paymentProfileId and at least one allocation", () => {
    expect(chargeSavedSchema.safeParse({ amountCents: 10, allocations: [{ invoiceId: "a", amountCents: 10 }] }).success).toBe(false);
    expect(chargeSavedSchema.safeParse({ paymentProfileId: "p", amountCents: 10, allocations: [] }).success).toBe(false);
  });
});

describe("hostedTokenSchema / hostedCompleteSchema", () => {
  it("carry cents allocations; extra token fields pass through", () => {
    const r = hostedTokenSchema.safeParse({ allocations: [{ invoiceId: "a", amountCents: 500 }], saveCard: true, iframeCommunicatorUrl: "https://x/IFrameCommunicator.html" });
    expect(r.success).toBe(true);
    expect(r.data.saveCard).toBe(true);
    expect(hostedTokenSchema.safeParse({ allocations: [] }).success).toBe(false);
    expect(hostedCompleteSchema.safeParse({ transId: "t1", refId: "Habc", allocations: [{ invoiceId: "a", amountCents: 500 }] }).success).toBe(true);
    expect(hostedCompleteSchema.safeParse({ transId: "t1", allocations: [{ invoiceId: "a", amountCents: 500 }] }).success).toBe(false);
  });
});

describe("refundSchema", () => {
  it("full reversal with a transaction id alone; partial with cents slices", () => {
    expect(refundSchema.safeParse({ transactionId: "1234567890" }).success).toBe(true);
    expect(refundSchema.safeParse({ transactionId: "" }).success).toBe(false);
    expect(refundSchema.safeParse({ transactionId: "t", allocations: [{ invoiceId: "a", amountCents: 4000 }] }).success).toBe(true);
    expect(refundSchema.safeParse({ transactionId: "t", allocations: [] }).success).toBe(false);
    expect(refundSchema.safeParse({ transactionId: "t", allocations: [{ invoiceId: "a", amountCents: 10.5 }] }).success).toBe(false);
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

describe("adminPaymentsQuerySchema", () => {
  it("coerces limit/offset and keeps the no-limit legacy shape", () => {
    expect(adminPaymentsQuerySchema.parse({ limit: "25", offset: "50", q: " abc " })).toEqual({ limit: 25, offset: 50, q: "abc" });
    expect(adminPaymentsQuerySchema.parse({ userId: "u1" }).limit).toBeUndefined();
  });
  it("rejects a limit over 200 or below 1 and a negative offset", () => {
    for (const bad of [{ limit: "201" }, { limit: "0" }, { offset: "-1" }]) expect(adminPaymentsQuerySchema.safeParse(bad).success).toBe(false);
  });
});
