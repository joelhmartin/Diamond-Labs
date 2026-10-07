import { test } from "vitest";
import assert from "node:assert/strict";
import { acceptJsUrl, isStagingBuild } from "./app-env.js";

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
