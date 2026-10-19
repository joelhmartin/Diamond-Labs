import { test } from "vitest";
import assert from "node:assert/strict";
import { createFedexAdapter } from "./fedex.adapter.js";
import { FEDEX_CANCEL_METHOD } from "./fedex-requests.js";
import { createTokenCache } from "../oauth-token-cache.js";
import { CarrierError } from "../shipping-errors.js";
import { testCarrierConfig, TEST_SHIP_FROM, fakeFetch, fixture } from "../../../test/carrier-config.js";

const TOKEN = { status: 200, body: { access_token: "fx-tok", expires_in: 3599 } };
const shipTo = { name: "Dr. Ada", address1: "1 St", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const parcel = { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const make = (answers, over) => {
  const fetchImpl = fakeFetch(answers);
  return { fetchImpl, fedex: createFedexAdapter({ config: testCarrierConfig(over), fetchImpl, tokenCache: createTokenCache() }) };
};

test("the token call sends the API key and secret as a form; API calls are Bearer", async () => {
  const { fedex, fetchImpl } = make([TOKEN, { status: 200, body: fixture("fedex", "rate") }]);
  await fedex.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel });
  assert.equal(fetchImpl.calls[0].url, "https://fedex.test/oauth/token");
  assert.equal(fetchImpl.calls[0].body, "grant_type=client_credentials&client_id=fx-test-key&client_secret=fx-test-secret");
  assert.equal(fetchImpl.calls[1].url, "https://fedex.test/rate/v1/rates/quotes");
  assert.equal(fetchImpl.calls[1].init.headers.Authorization, "Bearer fx-tok");
});

test("a purchase answered with a 5xx is uncertain; a 4xx is a definite refusal", async () => {
  const fivexx = make([TOKEN, { status: 503, body: {} }]);
  await assert.rejects(fivexx.fedex.createLabel({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 1" }), (e) => e.uncertain === true);
  const fourxx = make([TOKEN, { status: 422, body: fixture("fedex", "error") }]);
  await assert.rejects(fourxx.fedex.createLabel({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 1" }),
    (e) => e instanceof CarrierError && e.uncertain === false && e.code === "SERVICE.PACKAGECOMBINATION.INVALID");
});

test("a label FedEx accepted but we can't read is uncertain (it may exist)", async () => {
  const { fedex } = make([TOKEN, { status: 200, body: { output: {} } }]);
  await assert.rejects(fedex.createLabel({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 1" }), (e) => e.uncertain === true);
});

test("a 401 on an API call drops the cached token, so the next call signs in again", async () => {
  const { fedex, fetchImpl } = make([TOKEN, { status: 401, body: {} }, TOKEN, { status: 200, body: fixture("fedex", "rate") }]);
  await assert.rejects(fedex.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel }));
  await fedex.rate({ shipFrom: TEST_SHIP_FROM, shipTo, parcel });
  assert.equal(fetchImpl.calls.filter((c) => c.url.endsWith("/oauth/token")).length, 2);
});

test("void cancels by tracking number with the configured (sandbox-verified) method", async () => {
  const { fedex, fetchImpl } = make([TOKEN, { status: 200, body: fixture("fedex", "cancel") }]);
  assert.deepEqual(await fedex.voidLabel({ trackingNumber: "794644790138", carrierShipmentId: "794644790138" }), { ok: true });
  assert.equal(fetchImpl.calls[1].init.method, FEDEX_CANCEL_METHOD);
});

test("void never throws a carrier error: it reports FedEx's reason", async () => {
  const { fedex } = make([TOKEN, { status: 400, body: { errors: [{ code: "SHIPMENT.TENDERED", message: "Shipment already tendered" }] } }]);
  assert.deepEqual(await fedex.voidLabel({ trackingNumber: "1" }), { ok: false, reason: "Shipment already tendered" });
});

test("void treats FedEx's already-cancelled answer as success", async () => {
  const byMessage = make([TOKEN, { status: 400, body: { errors: [{ code: "SHIPMENT.ALREADY.CANCELLED", message: "Shipment has already been cancelled" }] } }]);
  assert.deepEqual(await byMessage.fedex.voidLabel({ trackingNumber: "1" }), { ok: true });
  const byCode = make([TOKEN, { status: 400, body: { errors: [{ code: "SHIPMENT.ALREADY.CANCELLED", message: "Cannot process" }] } }]);
  assert.deepEqual(await byCode.fedex.voidLabel({ trackingNumber: "1" }), { ok: true });
  const ok200 = make([TOKEN, { status: 200, body: { output: { cancelledShipment: false, message: "Shipment already cancelled" } } }]);
  assert.deepEqual(await ok200.fedex.voidLabel({ trackingNumber: "1" }), { ok: true });
});

test("track: batches of 30; a failed batch marks only its own numbers", async () => {
  const numbers = Array.from({ length: 31 }, (_, i) => `79464479${String(i).padStart(4, "0")}`);
  const last = { trackingNumber: numbers[30], trackResults: [{ latestStatusDetail: { code: "IT", description: "In transit" }, scanEvents: [] }] };
  const { fedex, fetchImpl } = make([TOKEN, { status: 500, body: {} }, { status: 200, body: { output: { completeTrackResults: [last] } } }]);
  const out = await fedex.track(numbers);
  assert.equal(fetchImpl.calls.length, 3, "token + two batches");
  assert.equal(JSON.parse(fetchImpl.calls[1].body).trackingInfo.length, 30);
  assert.equal(JSON.parse(fetchImpl.calls[2].body).trackingInfo.length, 1);
  assert.equal(out.length, 31);
  assert.equal(out.filter((r) => r.error).length, 30, "only the failed batch's numbers carry the error");
  assert.equal(out[30].status, "in_transit");
});

test("track: a number FedEx leaves out of its answer still gets a result (with a reason)", async () => {
  const { fedex } = make([TOKEN, { status: 200, body: { output: { completeTrackResults: [] } } }]);
  const [r] = await fedex.track(["794644790138"]);
  assert.equal(r.status, null);
  assert.equal(r.error.code, "NO_RESULT");
});

test("configured: names the missing FedEx variables", () => {
  const { fedex } = make([], { fedex: { ...testCarrierConfig().fedex, apiKey: "", secretKey: "" } });
  assert.deepEqual(fedex.configured(), { ok: false, reason: "FedEx: credentials not set (FEDEX_API_KEY, FEDEX_SECRET_KEY)" });
});
