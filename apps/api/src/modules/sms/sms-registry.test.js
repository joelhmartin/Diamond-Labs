import { test } from "vitest";
import assert from "node:assert/strict";
import { createSmsRegistry } from "./sms-registry.js";
import { smsConfig } from "./sms-config.js";

const TW = { TWILIO_ACCOUNT_SID: "ACx", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15005550006" };
function recorder() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(new URLSearchParams(init.body));
    return { ok: true, status: 201, json: async () => ({ sid: "SM1" }) };
  };
  return { calls, fetchImpl };
}

test("provider off → send returns { ok:false, suppressed:true }", async () => {
  const { calls, fetchImpl } = recorder();
  const reg = createSmsRegistry({ config: smsConfig({ ...TW }), fetchImpl });
  const r = await reg.send({ to: "+15551234567", body: "x" });
  assert.equal(r.ok, false);
  assert.equal(r.suppressed, true);
  assert.equal(r.reason, "unconfigured");
  assert.equal(calls.length, 0);
  assert.equal(reg.status().ok, false);
  assert.equal(reg.status().provider, "off");
});

test("a provider with missing credentials is suppressed and status names the variables", async () => {
  const reg = createSmsRegistry({ config: smsConfig({ SMS_PROVIDER: "twilio" }) });
  assert.equal((await reg.send({ to: "+15551234567", body: "x" })).suppressed, true);
  assert.match(reg.status().reason, /TWILIO_ACCOUNT_SID/);
});

test("sends through the chosen provider outside staging", async () => {
  const { calls, fetchImpl } = recorder();
  const reg = createSmsRegistry({ config: smsConfig({ SMS_PROVIDER: "twilio", ...TW }), fetchImpl });
  assert.deepEqual(await reg.send({ to: "+15551234567", body: "hello" }), { ok: true, providerId: "SM1" });
  assert.equal(calls[0].get("To"), "+15551234567");
  assert.equal(calls[0].get("Body"), "hello");
});

test("staging redirects to STAGING_SMS_TO and suppresses when unset", async () => {
  const { calls, fetchImpl } = recorder();
  const base = { SMS_PROVIDER: "twilio", APP_ENV: "staging", ...TW };
  const redirected = createSmsRegistry({ config: smsConfig({ ...base, STAGING_SMS_TO: "(555) 000-9999" }), fetchImpl });
  assert.equal((await redirected.send({ to: "+15551231234", body: "hello" })).ok, true);
  assert.equal(calls[0].get("To"), "+15550009999");
  assert.equal(calls[0].get("Body"), "[STAGING → •••1234] hello");

  const unset = createSmsRegistry({ config: smsConfig(base), fetchImpl });
  const r = await unset.send({ to: "+15551231234", body: "hello" });
  assert.equal(r.ok, false);
  assert.equal(r.suppressed, true);
  assert.equal(r.reason, "suppressed");
  assert.equal(calls.length, 1, "nothing more was sent");
});

test("staging redirect and suppress apply with the log provider too", async () => {
  const lines = [];
  const orig = console.log;
  console.log = (l) => lines.push(l);
  try {
    const base = { SMS_PROVIDER: "log", APP_ENV: "staging" };
    const r = await createSmsRegistry({ config: smsConfig(base) }).send({ to: "+15551231234", body: "hello" });
    assert.equal(r.suppressed, true);
    assert.equal(lines.length, 0, "log provider was not reached");
    const redirected = createSmsRegistry({ config: smsConfig({ ...base, STAGING_SMS_TO: "(555) 000-9999" }) });
    assert.equal((await redirected.send({ to: "+15551231234", body: "hello" })).ok, true);
    assert.deepEqual(lines, [`[SMS] to=•••9999 len=${"[STAGING → •••1234] hello".length}`]);
  } finally {
    console.log = orig;
  }
});

test("an invalid number is rejected without reaching the provider", async () => {
  const { calls, fetchImpl } = recorder();
  const reg = createSmsRegistry({ config: smsConfig({ SMS_PROVIDER: "twilio", ...TW }), fetchImpl });
  const r = await reg.send({ to: "abc", body: "x" });
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});

test("a throwing adapter resolves { ok:false, error }", async () => {
  const fetchImpl = async () => { throw new Error("boom"); };
  const reg = createSmsRegistry({ config: smsConfig({ SMS_PROVIDER: "twilio", ...TW }), fetchImpl });
  const r = await reg.send({ to: "+15551234567", body: "x" });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, "string");
});
