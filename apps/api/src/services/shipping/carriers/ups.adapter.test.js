import { test } from "vitest";
import assert from "node:assert/strict";
import { createUpsAdapter } from "./ups.adapter.js";
import { createTokenCache } from "../oauth-token-cache.js";
import { CarrierError } from "../shipping-errors.js";
import { testCarrierConfig, TEST_SHIP_FROM, fakeFetch, timeoutError, fixture } from "../../../test/carrier-config.js";

const TOKEN = { status: 200, body: { access_token: "tok", expires_in: "3600" } };
const shipTo = { name: "Dr. Ada", address1: "1 St", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const parcel = { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const make = (answers, over) => {
  const fetchImpl = fakeFetch(answers);
  return { fetchImpl, ups: createUpsAdapter({ config: testCarrierConfig(over), fetchImpl, tokenCache: createTokenCache() }) };
};

test("one token serves many calls; the token call is Basic-authenticated, API calls are Bearer", async () => {
  const { ups, fetchImpl } = make([TOKEN, { status: 200, body: fixture("ups", "rate") }, { status: 200, body: fixture("ups", "rate") }]);
  await ups.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel });
  await ups.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel });
  assert.equal(fetchImpl.calls.length, 3, "one token call, two rate calls");
  const [tokenCall, rateCall] = fetchImpl.calls;
  assert.equal(tokenCall.url, "https://ups.test/security/v1/oauth/token");
  assert.equal(tokenCall.init.headers.Authorization, `Basic ${Buffer.from("ups-test-id:ups-test-secret").toString("base64")}`);
  assert.equal(tokenCall.body, "grant_type=client_credentials");
  assert.equal(rateCall.init.headers.Authorization, "Bearer tok");
  assert.ok(rateCall.init.headers.transId.length <= 32);
});

test("a purchase that times out is uncertain; a token failure before it is not", async () => {
  const timedOut = make([TOKEN, timeoutError()]);
  await assert.rejects(
    timedOut.ups.createLabel({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 1" }),
    (e) => e instanceof CarrierError && e.uncertain === true,
  );
  const badCreds = make([{ status: 401, body: { response: { errors: [{ code: "250003", message: "Invalid Access License number" }] } } }]);
  await assert.rejects(
    badCreds.ups.createLabel({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 1" }),
    (e) => e instanceof CarrierError && e.uncertain === false && e.code === "250003",
  );
});

test("a label UPS accepted but we can't read is uncertain (it may exist)", async () => {
  const { ups } = make([TOKEN, { status: 200, body: { ShipmentResponse: {} } }]);
  await assert.rejects(ups.createLabel({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 1" }), (e) => e.uncertain === true);
});

test("a 401 on an API call drops the cached token, so the next call signs in again", async () => {
  const { ups, fetchImpl } = make([TOKEN, { status: 401, body: {} }, TOKEN, { status: 200, body: fixture("ups", "rate") }]);
  await assert.rejects(ups.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel }));
  await ups.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel });
  assert.equal(fetchImpl.calls.filter((c) => c.url.endsWith("/oauth/token")).length, 2);
});

test("void never throws a carrier error: it reports ok or UPS's reason", async () => {
  const ok = make([TOKEN, { status: 200, body: fixture("ups", "void") }]);
  assert.deepEqual(await ok.ups.voidLabel({ carrierShipmentId: "1Z999AA10123456784" }), { ok: true });
  assert.equal(ok.fetchImpl.calls[1].init.method, "DELETE");
  const refused = make([TOKEN, { status: 400, body: { response: { errors: [{ code: "190117", message: "Shipment already picked up" }] } } }]);
  assert.deepEqual(await refused.ups.voidLabel({ carrierShipmentId: "1Z1" }), { ok: false, reason: "Shipment already picked up" });
});

test("track: one number per request; one failing number doesn't hide the others", async () => {
  const { ups } = make([TOKEN, { status: 200, body: fixture("ups", "track") }, { status: 404, body: { response: { errors: [{ code: "151044", message: "No tracking information available" }] } } }]);
  const out = await ups.track(["1Z999AA10123456784", "1ZNOPE"]);
  assert.equal(out[0].status, "delivered");
  assert.deepEqual(out[1].error, { carrier: "ups", code: "151044", message: "No tracking information available" });
  assert.equal(out[1].status, null);
});

test("configured: names the missing UPS variable, never a value", () => {
  const { ups } = make([], { ups: { ...testCarrierConfig().ups, accountNumber: "" } });
  assert.deepEqual(ups.configured(), { ok: false, reason: "UPS: credentials not set (UPS_ACCOUNT_NUMBER)" });
});
