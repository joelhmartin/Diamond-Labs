import { test } from "vitest";
import assert from "node:assert/strict";
import { optionalAuthenticate } from "./authenticate.js";

function fakeReply() {
  return {
    statusCode: null, body: null,
    code(c) { this.statusCode = c; return this; },
    send(b) { this.body = b; return this; },
  };
}

test("no token: continue as a guest", async () => {
  const request = { headers: {} };
  const reply = fakeReply();
  await optionalAuthenticate(request, reply);
  assert.equal(request.user, undefined);
  assert.equal(reply.statusCode, null);
});

test("a presented but invalid token is refused, not downgraded to guest pricing", async () => {
  // Downgrading would quietly charge an approved doctor the base price.
  const request = { headers: { authorization: "Bearer not-a-real-token" } };
  const reply = fakeReply();
  await optionalAuthenticate(request, reply);
  assert.equal(reply.statusCode, 401);
  assert.equal(request.user, undefined);
});
