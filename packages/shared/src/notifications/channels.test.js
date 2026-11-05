import { test } from "vitest";
import assert from "node:assert/strict";
import { CHANNELS, PREFERENCE_CHANNELS, RECIPIENT_CHANNELS, DELIVERY_STATUSES } from "../index.js";

test("channel lists are exported from the shared index and are subsets of CHANNELS", () => {
  assert.deepEqual(CHANNELS, ["in_app", "email", "sms"]);
  for (const c of [...PREFERENCE_CHANNELS, ...RECIPIENT_CHANNELS]) assert.ok(CHANNELS.includes(c));
  assert.deepEqual(DELIVERY_STATUSES, ["sent", "failed", "skipped", "suppressed"]);
});
