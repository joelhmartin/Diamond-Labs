import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

// authenticate is normally a JWT + DB lookup; for a route-level test we only
// care that request.user gets populated, so stub it to the doctor fixture
// directly — same substitution style as other route/middleware tests in this
// repo (see jobs/triggers/http.test.js for the sibling pattern of swapping
// out only the dependency under test, not the route logic).
const doctor = { id: "doc-1", role: "doctor", approvalStatus: "approved", name: "Doc" };
vi.mock("../../middleware/authenticate.js", () => ({
  authenticate: async (request) => {
    request.user = doctor;
  },
}));

// Real requireApprovedDoctor + validate — they're pure and cheap, no reason
// to fake them; this also exercises the real 422 shape validate() produces.

// Fully mocked (not importActual) — the real module pulls in card.service.js
// -> authorizenet.service.js and the real db client, which is more than this
// route-level test needs. AutopayValidationError/AutopayGatewayError are
// defined here as plain classes; since both the route (via this mocked
// module) and the test construct errors through these same exports,
// `instanceof` checks in the route hold regardless of them not being the
// "real" classes from the actual file.
let enrollment = null;
let cards = [];
let cardsThrow = null;
let upsertResult = null;
let upsertThrow = null;
class AutopayValidationErrorMock extends Error {
  constructor(message, field) {
    super(message);
    this.name = "AutopayValidationError";
    this.field = field;
  }
}
class AutopayGatewayErrorMock extends Error {
  constructor(cause) {
    super(`Could not verify the card on file: ${cause?.message || cause}`);
    this.name = "AutopayGatewayError";
    this.cause = cause;
  }
}
vi.mock("../../services/autopay.service.js", () => ({
  AutopayValidationError: AutopayValidationErrorMock,
  AutopayGatewayError: AutopayGatewayErrorMock,
  getEnrollment: async () => enrollment,
  upsertEnrollment: async () => {
    if (upsertThrow) throw upsertThrow;
    return upsertResult;
  },
  deleteEnrollment: async () => {},
  effectiveFloor: (e) => (e?.minAmountOverride != null ? Number(e.minAmountOverride) : 200),
}));

vi.mock("../../services/card.service.js", () => ({
  listCardsForUser: async () => {
    if (cardsThrow) throw cardsThrow;
    return cards;
  },
}));

vi.mock("../../services/audit.service.js", () => ({
  logSafe: () => {},
}));

// Intercept eq/desc so the /autopay/attempts test below can prove the route's
// WHERE clause actually threads request.user.id (scoping), and that the
// ORDER BY is descending — without reimplementing a SQL evaluator. Every
// other named export of drizzle-orm passes through untouched.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm");
  return {
    ...actual,
    eq: (column, value) => ({ __op: "eq", column, value }),
    desc: (column) => ({ __op: "desc", column }),
  };
});

// In-memory stand-in for the autopay_attempts table. `where`/`orderBy`/`limit`
// apply the eq/desc markers above against `attemptRows` — this is what lets
// the scoping test seed rows for TWO different userIds and assert the route
// only returns the caller's.
let attemptRows = [];
vi.mock("../../config/database.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond) => ({
          orderBy: (sortCond) => ({
            limit: async (n) => {
              const filtered = attemptRows.filter((r) => r.userId === cond.value);
              const sorted = sortCond?.__op === "desc"
                ? [...filtered].sort((a, b) => b.createdAt - a.createdAt)
                : filtered;
              return sorted.slice(0, n);
            },
          }),
        }),
      }),
    }),
  },
}));

const { default: autopayRoutes, nextRunDate } = await import("../autopay.routes.js");
const { AutopayValidationError, AutopayGatewayError } = await import("../../services/autopay.service.js");

let fastify;

beforeAll(async () => {
  fastify = Fastify();
  fastify.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    if (!body || body.trim() === "") return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      done(err);
    }
  });
  await fastify.register(autopayRoutes, { prefix: "/api/v1" });
  await fastify.ready();
});

afterAll(async () => {
  await fastify.close();
});

