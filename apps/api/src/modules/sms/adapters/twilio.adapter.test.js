import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTwilioAdapter } from "./twilio.adapter.js";

const fixture = (n) => JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), "utf8"));
const TWILIO = { accountSid: "ACtest123", authToken: "secret-token-xyz", from: "+15005550006", messagingServiceSid: undefined };

function fake(status, body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

test("posts form To/From/Body to /2010-04-01/Accounts/{sid}/Messages.json with Basic auth", async () => {
  const { fetchImpl, calls } = fake(201, fixture("twilio-sent"));
  await createTwilioAdapter({ config: { twilio: TWILIO }, fetchImpl }).send({ to: "+15551234567", body: "hi" });
  const { url, init } = calls[0];
  assert.equal(url, "https://api.twilio.com/2010-04-01/Accounts/ACtest123/Messages.json");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(init.headers.Authorization, `Basic ${Buffer.from("ACtest123:secret-token-xyz").toString("base64")}`);
  const form = new URLSearchParams(init.body);
  assert.equal(form.get("To"), "+15551234567");
  assert.equal(form.get("From"), "+15005550006");
  assert.equal(form.get("Body"), "hi");
  assert.ok(init.signal, "has a timeout signal");
});

test("uses MessagingServiceSid when set instead of From", async () => {
  const { fetchImpl, calls } = fake(201, fixture("twilio-sent"));
  const twilio = { ...TWILIO, messagingServiceSid: "MG999" };
  await createTwilioAdapter({ config: { twilio }, fetchImpl }).send({ to: "+15551234567", body: "hi" });
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get("MessagingServiceSid"), "MG999");
  assert.equal(form.has("From"), false);
});

test("2xx → { ok: true, providerId: sid }", async () => {
  const { fetchImpl } = fake(201, fixture("twilio-sent"));
  const r = await createTwilioAdapter({ config: { twilio: TWILIO }, fetchImpl }).send({ to: "+15551234567", body: "hi" });
  assert.deepEqual(r, { ok: true, providerId: "SM0123456789abcdef0123456789abcdef" });
});

test("4xx → { ok: false, error: \"21211 <message>\" } and never includes the token", async () => {
  const { fetchImpl } = fake(400, fixture("twilio-error-21211"));
  const r = await createTwilioAdapter({ config: { twilio: TWILIO }, fetchImpl }).send({ to: "+15550000", body: "hi" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "21211 The 'To' number +15550000 is not a valid phone number.");
  assert.ok(!JSON.stringify(r).includes("secret-token-xyz"));
});

test("a network failure resolves { ok:false } without the token", async () => {
  const fetchImpl = async () => { throw new Error("socket hang up"); };
  const r = await createTwilioAdapter({ config: { twilio: TWILIO }, fetchImpl }).send({ to: "+15551234567", body: "hi" });
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes("secret-token-xyz"));
});

test("configured() names unset TWILIO_* variables, never values", () => {
  const none = createTwilioAdapter({ config: { twilio: {} } }).configured();
  assert.equal(none.ok, false);
  for (const v of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"]) assert.match(none.reason, new RegExp(v));
  const partial = createTwilioAdapter({ config: { twilio: { accountSid: "ACsecretsid", authToken: "tok", from: "" } } }).configured();
  assert.match(partial.reason, /TWILIO_FROM/);
  assert.ok(!partial.reason.includes("ACsecretsid"));
  assert.equal(createTwilioAdapter({ config: { twilio: TWILIO } }).configured().ok, true);
  const svc = { accountSid: "AC", authToken: "t", messagingServiceSid: "MG1" };
  assert.equal(createTwilioAdapter({ config: { twilio: svc } }).configured().ok, true, "service sid replaces From");
});
