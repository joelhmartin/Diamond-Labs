import { test, vi } from "vitest";
import assert from "node:assert/strict";

vi.mock("../config/env.js", () => ({
  env: {
    AUTHORIZE_NET_ENV: "sandbox",
    AUTHORIZE_NET_SANDBOX_API_LOGIN: "sb-login",
    AUTHORIZE_NET_SANDBOX_TRANSACTION_KEY: "sb-key",
  },
}));

const svc = await import("./authorizenet.service.js");

test("createCustomerProfile sends description before email: Authorize.net rejects any other order", async () => {
  const f = vi.fn(async () => ({ text: async () => JSON.stringify({ messages: { resultCode: "Ok" }, customerProfileId: "cp1" }) }));
  vi.stubGlobal("fetch", f);
  try {
    assert.equal(await svc.createCustomerProfile({ email: "d@example.com" }), "cp1");
  } finally {
    vi.unstubAllGlobals();
  }
  const { profile } = JSON.parse(f.mock.calls[0][1].body).createCustomerProfileRequest;
  assert.deepEqual(Object.keys(profile), ["description", "email"]);
});
