import { test } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { assertSafeConfig, stagingRewrite, isStaging, registerStagingHeaders, effectiveGatewayMode, testModeError } from "./app-env.js";

const GOOD = {
  APP_ENV: "staging",
  AUTHORIZE_NET_ENV: "sandbox",
  STAGING_EMAIL_TO: "qa@example.com",
  SEAZONA_DISABLED: "true",
};

test("assertSafeConfig passes for a fully safe staging config", () => {
  assert.doesNotThrow(() => assertSafeConfig(GOOD));
});

test("assertSafeConfig rejects staging missing any single safety switch", () => {
  assert.throws(() => assertSafeConfig({ ...GOOD, AUTHORIZE_NET_ENV: "production" }), /AUTHORIZE_NET_ENV/);
  assert.throws(() => assertSafeConfig({ ...GOOD, AUTHORIZE_NET_ENV: undefined }), /AUTHORIZE_NET_ENV/);
  assert.throws(() => assertSafeConfig({ ...GOOD, STAGING_EMAIL_TO: undefined }), /STAGING_EMAIL_TO/);
  assert.throws(() => assertSafeConfig({ ...GOOD, STAGING_EMAIL_TO: "" }), /STAGING_EMAIL_TO/);
  assert.throws(() => assertSafeConfig({ ...GOOD, SEAZONA_DISABLED: undefined }), /SEAZONA_DISABLED/);
  assert.throws(() => assertSafeConfig({ ...GOOD, SEAZONA_DISABLED: "false" }), /SEAZONA_DISABLED/);
});

test("assertSafeConfig refuses a *-staging Cloud Run service without APP_ENV=staging", () => {
  assert.throws(() => assertSafeConfig({ K_SERVICE: "diamond-labs-api-staging" }), /staging service but APP_ENV/);
  assert.throws(() => assertSafeConfig({ K_SERVICE: "diamond-labs-api-staging", APP_ENV: "production" }), /staging service/);
  assert.throws(() => assertSafeConfig({ K_SERVICE: "x-staging", APP_ENV: "development" }), /staging service/);
});

test("assertSafeConfig: K_SERVICE leaves production and a correct staging unchanged", () => {
  assert.doesNotThrow(() => assertSafeConfig({ K_SERVICE: "diamond-labs-api" }));
  assert.doesNotThrow(() => assertSafeConfig({ K_SERVICE: "diamond-labs-api", APP_ENV: "production" }));
  assert.doesNotThrow(() => assertSafeConfig({}));
  assert.doesNotThrow(() => assertSafeConfig({ ...GOOD, K_SERVICE: "diamond-labs-api-staging" }));
});

test("assertSafeConfig reports every problem at once", () => {
  assert.throws(
    () => assertSafeConfig({ APP_ENV: "staging" }),
    (e) => /AUTHORIZE_NET_ENV/.test(e.message) && /STAGING_EMAIL_TO/.test(e.message) && /SEAZONA_DISABLED/.test(e.message),
  );
});

test("production and unset APP_ENV are never gated (prod unchanged)", () => {
  assert.doesNotThrow(() => assertSafeConfig({ APP_ENV: "production", AUTHORIZE_NET_ENV: "production" }));
  assert.doesNotThrow(() => assertSafeConfig({ AUTHORIZE_NET_ENV: "production" }));
  assert.doesNotThrow(() => assertSafeConfig({}));
  assert.equal(isStaging({}), false);
  assert.equal(isStaging({ APP_ENV: "production" }), false);
  assert.equal(isStaging({ APP_ENV: "staging" }), true);
});

test("stagingRewrite redirects to, prefixes subject, drops cc/bcc", () => {
  const out = stagingRewrite(
    { to: "doc@practice.com", cc: "x@y.com", bcc: "admin@lab.com", subject: "Your receipt", html: "<p>hi</p>", text: "hi" },
    GOOD,
  );
  assert.equal(out.to, "qa@example.com");
  assert.equal(out.subject, "[STAGING → doc@practice.com] Your receipt");
  assert.equal(out.cc, undefined);
  assert.equal(out.bcc, undefined);
  assert.equal(out.html, "<p>hi</p>");
  assert.equal(out.text, "hi");
});

test("stagingRewrite is the identity outside staging", () => {
  const msg = { to: "doc@practice.com", bcc: "admin@lab.com", subject: "S", html: "h" };
  assert.deepEqual(stagingRewrite(msg, {}), msg);
  assert.deepEqual(stagingRewrite(msg, { APP_ENV: "production", STAGING_EMAIL_TO: "qa@example.com" }), msg);
  assert.deepEqual(stagingRewrite(msg, { APP_ENV: "development" }), msg);
});

test("stagingRewrite fails closed (returns null) in staging without a redirect address", () => {
  assert.equal(stagingRewrite({ to: "a@b.com", subject: "s" }, { APP_ENV: "staging" }), null);
});

