import { test } from "vitest";
import assert from "node:assert/strict";
import { smokeRefusal } from "./smoke-guard.js";
import { smsConfig } from "./sms-config.js";

const TEST = { SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+15005550006" };

test("--live is never refused", () => {
  assert.equal(smokeRefusal(smsConfig({ ...TEST, TWILIO_FROM: "+15551230000" }), { live: true }), null);
});

test("twilio test number without a messaging service is allowed", () => {
  assert.equal(smokeRefusal(smsConfig(TEST), { live: false }), null);
});

test("a messaging service SID defeats the test number and is refused", () => {
  assert.match(smokeRefusal(smsConfig({ ...TEST, TWILIO_MESSAGING_SERVICE_SID: "MG1" }), { live: false }), /Refusing/);
});

test("a real From number is refused without --live", () => {
  assert.match(smokeRefusal(smsConfig({ ...TEST, TWILIO_FROM: "+15551230000" }), { live: false }), /Refusing/);
});

test("the log provider is allowed", () => {
  assert.equal(smokeRefusal(smsConfig({ SMS_PROVIDER: "log" }), { live: false }), null);
});
