import { describe, it, expect } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { env } = await import("./env.js");

describe("AutoPay configuration defaults", () => {
  it("defaults AUTOPAY_LIVE_RUN to false so the sweep cannot charge", () => {
    expect(env.AUTOPAY_LIVE_RUN).toBe(false);
  });

  it("defaults the enrollment floor to $200", () => {
    expect(env.AUTOPAY_MIN_AMOUNT).toBe(200);
  });

  it("defaults the timezone to lab time", () => {
    expect(env.AUTOPAY_TIMEZONE).toBe("America/Chicago");
  });

  it("defaults the failure threshold to 3", () => {
    expect(env.AUTOPAY_MAX_FAILURES).toBe(3);
  });
});
