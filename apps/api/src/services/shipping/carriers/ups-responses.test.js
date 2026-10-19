import { test } from "vitest";
import assert from "node:assert/strict";
import { parseUpsRates, parseUpsLabel, parseUpsVoid, parseUpsTrack, parseUpsError } from "./ups-responses.js";
import { fixture } from "../../../test/carrier-config.js";

test("rates: negotiated price when present, published otherwise, dollars → cents once", () => {
  const quotes = parseUpsRates(fixture("ups", "rate"));
  assert.deepEqual(quotes[0], { carrier: "ups", serviceCode: "03", serviceName: "UPS Ground", amountCents: 1142, estimatedDelivery: "3 business days" });
  assert.equal(quotes[1].amountCents, 3210);
  assert.equal(quotes[2].estimatedDelivery, "1 business day");
});

test("rates: one rated service arrives as an object, not an array", () => {
  const one = { RateResponse: { RatedShipment: { Service: { Code: "03" }, TotalCharges: { MonetaryValue: "9.99" } } } };
  assert.equal(parseUpsRates(one).length, 1);
  assert.deepEqual(parseUpsRates({}), []);
});

test("label: tracking number, void id, the GIF, the negotiated charge in cents", () => {
  const label = parseUpsLabel(fixture("ups", "ship"), { serviceCode: "03", labelFormat: "image" });
  assert.deepEqual(label, {
    trackingNumber: "1Z999AA10123456784", carrierShipmentId: "1Z999AA10123456784", labelFormat: "gif",
    labelData: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", chargeCents: 1142, currency: "USD",
    serviceCode: "03", serviceName: "UPS Ground",
  });
  assert.equal(parseUpsLabel(fixture("ups", "ship"), { serviceCode: "03", labelFormat: "zpl" }).labelFormat, "zpl");
  assert.equal(parseUpsLabel({ ShipmentResponse: {} }, { serviceCode: "03" }), null, "an unreadable success is null (the adapter calls it uncertain)");
});

test("void: success code 1; anything else carries UPS's words", () => {
  assert.deepEqual(parseUpsVoid(fixture("ups", "void")), { ok: true });
  assert.deepEqual(parseUpsVoid({ VoidShipmentResponse: { Response: { ResponseStatus: { Code: "0", Description: "Failed" } } } }), { ok: false, reason: "Failed" });
});

test("track: the newest scan wins whatever order UPS sends; delivered stamps the delivery time", () => {
  const t = parseUpsTrack(fixture("ups", "track"), "1Z999AA10123456784");
  assert.equal(t.status, "delivered");
  assert.equal(t.carrierCode, "D");
  assert.equal(t.description, "DELIVERED");
  assert.equal(t.location, "AUSTIN, TX");
  assert.equal(t.occurredAt.toISOString(), "2026-10-22T14:21:00.000Z");
  assert.equal(t.deliveredAt.toISOString(), "2026-10-22T14:21:00.000Z");
  assert.deepEqual(t.events.map((e) => e.status), ["delivered", "out_for_delivery", "in_transit", "label_created"]);
});

test("track: no package in the answer is an empty result, not a crash", () => {
  assert.deepEqual(parseUpsTrack({}, "1Z1"), {
    trackingNumber: "1Z1", status: null, carrierCode: null, description: null, location: null, occurredAt: null, deliveredAt: null, events: [],
  });
});

test("errors", () => {
  assert.deepEqual(parseUpsError(fixture("ups", "error")), { code: "120802", message: "Address Validation Error on ShipTo address" });
});

test("label: an unreadable or missing charge is null, never 0", () => {
  const body = structuredClone(fixture("ups", "ship"));
  const r = body.ShipmentResponse.ShipmentResults;
  delete r.NegotiatedRateCharges;
  delete r.ShipmentCharges;
  assert.equal(parseUpsLabel(body, { serviceCode: "03" }).chargeCents, null);
  r.ShipmentCharges = { TotalCharges: { CurrencyCode: "USD", MonetaryValue: "n/a" } };
  assert.equal(parseUpsLabel(body, { serviceCode: "03" }).chargeCents, null);
});
