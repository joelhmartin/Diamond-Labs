import { test } from "vitest";
import assert from "node:assert/strict";
import { SHIPMENT_STATUSES } from "@my-app/shared";
import { normalizeCarrierStatus, UPS_STATUS_TYPES, FEDEX_STATUS_CODES } from "./carrier-status.js";

test("every mapped code lands on a real status", () => {
  for (const s of [...Object.values(UPS_STATUS_TYPES), ...Object.values(FEDEX_STATUS_CODES)]) {
    assert.ok(SHIPMENT_STATUSES.includes(s), s);
  }
});

test("UPS status types → our statuses; 'out for delivery' is recognised from the words", () => {
  assert.equal(normalizeCarrierStatus("ups", "M"), "label_created");
  assert.equal(normalizeCarrierStatus("ups", "P"), "in_transit");
  assert.equal(normalizeCarrierStatus("ups", "I", "Out For Delivery Today"), "out_for_delivery");
  assert.equal(normalizeCarrierStatus("ups", "d"), "delivered");
  assert.equal(normalizeCarrierStatus("ups", "RS"), "returned");
  assert.equal(normalizeCarrierStatus("ups", "X"), "exception");
});

test("an unknown code or carrier is null (the sync keeps the current status and logs the code)", () => {
  assert.equal(normalizeCarrierStatus("ups", "ZZ"), null);
  assert.equal(normalizeCarrierStatus("dhl", "D"), null);
  assert.equal(normalizeCarrierStatus("fedex", null), null);
});
