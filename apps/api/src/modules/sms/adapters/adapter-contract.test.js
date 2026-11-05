import { test } from "vitest";
import assert from "node:assert/strict";
import { createSmsAdapters, SMS_PROVIDER_IDS } from "../sms-registry.js";
import { smsConfig } from "../sms-config.js";

// THE contract: every registered provider exports the same interface, so adding
// one means writing one adapter. Nothing here reaches a provider.
const noNetwork = async () => { throw new Error("tests never reach a provider"); };
const config = smsConfig({ SMS_PROVIDER: "log" });

for (const id of SMS_PROVIDER_IDS) {
  test(`${id}: exports the sms adapter interface and send resolves { ok }`, async () => {
    const a = createSmsAdapters({ config, fetchImpl: noNetwork }).get(id);
    assert.equal(a.id, id);
    assert.equal(typeof a.label, "string");
    assert.equal(typeof a.configured, "function");
    assert.equal(typeof a.send, "function");
    assert.equal(typeof a.configured().ok, "boolean");
    const r = await a.send({ to: "+15551234567", body: "hello" });
    assert.equal(typeof r.ok, "boolean");
  });
}
