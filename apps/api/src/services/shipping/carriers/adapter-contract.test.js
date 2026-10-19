import { test } from "vitest";
import assert from "node:assert/strict";
import { createRegistry, CARRIER_IDS, LABEL_RESULT_KEYS } from "../carrier-registry.js";
import { createTokenCache } from "../oauth-token-cache.js";
import { testCarrierConfig } from "../../../test/carrier-config.js";

// THE contract: every registered adapter exports the same interface, so adding
// a carrier means writing one adapter. Nothing here reaches a carrier.
const noNetwork = async () => { throw new Error("tests never reach a carrier"); };
const build = (over) => createRegistry({ config: testCarrierConfig(over), fetchImpl: noNetwork, tokenCache: createTokenCache() });

for (const id of CARRIER_IDS) {
  test(`${id}: exports the carrier adapter interface`, () => {
    const a = build().get(id);
    assert.equal(a.id, id);
    assert.equal(typeof a.label, "string");
    assert.equal(typeof a.tracks, "boolean");
    for (const fn of ["configured", "rate", "createLabel", "voidLabel", "track"]) assert.equal(typeof a[fn], "function", fn);
    const c = a.configured();
    assert.equal(c.ok, true, "fully configured in the test config");
  });

  test(`${id}: with no ship-from only manual stays enabled, and a disabled carrier says why`, () => {
    const c = build({ shipFrom: null, shipFromMissing: ["LAB_ADDRESS_LINE1"] }).get(id).configured();
    assert.equal(c.ok, id === "manual");
    if (!c.ok) assert.equal(typeof c.reason, "string");
  });
}

test("manual: createLabel returns the shape every adapter returns, built from what staff typed", async () => {
  const label = await build().get("manual").createLabel({ manual: { carrierName: " Lone Star Courier ", trackingNumber: " LS-1234567 " } });
  assert.deepEqual(Object.keys(label).sort(), [...LABEL_RESULT_KEYS].sort());
  assert.deepEqual(label, {
    trackingNumber: "LS-1234567", carrierShipmentId: null, labelFormat: null, labelData: null,
    chargeCents: 0, currency: "USD", serviceCode: "manual", serviceName: "Lone Star Courier",
  });
});

test("manual: no carrier name is refused; no tracking number is fine (a hand delivery)", async () => {
  const manual = build().get("manual");
  await assert.rejects(manual.createLabel({ manual: { carrierName: "  " } }), /carrier's name/);
  assert.equal((await manual.createLabel({ manual: { carrierName: "Hand delivery" } })).trackingNumber, null);
  assert.deepEqual(await manual.rate(), []);
  assert.deepEqual(await manual.track(["x"]), []);
  assert.deepEqual(await manual.voidLabel({}), { ok: true });
});

test("UPS, FedEx and manual are all registered", () => {
  assert.deepEqual([...CARRIER_IDS].sort(), ["fedex", "manual", "ups"]);
});
