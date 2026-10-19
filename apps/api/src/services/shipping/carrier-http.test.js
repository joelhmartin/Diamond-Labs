import { test } from "vitest";
import assert from "node:assert/strict";
import { carrierRequest } from "./carrier-http.js";
import { CarrierError, shippingErrorReply, ShippingError } from "./shipping-errors.js";
import { fakeFetch, timeoutError } from "../../test/carrier-config.js";

const parseError = (b) => ({ code: b?.err?.code, message: b?.err?.message });
const call = (fetchImpl, extra = {}) =>
  carrierRequest({ carrier: "ups", fetchImpl, url: "https://ups.test/x", json: { a: 1 }, timeoutMs: 30_000, parseError, ...extra });

test("JSON goes out with its content type and a timeout signal; JSON comes back parsed", async () => {
  const f = fakeFetch([{ status: 200, body: { ok: 1 } }]);
  assert.deepEqual(await call(f), { ok: 1 });
  assert.equal(f.calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(f.calls[0].body, '{"a":1}');
  assert.ok(f.calls[0].init.signal, "every carrier call is bounded by a timeout");
});

test("a form body is url-encoded (OAuth token calls)", async () => {
  const f = fakeFetch([{ status: 200, body: { access_token: "t" } }]);
  await carrierRequest({ carrier: "fedex", fetchImpl: f, url: "u", form: { grant_type: "client_credentials", client_id: "k" }, timeoutMs: 1000, parseError });
  assert.equal(f.calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(f.calls[0].body, "grant_type=client_credentials&client_id=k");
});

test("a 4xx is a definite refusal carrying the carrier's own code and words", async () => {
  const f = fakeFetch([{ status: 400, body: { err: { code: "120802", message: "Address Validation Error on ShipTo address" } } }]);
  await assert.rejects(call(f, { purchase: true }), (e) =>
    e instanceof CarrierError && e.code === "120802" && e.httpStatus === 400 && e.uncertain === false && /ShipTo/.test(e.message));
});

test("a purchase that times out, can't connect, gets a 5xx or an unreadable 2xx is UNCERTAIN", async () => {
  for (const answer of [timeoutError(), new TypeError("fetch failed"), { status: 503, body: "busy" }, { status: 200, body: "<html>" }]) {
    await assert.rejects(call(fakeFetch([answer]), { purchase: true }), (e) => e instanceof CarrierError && e.uncertain === true, String(answer.status ?? answer.name));
  }
});

test("the same failures outside a purchase are ordinary errors", async () => {
  for (const answer of [timeoutError(), { status: 503, body: "busy" }]) {
    await assert.rejects(call(fakeFetch([answer])), (e) => e instanceof CarrierError && e.uncertain === false);
  }
});

test("a timeout says so in words staff understand", async () => {
  await assert.rejects(call(fakeFetch([timeoutError()])), (e) => e.code === "TIMEOUT" && e.timedOut && /UPS did not answer within 30s/.test(e.message));
});

test("replies: a carrier error is a 502 with the carrier's words; an uncertain purchase is a 504", () => {
  const carrier = shippingErrorReply(new CarrierError("fedex", "SERVICE.UNAVAILABLE", "Try later."));
  assert.equal(carrier.status, 502);
  assert.equal(carrier.body.error.message, "FedEx: Try later.");
  assert.deepEqual(carrier.body.error.carrier, { carrier: "fedex", code: "SERVICE.UNAVAILABLE", message: "Try later." });
  assert.equal(shippingErrorReply(new ShippingError("PURCHASE_UNCERTAIN", "x")).status, 504);
  assert.equal(shippingErrorReply(new ShippingError("PURCHASE_UNCERTAIN", "x", { reference: "Order 1" })).body.error.reference, "Order 1");
  assert.equal(shippingErrorReply(new ShippingError("NOT_SHIPPABLE", "x", { problems: ["a", "b"] })).body.error.problems.length, 2);
  assert.equal(shippingErrorReply(new Error("boom")), null);
});
