import { test, vi } from "vitest";
import assert from "node:assert/strict";

const cfg = vi.hoisted(() => ({ appEnv: "staging" }));
vi.mock("../config/env.js", () => ({
  env: {
    get APP_ENV() { return cfg.appEnv; },
    AUTHORIZE_NET_ENV: "production",
    AUTHORIZE_NET_API_LOGIN: "live-login",
    AUTHORIZE_NET_TRANSACTION_KEY: "live-key",
    AUTHORIZE_NET_SANDBOX_API_LOGIN: "sb-login",
    AUTHORIZE_NET_SANDBOX_TRANSACTION_KEY: "sb-key",
  },
}));

const svc = await import("./authorizenet.service.js");

test("staging: explicit production mode still resolves to sandbox endpoints and creds", async () => {
  assert.equal(svc.hostedFormUrl("production"), "https://test.authorize.net/payment/payment");
  assert.equal(svc.hostedAddCardUrl("production"), "https://test.authorize.net/customer/addPayment");

  const f = vi.fn(async () => ({ text: async () => JSON.stringify({ messages: { resultCode: "Ok" }, transaction: {} }) }));
  vi.stubGlobal("fetch", f);
  try {
    await svc.getTransactionDetails("123", "production");
  } finally {
    vi.unstubAllGlobals();
  }
  assert.equal(f.mock.calls.length, 1);
  assert.equal(f.mock.calls[0][0], "https://apitest.authorize.net/xml/v1/request.api");
  const body = JSON.parse(f.mock.calls[0][1].body);
  assert.deepEqual(Object.values(body)[0].merchantAuthentication, { name: "sb-login", transactionKey: "sb-key" });
});

test("non-staging: explicit production mode still reaches the live endpoint (unchanged)", () => {
  cfg.appEnv = "production";
  assert.equal(svc.hostedFormUrl("production"), "https://accept.authorize.net/payment/payment");
  cfg.appEnv = "staging";
});
