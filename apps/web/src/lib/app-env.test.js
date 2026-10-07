import { test } from "vitest";
import assert from "node:assert/strict";
import { swapAcceptJsUrl, acceptJsUrl, isStagingBuild, assertStagingBuildSafe } from "./app-env.js";

test("Accept.js URL: production is the default and equals the historical URL", () => {
  assert.equal(acceptJsUrl(undefined), "https://js.authorize.net/v1/Accept.js");
  assert.equal(acceptJsUrl(""), "https://js.authorize.net/v1/Accept.js");
  assert.equal(acceptJsUrl("production"), "https://js.authorize.net/v1/Accept.js");
});

test("Accept.js URL: sandbox uses jstest", () => {
  assert.equal(acceptJsUrl("sandbox"), "https://jstest.authorize.net/v1/Accept.js");
});

test("Accept.js URL: an unknown value fails loudly rather than guessing", () => {
  assert.throws(() => acceptJsUrl("sandbx"), /VITE_AUTHORIZE_NET_ENV/);
});

test("isStagingBuild only for the exact string staging", () => {
  assert.equal(isStagingBuild("staging"), true);
  for (const v of [undefined, "", "production", "development", "Staging"]) assert.equal(isStagingBuild(v), false);
});

test("assertStagingBuildSafe: staging build requires sandbox Accept.js", () => {
  assert.doesNotThrow(() => assertStagingBuildSafe("staging", "sandbox"));
  assert.throws(() => assertStagingBuildSafe("staging", "production"), /requires VITE_AUTHORIZE_NET_ENV=sandbox/);
  assert.throws(() => assertStagingBuildSafe("staging", undefined), /requires/);
  assert.throws(() => assertStagingBuildSafe("staging", ""), /requires/);
});

test("assertStagingBuildSafe: non-staging builds are never gated", () => {
  for (const a of [undefined, "", "production", "development"]) {
    assert.doesNotThrow(() => assertStagingBuildSafe(a, undefined));
    assert.doesNotThrow(() => assertStagingBuildSafe(a, "production"));
  }
});

test("swapAcceptJsUrl: production leaves html untouched, sandbox swaps, missing URL throws", () => {
  const html = '<script src="https://js.authorize.net/v1/Accept.js"></script>';
  assert.equal(swapAcceptJsUrl(html, undefined), html);
  assert.equal(swapAcceptJsUrl(html, "production"), html);
  assert.equal(swapAcceptJsUrl("<p>no script</p>", "production"), "<p>no script</p>");
  assert.equal(swapAcceptJsUrl(html, "sandbox"), '<script src="https://jstest.authorize.net/v1/Accept.js"></script>');
  assert.throws(() => swapAcceptJsUrl("<p>no script</p>", "sandbox"), /swap failed/);
  assert.throws(() => swapAcceptJsUrl(html, "bogus"), /must be/);
});
