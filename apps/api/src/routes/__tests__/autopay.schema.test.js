import { describe, it, expect } from "vitest";
import { autopayEnrollSchema, autopayAdminEnrollSchema } from "@my-app/shared";

describe("autopayEnrollSchema", () => {
  it("accepts a valid enrollment", () => {
    expect(autopayEnrollSchema.safeParse({ amount: 500, dayOfMonth: 15, paymentProfileId: "pp1" }).success).toBe(true);
  });

  it("rejects a day above 31", () => {
    expect(autopayEnrollSchema.safeParse({ amount: 500, dayOfMonth: 32, paymentProfileId: "pp1" }).success).toBe(false);
  });

  it("rejects a day of 0", () => {
    expect(autopayEnrollSchema.safeParse({ amount: 500, dayOfMonth: 0, paymentProfileId: "pp1" }).success).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(autopayEnrollSchema.safeParse({ amount: -5, dayOfMonth: 15, paymentProfileId: "pp1" }).success).toBe(false);
  });

  it("requires a payment profile", () => {
    expect(autopayEnrollSchema.safeParse({ amount: 500, dayOfMonth: 15, paymentProfileId: "" }).success).toBe(false);
  });

  it("does not accept a floor override on the doctor schema", () => {
    const parsed = autopayEnrollSchema.parse({ amount: 500, dayOfMonth: 15, paymentProfileId: "pp1", minAmountOverride: 1 });
    expect(parsed.minAmountOverride).toBeUndefined();
  });

  it("accepts a floor override on the admin schema", () => {
    expect(autopayAdminEnrollSchema.safeParse({ amount: 100, dayOfMonth: 15, paymentProfileId: "pp1", minAmountOverride: 75 }).success).toBe(true);
  });
});
