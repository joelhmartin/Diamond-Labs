import { test } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { env } = await import("./env.js");

test("carriers default to the sandbox and image labels", () => {
  assert.equal(env.CARRIER_ENV, "sandbox");
  assert.equal(env.LABEL_FORMAT, "image");
});

test("shipping is not billed until the lab decides (the one business decision)", () => {
  assert.equal(env.SHIPPING_CHARGE_POLICY, "none");
  assert.equal(env.SHIPPING_FLAT_CENTS, 0);
});

test("the shipped email is on by default", () => {
  assert.equal(env.SHIPPED_EMAIL_ENABLED, true);
});
