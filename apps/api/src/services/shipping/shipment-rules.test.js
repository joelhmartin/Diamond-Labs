import { test } from "vitest";
import assert from "node:assert/strict";
import { planNewShipment, assertVoidable, planVoided, planTrackingUpdate } from "./shipment-rules.js";
import { ShippingError } from "./shipping-errors.js";
import { TEST_LABEL } from "../../test/carrier-config.js";

const now = new Date("2026-10-20T16:00:00Z");
const parcel = { preset: "small_box", weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const shipTo = { name: "Dr. Ada", address1: "1 St", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const base = { id: "sh1", status: "label_created", shippedAt: null };
const isRefused = (e) => e instanceof ShippingError && e.code === "VOID_REFUSED";

test("a bought label becomes a label_created shipment and its first event", () => {
  const { shipment, event } = planNewShipment({ id: "sh1", label: { ...TEST_LABEL, carrier: "ups" }, parcel, shipTo, shipFrom: null, createdByUserId: "u1", now });
  assert.equal(shipment.status, "label_created");
  assert.equal(shipment.carrier, "ups");
  assert.equal(shipment.chargeCents, 1142);
  assert.equal(shipment.trackingNumber, "1Z999AA10123456784");
  assert.equal(shipment.purchasedAt, now);
  assert.deepEqual(event, { shipmentId: "sh1", status: "label_created", description: "Label created", location: null, occurredAt: now, source: "carrier" });
});

test("a manual shipment's first event is the staff's", () => {
  const { event } = planNewShipment({ id: "sh2", label: { trackingNumber: null, serviceName: "Courier", serviceCode: "manual", chargeCents: 0, carrier: "manual" }, parcel, shipTo, now });
  assert.equal(event.source, "staff");
  assert.equal(event.description, "Recorded by staff");
});

test("void: only an unused label; a voided or departed one is refused with a reason", () => {
  assert.doesNotThrow(() => assertVoidable(base));
  assert.throws(() => assertVoidable({ ...base, status: "voided" }), isRefused);
  assert.throws(() => assertVoidable({ ...base, status: "in_transit" }), isRefused);
  assert.throws(() => assertVoidable({ ...base, shippedAt: now }), isRefused);
  const { patch, event } = planVoided(base, { now });
  assert.deepEqual(patch, { status: "voided", voidedAt: now, updatedAt: now });
  assert.equal(event.source, "staff");
});

test("tracking: a new status writes one event; the first movement asks for the orders to ship", () => {
  const plan = planTrackingUpdate(base, { status: "in_transit", description: "Pickup Scan", location: "SAN ANTONIO, TX", occurredAt: now }, now);
  assert.equal(plan.patch.status, "in_transit");
  assert.equal(plan.patch.trackingError, null);
  assert.deepEqual(plan.event, { shipmentId: "sh1", status: "in_transit", description: "Pickup Scan", location: "SAN ANTONIO, TX", occurredAt: now, source: "carrier" });
  assert.equal(plan.moved, true);
});

test("tracking: delivered stamps deliveredAt from the carrier", () => {
  const at = new Date("2026-10-22T19:21:00Z");
  const plan = planTrackingUpdate({ ...base, status: "in_transit", shippedAt: now }, { status: "delivered", deliveredAt: at, occurredAt: at }, now);
  assert.equal(plan.patch.deliveredAt, at);
  assert.equal(plan.moved, false, "already shipped");
});

test("tracking: a terminal shipment never changes (a stale 'in transit' after 'delivered' is ignored)", () => {
  for (const status of ["delivered", "returned", "voided"]) {
    assert.deepEqual(planTrackingUpdate({ ...base, status }, { status: "in_transit" }, now), { patch: null, event: null, moved: false, unknownCode: null });
  }
});

test("tracking: an unknown carrier code changes nothing but lastTrackedAt, and reports the code", () => {
  const plan = planTrackingUpdate(base, { status: null, carrierCode: "ZZ" }, now);
  assert.deepEqual(plan.patch, { lastTrackedAt: now, trackingError: null, updatedAt: now });
  assert.equal(plan.event, null);
  assert.equal(plan.unknownCode, "ZZ");
});

test("tracking: a carrier error (or no answer) is stored for staff and retried next run", () => {
  const err = planTrackingUpdate(base, { error: { carrier: "ups", code: "151044", message: "No tracking information available" } }, now);
  assert.deepEqual(err.patch, { lastTrackedAt: now, trackingError: "No tracking information available", updatedAt: now });
  assert.equal(planTrackingUpdate(base, undefined, now).patch.trackingError, "No tracking result returned.");
});

test("tracking: a moving shipment whose orders never shipped is healed on the next run", () => {
  const plan = planTrackingUpdate({ ...base, status: "in_transit", shippedAt: null }, { status: "in_transit" }, now);
  assert.equal(plan.event, null, "no duplicate event");
  assert.equal(plan.moved, true);
});

test("tracking: an exception is not movement, and a carrier can never void our shipment", () => {
  assert.equal(planTrackingUpdate(base, { status: "exception" }, now).moved, false);
  assert.equal(planTrackingUpdate(base, { status: "voided" }, now).event, null);
});