beforeEach(() => {
  enrollment = null;
  cards = [];
  cardsThrow = null;
  upsertResult = null;
  upsertThrow = null;
  attemptRows = [];
});

describe("GET /api/v1/autopay", () => {
  it("returns the envelope shape with no enrollment and no cards", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/v1/autopay" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: {
        enrollment: null,
        cards: [],
        cardsUnavailable: false,
        minAmount: 200,
        canEnroll: false,
      },
    });
  });

  it("reflects canEnroll=true when a card is on file", async () => {
    cards = [{ paymentProfileId: "pp1", isDefault: true }];
    const res = await fastify.inject({ method: "GET", url: "/api/v1/autopay" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.canEnroll).toBe(true);
    expect(body.data.cards).toEqual(cards);
  });

  it("flags cardsUnavailable instead of rendering a gateway failure as 'no cards'", async () => {
    cardsThrow = new Error("Authorize.net timed out");
    const res = await fastify.inject({ method: "GET", url: "/api/v1/autopay" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.cardsUnavailable).toBe(true);
    expect(body.data.cards).toEqual([]);
    // Must not tell a doctor with a real card on file that they can enroll
    // (or, implicitly, that they have no card) when we simply don't know.
    expect(body.data.canEnroll).toBe(false);
  });
});

describe("PUT /api/v1/autopay", () => {
  const validBody = { amount: 500, dayOfMonth: 15, paymentProfileId: "pp1" };

  it("maps AutopayValidationError to 422", async () => {
    upsertThrow = new AutopayValidationError("That card is not on file.", "paymentProfileId");
    const res = await fastify.inject({ method: "PUT", url: "/api/v1/autopay", payload: validBody });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.field).toBe("paymentProfileId");
  });

  it("maps AutopayGatewayError to 502, not 422", async () => {
    upsertThrow = new AutopayGatewayError(new Error("network blip"));
    const res = await fastify.inject({ method: "PUT", url: "/api/v1/autopay", payload: validBody });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    // Must not look like the doctor's-fault validation shape — no "field",
    // and the message must not tell them to go add a card.
    expect(body.error.field).toBeUndefined();
    expect(body.error.message.toLowerCase()).not.toContain("not on file");
  });

  it("returns the serialized enrollment on success", async () => {
    upsertResult = {
      enabled: true,
      amount: "500.00",
      dayOfMonth: 15,
      paymentProfileId: "pp1",
      status: "active",
      pausedReason: null,
      consecutiveFailures: 0,
      minAmountOverride: null,
      lastChargedAt: null,
    };
    const res = await fastify.inject({ method: "PUT", url: "/api/v1/autopay", payload: validBody });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.enrollment.amount).toBe(500);
    expect(body.data.enrollment.paymentProfileId).toBe("pp1");
  });

  it("rejects an invalid body with 422 before reaching the service", async () => {
    const res = await fastify.inject({
      method: "PUT",
      url: "/api/v1/autopay",
      payload: { amount: 500, dayOfMonth: 99, paymentProfileId: "pp1" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("strips a smuggled minAmountOverride before it reaches the service", async () => {
    // The doctor schema has no minAmountOverride field, so validate()'s
    // request.body = result.data replacement strips it. Prove the route
    // still works and doesn't crash trying to honor it.
    upsertResult = {
      enabled: false,
      amount: "500.00",
      dayOfMonth: 15,
      paymentProfileId: "pp1",
      status: "active",
      pausedReason: null,
      consecutiveFailures: 0,
      minAmountOverride: null,
      lastChargedAt: null,
    };
    const res = await fastify.inject({
      method: "PUT",
      url: "/api/v1/autopay",
      payload: { ...validBody, minAmountOverride: 1 },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("DELETE /api/v1/autopay", () => {
  it("returns a confirmation message", async () => {
    const res = await fastify.inject({ method: "DELETE", url: "/api/v1/autopay" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { message: "AutoPay cancelled." } });
  });
});

describe("nextRunDate", () => {
  // Noon UTC keeps the same Chicago calendar date across both CDT (-5) and
  // CST (-6) — the fixed `now` values below are all unambiguous either way.
  const base = { enabled: true, status: "active", dayOfMonth: 15, lastChargedAt: null };

  it("returns this month's charge day when today is before it", () => {
    const now = new Date("2026-08-10T12:00:00Z");
    expect(nextRunDate(base, now)).toBe("2026-08-15");
  });

  it("returns TODAY when today is the charge day and this cycle hasn't been charged yet", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    expect(nextRunDate({ ...base, lastChargedAt: null }, now)).toBe("2026-08-15");
  });

  it("rolls to next month when today is the charge day but this cycle was already charged", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    expect(nextRunDate({ ...base, lastChargedAt: "2026-08-01T12:00:00Z" }, now)).toBe("2026-09-15");
  });

  it("returns next month's charge day when today is after it", () => {
    const now = new Date("2026-08-20T12:00:00Z");
    expect(nextRunDate(base, now)).toBe("2026-09-15");
  });

  it("clamps a day-31 preference to Feb 28 in a non-leap year", () => {
    const now = new Date("2026-02-05T12:00:00Z");
    expect(nextRunDate({ ...base, dayOfMonth: 31 }, now)).toBe("2026-02-28");
  });

  it("rolls December into January of the next year", () => {
    const now = new Date("2026-12-20T12:00:00Z");
    expect(nextRunDate(base, now)).toBe("2027-01-15");
  });

  it("returns null for a paused enrollment", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    expect(nextRunDate({ ...base, status: "paused" }, now)).toBeNull();
  });
});

describe("GET /api/v1/autopay/attempts", () => {
  it("returns only the calling doctor's attempts, not another doctor's", async () => {
    attemptRows = [
      { id: "a1", userId: "doc-1", createdAt: new Date("2026-08-01T00:00:00Z"), amountAttempted: "10.00", amountCharged: null },
      { id: "a2", userId: "doc-2", createdAt: new Date("2026-08-02T00:00:00Z"), amountAttempted: "20.00", amountCharged: null },
      { id: "a3", userId: "doc-1", createdAt: new Date("2026-08-03T00:00:00Z"), amountAttempted: "30.00", amountCharged: "30.00" },
    ];
    const res = await fastify.inject({ method: "GET", url: "/api/v1/autopay/attempts" });
    expect(res.statusCode).toBe(200);
    const { attempts } = res.json().data;
    expect(attempts.map((a) => a.id).sort()).toEqual(["a1", "a3"]);
    expect(attempts.every((a) => a.userId === "doc-1")).toBe(true);
  });

  it("orders newest-first and caps at 50", async () => {
    attemptRows = Array.from({ length: 60 }, (_, i) => ({
      id: `row-${i}`,
      userId: "doc-1",
      createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
      amountAttempted: "10.00",
      amountCharged: null,
    }));
    const res = await fastify.inject({ method: "GET", url: "/api/v1/autopay/attempts" });
    expect(res.statusCode).toBe(200);
    const { attempts } = res.json().data;
    expect(attempts).toHaveLength(50);
    // Newest first: row-59 (Jan 1 + 59 days) has the latest createdAt.
    expect(attempts[0].id).toBe("row-59");
    expect(attempts.at(-1).id).toBe("row-10");
  });

  it("serializes amountAttempted/amountCharged as numbers, matching the enrollment endpoint", async () => {
    attemptRows = [
      { id: "a1", userId: "doc-1", createdAt: new Date(), amountAttempted: "12.50", amountCharged: "12.50" },
      { id: "a2", userId: "doc-1", createdAt: new Date(), amountAttempted: "9.00", amountCharged: null },
    ];
    const res = await fastify.inject({ method: "GET", url: "/api/v1/autopay/attempts" });
    const { attempts } = res.json().data;
    const a1 = attempts.find((a) => a.id === "a1");
    const a2 = attempts.find((a) => a.id === "a2");
    expect(a1.amountAttempted).toBe(12.5);
    expect(a1.amountCharged).toBe(12.5);
    expect(a2.amountCharged).toBeNull();
  });
});
