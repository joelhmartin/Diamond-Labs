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

const { default: autopayRoutes } = await import("../autopay.routes.js");
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
