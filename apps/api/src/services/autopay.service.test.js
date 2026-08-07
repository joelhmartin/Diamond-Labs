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

// In-memory row array standing in for the table. `select` always reflects
// whatever `insert`/`update` last wrote, so the service's post-write
// getEnrollment() re-read returns real, current state — same as a real DB.
const rows = [];
vi.mock("../config/database.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows.slice(0, 1) }) }) }),
    insert: () => ({
      values: async (v) => {
        // Model the columns that come from DB defaults rather than app code
        // (e.g. createdAt: timestamp().defaultNow()) — the app never sets
        // these explicitly, so a mock that only stored `v` verbatim would
        // silently hide the exact bug this fix addresses.
        const row = { createdAt: new Date(), ...v };
        rows.push(row);
        return row;
      },
    }),
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

  it("returns a fully-persisted row on create, not a locally-built approximation", async () => {
    const created = await upsertEnrollment({
      user, amount: 300, dayOfMonth: 15, paymentProfileId: "pp1", actorUserId: "u1",
    });
    // createdAt/status come from the DB (default/explicit) and must be
    // present via a re-read, same as what an update returns — not undefined
    // because the insert branch built its own return value by hand.
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.status).toBe("active");
  });

  // I5 — turning AutoPay OFF must never be blocked by validation that exists
  // to gate turning it ON. Both admin surfaces implement "disable" as a full
  // PUT carrying the existing amount/day/card.
  it("allows disabling even when the amount is below the floor", async () => {
    const e = await upsertEnrollment({
      user, amount: 50, dayOfMonth: 15, paymentProfileId: "pp1", enabled: false, actorUserId: "admin1",
    });
    expect(e.enabled).toBe(false);
  });

  it("allows disabling even when the card gateway is down", async () => {
    gatewayError = new Error("Authorize.net timed out");
    const e = await upsertEnrollment({
      user, amount: 300, dayOfMonth: 15, paymentProfileId: "pp1", enabled: false, actorUserId: "admin1",
    });
    expect(e.enabled).toBe(false);
  });

  it("allows disabling even when no card is on file at all", async () => {
    cards = [];
    const e = await upsertEnrollment({
      user, amount: 300, dayOfMonth: 15, paymentProfileId: "pp1", enabled: false, actorUserId: "admin1",
    });
    expect(e.enabled).toBe(false);
  });

  it("still enforces the floor and card check when enabling", async () => {
    await expect(
      upsertEnrollment({
        user, amount: 50, dayOfMonth: 15, paymentProfileId: "pp1", enabled: true, actorUserId: "admin1",
      })
    ).rejects.toThrow(AutopayValidationError);
  });

  it("still enforces both checks when `enabled` is omitted and the enrollment is already enabled", async () => {
    await upsertEnrollment({ user, amount: 300, dayOfMonth: 15, paymentProfileId: "pp1", enabled: true, actorUserId: "u1" });
    // Now update amount/day WITHOUT touching `enabled` — the resulting state
    // is still enabled, so the floor must still apply.
    await expect(
      upsertEnrollment({ user, amount: 50, dayOfMonth: 20, paymentProfileId: "pp1", actorUserId: "u1" })
    ).rejects.toThrow(AutopayValidationError);
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
