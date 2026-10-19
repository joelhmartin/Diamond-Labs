import { test } from "vitest";
import assert from "node:assert/strict";
import { createRegistry, CARRIER_IDS } from "./carrier-registry.js";
import { missingConfigReason } from "./carrier-config.js";
import { ShippingError } from "./shipping-errors.js";
import { testCarrierConfig, TEST_SHIP_FROM } from "../../test/carrier-config.js";

test("a missing credential disables the carrier with a reason naming the variable, never its value", () => {
  const reason = missingConfigReason("UPS", { UPS_CLIENT_ID: "id-123", UPS_CLIENT_SECRET: " ", UPS_ACCOUNT_NUMBER: undefined }, TEST_SHIP_FROM);
  assert.equal(reason, "UPS: credentials not set (UPS_CLIENT_SECRET, UPS_ACCOUNT_NUMBER)");
  assert.doesNotMatch(reason, /id-123/);
});

test("credentials present but no ship-from: disabled until the lab address is configured", () => {
  assert.match(missingConfigReason("FedEx", { FEDEX_API_KEY: "k" }, null), /^FedEx: ship-from address not configured/);
  assert.equal(missingConfigReason("FedEx", { FEDEX_API_KEY: "k" }, TEST_SHIP_FROM), null);
});

test("manual is always registered and always enabled", () => {
  assert.ok(CARRIER_IDS.includes("manual"));
  const r = createRegistry({ config: testCarrierConfig({ shipFrom: null }) });
  assert.ok(r.enabled().some((a) => a.id === "manual"));
  assert.deepEqual(r.status().find((s) => s.id === "manual"), { id: "manual", label: "Manual", tracks: false, ok: true });
});

test("an unknown carrier is refused, not silently ignored", () => {
  const r = createRegistry({ config: testCarrierConfig() });
  assert.throws(() => r.get("dhl"), (e) => e instanceof ShippingError && e.code === "INVALID");
});
