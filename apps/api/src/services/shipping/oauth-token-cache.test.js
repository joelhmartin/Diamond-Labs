import { test } from "vitest";
import assert from "node:assert/strict";
import { createTokenCache, FAILURE_COOLDOWN_MS } from "./oauth-token-cache.js";

const counter = (expiresInSec = 3600) => {
  const f = async () => { f.calls += 1; return { accessToken: `tok${f.calls}`, expiresInSec }; };
  f.calls = 0;
  return f;
};

test("a token is fetched once and reused until 60 seconds before it expires", async () => {
  let t = 0;
  const cache = createTokenCache({ now: () => t });
  const f = counter(3600);
  assert.equal(await cache.get("ups:sandbox", f), "tok1");
  t = 3_600_000 - 60_001;
  assert.equal(await cache.get("ups:sandbox", f), "tok1");
  t = 3_600_000 - 60_000;
  assert.equal(await cache.get("ups:sandbox", f), "tok2");
  assert.equal(f.calls, 2);
});

test("expires_in is honoured, never assumed: a short token refreshes at half its life", async () => {
  let t = 0;
  const cache = createTokenCache({ now: () => t });
  const f = counter(60);
  await cache.get("k", f);
  t = 29_999;
  await cache.get("k", f);
  assert.equal(f.calls, 1);
  t = 30_000;
  await cache.get("k", f);
  assert.equal(f.calls, 2);
});

test("concurrent callers share ONE token request (FedEx locks its token endpoint above ~1 rps)", async () => {
  let release;
  let calls = 0;
  const slow = () => { calls += 1; return new Promise((r) => { release = () => r({ accessToken: "t", expiresInSec: 3600 }); }); };
  const cache = createTokenCache();
  const all = Promise.all([cache.get("k", slow), cache.get("k", slow), cache.get("k", slow)]);
  release();
  assert.deepEqual(await all, ["t", "t", "t"]);
  assert.equal(calls, 1);
});

test("keys never share a token: UPS vs FedEx, sandbox vs production", async () => {
  const cache = createTokenCache();
  const f = counter();
  await cache.get("ups:sandbox", f);
  await cache.get("fedex:sandbox", f);
  await cache.get("ups:production", f);
  assert.equal(f.calls, 3);
});

test("a failed token request is not cached, and clear(key) forces a fresh token (after a 401)", async () => {
  let t = 0;
  const cache = createTokenCache({ now: () => t });
  let fail = true;
  const f = async () => { if (fail) throw new Error("401"); return { accessToken: "ok", expiresInSec: 3600 }; };
  await assert.rejects(cache.get("k", f));
  fail = false;
  t = FAILURE_COOLDOWN_MS;
  assert.equal(await cache.get("k", f), "ok");
  const g = counter();
  await cache.get("j", g);
  cache.clear("j");
  await cache.get("j", g);
  assert.equal(g.calls, 2);
});

test("a token response without a token or lifetime is refused, not cached", async () => {
  const cache = createTokenCache();
  await assert.rejects(cache.get("k", async () => ({ accessToken: "", expiresInSec: 3600 })), TypeError);
  await assert.rejects(cache.get("k", async () => ({ accessToken: "t", expiresInSec: NaN })), TypeError);
});

test("after a failed fetch the key is refused for 30s with the same failure; clear(key) lifts it", async () => {
  let t = 0;
  const cache = createTokenCache({ now: () => t });
  let calls = 0;
  const bad = async () => { calls += 1; throw new Error("bad credentials"); };
  await assert.rejects(cache.get("k", bad), /bad credentials/);
  t = FAILURE_COOLDOWN_MS - 1;
  await assert.rejects(cache.get("k", bad), /bad credentials/);
  assert.equal(calls, 1, "no second token request inside the cooldown");
  await assert.rejects(cache.get("other", bad), /bad credentials/);
  assert.equal(calls, 2, "the cooldown is per key");
  cache.clear("k");
  await assert.rejects(cache.get("k", bad), /bad credentials/);
  assert.equal(calls, 3);
  t = 10 * FAILURE_COOLDOWN_MS;
  assert.equal(await cache.get("k", async () => ({ accessToken: "ok", expiresInSec: 3600 })), "ok");
});
