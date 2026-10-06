import { describe, it, expect } from "vitest";

// env.js validates required vars at import time; postgres-js connects lazily.
process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { chargeErrorReply } = await import("../payment.routes.js");

function fakeReply() {
  const r = { statusCode: null, body: null };
  r.code = (c) => { r.statusCode = c; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

describe("chargeErrorReply — fraud-review holds", () => {
  it("a hold that could not be declined → 409 PAYMENT_UNDER_REVIEW (tells the client not to retry)", () => {
    const err = Object.assign(new Error("held"), {
      heldForReview: true,
      gatewayOutcomePending: true,
      authNetResponse: { transactionResponse: { responseCode: "4" } },
    });
    const r = chargeErrorReply(fakeReply(), err);
    expect(r.statusCode).toBe(409);
    expect(r.body.error.code).toBe("PAYMENT_UNDER_REVIEW");
  });

  it("a hold we declined → 402 PAYMENT_HELD_DECLINED (definitive: card not charged)", () => {
    const err = Object.assign(new Error("held"), {
      heldForReview: true,
      authNetResponse: { transactionResponse: { responseCode: "4" } },
    });
    const r = chargeErrorReply(fakeReply(), err);
    expect(r.statusCode).toBe(402);
    expect(r.body.error.code).toBe("PAYMENT_HELD_DECLINED");
  });

  it("an ordinary decline still maps to 402 CARD_DECLINED with the gateway text", () => {
    const err = Object.assign(new Error("declined"), {
      authNetResponse: { transactionResponse: { errors: [{ errorText: "This transaction has been declined." }] } },
    });
    const r = chargeErrorReply(fakeReply(), err);
    expect(r.statusCode).toBe(402);
    expect(r.body.error).toMatchObject({ code: "CARD_DECLINED", message: "This transaction has been declined." });
  });

  it("a non-gateway failure maps to 502", () => {
    const r = chargeErrorReply(fakeReply(), new Error("ECONNRESET"));
    expect(r.statusCode).toBe(502);
  });
});
