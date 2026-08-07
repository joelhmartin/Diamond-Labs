import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

let cards = [];
// When set, assertCardExists throws this instead of doing its normal
// card-lookup logic — used to simulate a gateway failure (as opposed to a
// legitimately missing card).
let gatewayError = null;
vi.mock("./card.service.js", () => ({
  CardNotFoundError: class CardNotFoundError extends Error {},
  assertCardExists: async (_user, id) => {
    if (gatewayError) throw gatewayError;
    if (!cards.some((c) => c.paymentProfileId === id)) {
      const E = (await import("./card.service.js")).CardNotFoundError;
      throw new E("missing");
    }
  },
}));

const rows = [];
vi.mock("../config/database.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows.slice(0, 1) }) }) }),
    insert: () => ({ values: async (v) => { rows.push(v); return v; } }),
    update: () => ({ set: (v) => ({ where: async () => { Object.assign(rows[0], v); } }) }),
    delete: () => ({ where: async () => { rows.length = 0; } }),
  },
}));

const { upsertEnrollment, effectiveFloor, AutopayValidationError } = await import("./autopay.service.js");

const user = { id: "u1", email: "d@x.com", name: "Doc", authorizeNetCustomerProfileId: "cp1" };

beforeEach(() => {
  rows.length = 0;
  cards = [{ paymentProfileId: "pp1" }];
  gatewayError = null;
});

describe("enrollment validation", () => {
  it("rejects an amount below the floor", async () => {
    await expect(
      upsertEnrollment({ user, amount: 50, dayOfMonth: 15, paymentProfileId: "pp1", actorUserId: "u1" })
    ).rejects.toThrow(AutopayValidationError);
  });

  it("accepts an amount at the floor", async () => {
    await expect(
      upsertEnrollment({ user, amount: 200, dayOfMonth: 15, paymentProfileId: "pp1", actorUserId: "u1" })
    ).resolves.toMatchObject({ amount: "200.00" });
  });

  it("requires a card on file", async () => {
    cards = [];
    await expect(
      upsertEnrollment({ user, amount: 300, dayOfMonth: 15, paymentProfileId: "pp1", actorUserId: "u1" })
    ).rejects.toThrow(/card/i);
  });

  it("lets an admin override the floor for one doctor", async () => {
    await expect(
      upsertEnrollment({
        user, amount: 100, dayOfMonth: 15, paymentProfileId: "pp1",
        minAmountOverride: 75, actorUserId: "admin1",
      })
    ).resolves.toMatchObject({ amount: "100.00", minAmountOverride: "75.00" });
  });

  it("still enforces the override as a floor", async () => {
    await expect(
      upsertEnrollment({
        user, amount: 50, dayOfMonth: 15, paymentProfileId: "pp1",
        minAmountOverride: 75, actorUserId: "admin1",
      })
    ).rejects.toThrow(AutopayValidationError);
  });

  it("rejects a day outside 1–31", async () => {
    await expect(
      upsertEnrollment({ user, amount: 300, dayOfMonth: 32, paymentProfileId: "pp1", actorUserId: "u1" })
    ).rejects.toThrow(/day/i);
  });

  it("defaults a new enrollment to disabled", async () => {
    const e = await upsertEnrollment({ user, amount: 300, dayOfMonth: 15, paymentProfileId: "pp1", actorUserId: "u1" });
    expect(e.enabled).toBe(false);
  });

  it("does not report a transient gateway error as a missing card", async () => {
    gatewayError = new Error("Authorize.net getCustomerProfile failed: resultCode Error");
    await expect(
      upsertEnrollment({ user, amount: 300, dayOfMonth: 15, paymentProfileId: "pp1", actorUserId: "u1" })
    ).rejects.toThrow(/resultCode Error/);
    // And critically: it must NOT be surfaced as the user-facing validation
    // error a real missing card produces.
    await expect(
      upsertEnrollment({ user, amount: 300, dayOfMonth: 15, paymentProfileId: "pp1", actorUserId: "u1" })
    ).rejects.not.toBeInstanceOf(AutopayValidationError);
  });
});

describe("effectiveFloor", () => {
  it("uses the configured minimum when there is no override", () => {
    expect(effectiveFloor({ minAmountOverride: null })).toBe(200);
  });

  it("uses the override when present", () => {
    expect(effectiveFloor({ minAmountOverride: "75.00" })).toBe(75);
  });
});