test("X-Robots-Tag is on every response in staging, including 404s", async () => {
  const app = Fastify();
  registerStagingHeaders(app, GOOD);
  app.get("/x", async () => ({ ok: 1 }));
  const ok = await app.inject("/x");
  const nf = await app.inject("/missing");
  assert.equal(ok.headers["x-robots-tag"], "noindex, nofollow");
  assert.equal(nf.headers["x-robots-tag"], "noindex, nofollow");
});

test("no X-Robots-Tag outside staging", async () => {
  for (const e of [{}, { APP_ENV: "production" }]) {
    const app = Fastify();
    registerStagingHeaders(app, e);
    app.get("/x", async () => ({ ok: 1 }));
    assert.equal((await app.inject("/x")).headers["x-robots-tag"], undefined);
  }
});

test("index.js runs assertSafeConfig before listen and registers staging headers", () => {
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const gate = src.indexOf("assertSafeConfig(env)");
  const listen = src.indexOf("fastify.listen(");
  assert.ok(gate > -1, "assertSafeConfig(env) must be called");
  assert.ok(listen > -1 && gate < listen, "gate must precede listen");
  assert.ok(src.includes("registerStagingHeaders(fastify, env)"));
});

test("assertSafeConfig rejects live Authorize.net credentials under staging", () => {
  assert.throws(() => assertSafeConfig({ ...GOOD, AUTHORIZE_NET_API_LOGIN: "live" }), /AUTHORIZE_NET_API_LOGIN/);
  assert.throws(() => assertSafeConfig({ ...GOOD, AUTHORIZE_NET_TRANSACTION_KEY: "live" }), /AUTHORIZE_NET_TRANSACTION_KEY/);
  // Sandbox-named creds are fine.
  assert.doesNotThrow(() => assertSafeConfig({ ...GOOD, AUTHORIZE_NET_SANDBOX_API_LOGIN: "s", AUTHORIZE_NET_SANDBOX_TRANSACTION_KEY: "s" }));
  // Production may keep them.
  assert.doesNotThrow(() => assertSafeConfig({ APP_ENV: "production", AUTHORIZE_NET_API_LOGIN: "live", AUTHORIZE_NET_TRANSACTION_KEY: "live" }));
});

test("assertSafeConfig rejects AutoPay live run and a jobs trigger secret under staging", () => {
  assert.throws(() => assertSafeConfig({ ...GOOD, AUTOPAY_LIVE_RUN: true }), /AUTOPAY_LIVE_RUN/);
  assert.throws(() => assertSafeConfig({ ...GOOD, AUTOPAY_LIVE_RUN: "true" }), /AUTOPAY_LIVE_RUN/);
  assert.throws(() => assertSafeConfig({ ...GOOD, JOBS_TRIGGER_SECRET: "s" }), /JOBS_TRIGGER_SECRET/);
  assert.doesNotThrow(() => assertSafeConfig({ ...GOOD, AUTOPAY_LIVE_RUN: false }));
  assert.doesNotThrow(() => assertSafeConfig({ ...GOOD, AUTOPAY_LIVE_RUN: "false" }));
  // Production unaffected.
  assert.doesNotThrow(() => assertSafeConfig({ APP_ENV: "production", AUTOPAY_LIVE_RUN: true, JOBS_TRIGGER_SECRET: "s" }));
});

test("effectiveGatewayMode: staging is always sandbox; others unchanged", () => {
  const st = { APP_ENV: "staging", AUTHORIZE_NET_ENV: "production" };
  assert.equal(effectiveGatewayMode("production", st), "sandbox");
  assert.equal(effectiveGatewayMode(undefined, st), "sandbox");
  assert.equal(effectiveGatewayMode("production", { AUTHORIZE_NET_ENV: "sandbox" }), "production");
  assert.equal(effectiveGatewayMode("sandbox", { AUTHORIZE_NET_ENV: "production" }), "sandbox");
  assert.equal(effectiveGatewayMode(undefined, { AUTHORIZE_NET_ENV: "production" }), "production");
  assert.equal(effectiveGatewayMode(undefined, {}), "sandbox");
});

test("testModeError: refuses production under staging, validates otherwise", () => {
  assert.match(testModeError("production", { APP_ENV: "staging" }), /not allowed in staging/);
  assert.equal(testModeError("sandbox", { APP_ENV: "staging" }), null);
  assert.equal(testModeError("production", {}), null);
  assert.match(testModeError("bogus", {}), /must be/);
});

test("both payment test routes use testModeError", () => {
  const src = readFileSync(new URL("../routes/payment.routes.js", import.meta.url), "utf8");
  assert.equal(src.match(/testModeError\(mode, env\)/g).length, 2);
});
