import { test } from "vitest";
import assert from "node:assert/strict";
import { parseFedexRates, parseFedexLabel, parseFedexCancel, parseFedexTrack, parseFedexError } from "./fedex-responses.js";
import { fixture } from "../../../test/carrier-config.js";

test("rates: the account rate when present, list otherwise; cents; tidy names; an arrival date", () => {
  const [ground, twoDay] = parseFedexRates(fixture("fedex", "rate"));
  assert.deepEqual(ground, { carrier: "fedex", serviceCode: "FEDEX_GROUND", serviceName: "FedEx Ground", amountCents: 1238, estimatedDelivery: "by 10/23/2026" });
  assert.equal(twoDay.amountCents, 3107);
  assert.deepEqual(parseFedexRates({}), []);
});

test("label: tracking number, the PNG, the account charge in cents", () => {
  assert.deepEqual(parseFedexLabel(fixture("fedex", "ship"), { serviceCode: "FEDEX_GROUND", labelFormat: "image" }), {
    trackingNumber: "794644790138", carrierShipmentId: "794644790138", labelFormat: "png",
    labelData: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    chargeCents: 1238, currency: "USD", serviceCode: "FEDEX_GROUND", serviceName: "FedEx Ground",
  });
  assert.equal(parseFedexLabel({ output: {} }, { serviceCode: "FEDEX_GROUND" }), null);
});

test("label: an unreadable or missing charge is null, never 0", () => {
  const noRating = structuredClone(fixture("fedex", "ship"));
  delete noRating.output.transactionShipments[0].completedShipmentDetail;
  assert.equal(parseFedexLabel(noRating, { serviceCode: "FEDEX_GROUND" }).chargeCents, null);
  const garbled = structuredClone(fixture("fedex", "ship"));
  garbled.output.transactionShipments[0].completedShipmentDetail.shipmentRating.shipmentRateDetails = [{ rateType: "PAYOR_ACCOUNT_PACKAGE", totalNetCharge: "n/a" }];
  assert.equal(parseFedexLabel(garbled, { serviceCode: "FEDEX_GROUND" }).chargeCents, null);
});

test("label: a list-only rating is not our cost, so the charge is null (rates may still fall back to list)", () => {
  const listOnly = structuredClone(fixture("fedex", "ship"));
  listOnly.output.transactionShipments[0].completedShipmentDetail.shipmentRating.shipmentRateDetails = [{ rateType: "LIST", totalNetCharge: 20.5 }];
  assert.equal(parseFedexLabel(listOnly, { serviceCode: "FEDEX_GROUND" }).chargeCents, null);
});

test("cancel: confirmed or FedEx's reason", () => {
  assert.deepEqual(parseFedexCancel(fixture("fedex", "cancel")), { ok: true });
  assert.deepEqual(parseFedexCancel({ output: { cancelledShipment: false, message: "Already tendered" } }), { ok: false, reason: "Already tendered" });
});

test("track: one result per number; a per-number error stays with its number; delivered carries the delivery time", () => {
  const [moving, delivered, missing] = parseFedexTrack(fixture("fedex", "track"));
  assert.equal(moving.status, "in_transit");
  assert.equal(moving.location, "SAN ANTONIO, TX");
  assert.equal(moving.occurredAt.toISOString(), "2026-10-21T08:12:00.000Z", "newest scan, whatever the order");
  assert.equal(moving.deliveredAt, null);
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.deliveredAt.toISOString(), "2026-10-22T19:21:00.000Z");
  assert.equal(missing.status, null);
  assert.equal(missing.error.code, "TRACKING.TRACKINGNUMBER.NOTFOUND");
});

test("errors", () => {
  assert.deepEqual(parseFedexError(fixture("fedex", "error")), { code: "SERVICE.PACKAGECOMBINATION.INVALID", message: "Invalid service and packaging combination." });
});
