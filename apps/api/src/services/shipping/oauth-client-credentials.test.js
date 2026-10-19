import { test } from "vitest";
import assert from "node:assert/strict";
import { requestClientCredentialsToken } from "./oauth-client-credentials.js";
import { CarrierError } from "./shipping-errors.js";
import { fakeFetch } from "../../test/carrier-config.js";

const base = { url: "https://c.test/token", clientId: "the-id", clientSecret: "the-secret" };

test("basic style (UPS): id:secret in the Authorization header, only grant_type in the body", async () => {
  const f = fakeFetch([{ status: 200, body: { access_token: "T1", expires_in: "14399" } }]);
  const out = await requestClientCredentialsToken({ carrier: "ups", fetchImpl: f, authStyle: "basic", headers: { "x-merchant-id": "A1" }, ...base });
  assert.deepEqual(out, { accessToken: "T1", expiresInSec: 14399 });
  const { init, body } = f.calls[0];
  assert.equal(init.headers.Authorization, `Basic ${Buffer.from("the-id:the-secret").toString("base64")}`);
  assert.equal(init.headers["x-merchant-id"], "A1");
  assert.equal(body, "grant_type=client_credentials");
  assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
});

test("body style (FedEx): id and secret in the form body, no Authorization header", async () => {
  const f = fakeFetch([{ status: 200, body: { access_token: "T2", expires_in: 3600 } }]);
  const out = await requestClientCredentialsToken({ carrier: "fedex", fetchImpl: f, authStyle: "body", ...base });
  assert.deepEqual(out, { accessToken: "T2", expiresInSec: 3600 });
  assert.equal(f.calls[0].body, "grant_type=client_credentials&client_id=the-id&client_secret=the-secret");
  assert.equal(f.calls[0].init.headers.Authorization, undefined);
});

test("a non-2xx is a CarrierError with the carrier's words, and never echoes the secret", async () => {
  const f = fakeFetch([{ status: 401, body: { errors: [{ code: "NOT.AUTHORIZED.ERROR", message: "Invalid client." }] } }]);
  await assert.rejects(
    requestClientCredentialsToken({ carrier: "fedex", fetchImpl: f, authStyle: "body", ...base }),
    (e) => e instanceof CarrierError && e.code === "NOT.AUTHORIZED.ERROR" && e.httpStatus === 401 && !e.message.includes("the-secret"),
  );
});

test("a 2xx without an access_token is refused", async () => {
  const f = fakeFetch([{ status: 200, body: { expires_in: 3600 } }]);
  await assert.rejects(requestClientCredentialsToken({ carrier: "ups", fetchImpl: f, authStyle: "basic", ...base }), (e) => e instanceof CarrierError && e.code === "BAD_RESPONSE");
});

test("an unknown auth style is a programming error", async () => {
  await assert.rejects(requestClientCredentialsToken({ carrier: "ups", fetchImpl: fakeFetch([]), authStyle: "x", ...base }), TypeError);
});
