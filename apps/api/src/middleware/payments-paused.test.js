import { test, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { paymentsPausedGuard, PAYMENTS_PAUSED_MESSAGE } = await import("./payments-paused.js");

const fakeReply = () => ({
  statusCode: 200,
  body: undefined,
  code(c) { this.statusCode = c; return this; },
  send(b) { this.body = b; return this; },
});

test("paused: the request is refused with 503 and the upgrade message", async () => {
  const reply = fakeReply();
  await paymentsPausedGuard(() => true)({}, reply);
  assert.equal(reply.statusCode, 503);
  assert.deepEqual(reply.body, { error: { code: "PAYMENTS_PAUSED", message: PAYMENTS_PAUSED_MESSAGE } });
});

test("not paused: the request passes untouched", async () => {
  const reply = fakeReply();
  assert.equal(await paymentsPausedGuard(() => false)({}, reply), undefined);
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.body, undefined);
});

test("PAYMENTS_PAUSED is off unless set to the string true", async () => {
  const saved = process.env.PAYMENTS_PAUSED;
  const load = async (value) => {
    if (value === undefined) delete process.env.PAYMENTS_PAUSED;
    else process.env.PAYMENTS_PAUSED = value;
    vi.resetModules();
    return (await import("../config/env.js")).env.PAYMENTS_PAUSED;
  };
  try {
    assert.equal(await load(undefined), false);
    assert.equal(await load("true"), true);
    assert.equal(await load("false"), false);
    assert.equal(await load("1"), false);
    assert.equal(await load("yes"), false);
  } finally {
    if (saved === undefined) delete process.env.PAYMENTS_PAUSED;
    else process.env.PAYMENTS_PAUSED = saved;
  }
});
