import { test } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { env } = await import("./env.js");

test("invoice numbering has a placeholder start that piece 5 replaces before cutover", () => {
  assert.equal(env.INVOICE_NUMBER_START, 500000);
});

test("net terms default to 30 days", () => {
  assert.equal(env.INVOICE_TERMS_DAYS, 30);
});
