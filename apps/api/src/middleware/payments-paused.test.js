import { test, vi, afterEach } from "vitest";
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

async function loadPaused(value) {
  const saved = process.env.PAYMENTS_PAUSED;
  if (value === undefined) delete process.env.PAYMENTS_PAUSED;
  else process.env.PAYMENTS_PAUSED = value;
  vi.resetModules();
  try {
    return (await import("../config/env.js")).env.PAYMENTS_PAUSED;
  } finally {
    if (saved === undefined) delete process.env.PAYMENTS_PAUSED;
    else process.env.PAYMENTS_PAUSED = saved;
  }
}

afterEach(() => vi.restoreAllMocks());

test("PAYMENTS_PAUSED is off unless set to true (case-insensitive, trimmed)", async () => {
  assert.equal(await loadPaused(undefined), false);
  for (const v of ["true", "TRUE", " True "]) assert.equal(await loadPaused(v), true, v);
  for (const v of ["false", "False"]) assert.equal(await loadPaused(v), false, v);
});

test("any other PAYMENTS_PAUSED value fails env validation at boot", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit ${code}`); });
  for (const v of ["1", "yes"]) await assert.rejects(loadPaused(v), /exit 1/, v);
});
