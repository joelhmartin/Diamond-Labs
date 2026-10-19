import { test } from "vitest";
import assert from "node:assert/strict";
import {
  initialShipForm, applyPreset, weightOzFrom, splitWeight, ratesBody, buyBody, buySignature, quoteKey,
  isUncertainPurchase, uncertainNotice, labelBadge, shipmentLine, labelNeedsRotation, shipmentListParams, filenameFrom,
} from "../shipping.js";
import { createAttemptKey } from "../idempotency.js";

const context = {
  order: { id: "lo1", orderNumber: 100245 },
  shipTo: { name: "Dr. Ada", company: "Smile Dental", phone: null, address1: "1 St", address2: null, city: "Austin", state: "TX", postalCode: "78701", country: "US" },
};

test("the form starts from the server's ship-to (nulls become empty inputs), this order ticked, a small box", () => {
  const f = initialShipForm(context);
  assert.deepEqual(f.orderIds, ["lo1"]);
  assert.equal(f.shipTo.phone, "");
  assert.equal(f.shipTo.company, "Smile Dental");
  assert.deepEqual(f.parcel, { preset: "small_box", weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 });
  assert.equal(f.choice, null);
  assert.equal(initialShipForm({ order: { id: "x" }, shipTo: null }).shipTo.address1, "", "a doctor with no address gets an empty form, not a crash");
});

test("residential travels from the server's ship-to into the request bodies (P8)", () => {
  assert.equal(initialShipForm(context).shipTo.residential, false);
  const shop = initialShipForm({ ...context, shipTo: { ...context.shipTo, residential: true } });
  assert.equal(shop.shipTo.residential, true);
  assert.equal(ratesBody(shop).shipTo.residential, true);
  assert.equal(buyBody({ ...shop, choice: { carrier: "ups", serviceCode: "03" } }).shipTo.residential, true);
});

test("a preset fills dimensions and keeps the weight staff typed; custom keeps everything", () => {
  const p = applyPreset({ preset: "small_box", weightOz: 40, lengthIn: 8, widthIn: 6, heightIn: 4 }, "medium_box");
  assert.deepEqual(p, { preset: "medium_box", weightOz: 40, lengthIn: 12, widthIn: 10, heightIn: 6 });
  assert.deepEqual(applyPreset(p, "custom"), { ...p, preset: "custom" });
});

test("pounds and ounces become whole ounces and back", () => {
  assert.equal(weightOzFrom("2", "8"), 40);
  assert.equal(weightOzFrom("", "0"), 0);
  assert.deepEqual(splitWeight(40), { lb: 2, oz: 8 });
});

test("bodies: blanks become null, the state is uppercased, numbers are numbers", () => {
  const f = { ...initialShipForm(context), shipTo: { ...initialShipForm(context).shipTo, state: "tx", address2: "  " } };
  const r = ratesBody(f);
  assert.equal(r.shipTo.state, "TX");
  assert.equal(r.shipTo.address2, null);
  assert.equal(r.shipTo.phone, null);
  assert.equal(typeof r.parcel.weightOz, "number");
  assert.deepEqual(buyBody({ ...f, choice: { carrier: "ups", serviceCode: "03" } }).serviceCode, "03");
  const manual = buyBody({ ...f, choice: { carrier: "manual" }, manual: { carrierName: " Courier ", trackingNumber: " " } });
  assert.deepEqual([manual.carrier, manual.manual.carrierName, manual.manual.trackingNumber, "serviceCode" in manual], ["manual", "Courier", null, false]);
});

test("the same box, address and service reuse ONE Idempotency-Key; changing any of them is a new attempt", () => {
  const keys = createAttemptKey(((n) => () => `k${++n}`)(0));
  const f = { ...initialShipForm(context), choice: { carrier: "ups", serviceCode: "03" } };
  const first = keys.keyFor(buySignature(buyBody(f)));
  assert.equal(keys.keyFor(buySignature(buyBody(f))), first, "a double click or a retry is the same attempt");
  assert.notEqual(keys.keyFor(buySignature(buyBody({ ...f, choice: { carrier: "ups", serviceCode: "02" } }))), first);
});

test("quotes go stale when anything that was rated changes", () => {
  const f = initialShipForm(context);
  assert.equal(quoteKey(f), quoteKey({ ...f, choice: { carrier: "ups", serviceCode: "03" } }), "choosing a service doesn't re-rate");
  assert.notEqual(quoteKey(f), quoteKey({ ...f, parcel: { ...f.parcel, weightOz: 17 } }));
});

test("an uncertain or still-held purchase is recognised, so the form says 'check first' instead of retrying", () => {
  const err = (code) => ({ response: { data: { error: { code } } } });
  assert.equal(isUncertainPurchase(err("PURCHASE_UNCERTAIN")), true);
  assert.equal(isUncertainPurchase(err("IN_PROGRESS")), true);
  assert.equal(isUncertainPurchase(err("CARRIER_ERROR")), false);
});

test("the uncertain-purchase notice sends staff to the carrier account with the reference", () => {
  const err = (error) => ({ response: { data: { error } } });
  assert.match(uncertainNotice(err({ code: "PURCHASE_UNCERTAIN", reference: "Order 100245", message: "x" })), /UPS or FedEx account.*"Order 100245".*void it there/);
  assert.match(uncertainNotice(err({ code: "IN_PROGRESS", message: "check the UPS or FedEx account" })), /UPS or FedEx account/);
  assert.doesNotMatch(uncertainNotice({}), /Admin › Shipments/);
});

test("display helpers", () => {
  assert.equal(labelBadge({ labelled: true, status: "ready_to_ship" }), "Label printed");
  assert.equal(labelBadge({ labelled: true, status: "shipped" }), null);
  assert.equal(shipmentLine({ carrier: "ups", serviceName: "UPS Ground", trackingNumber: "1Z9" }), "UPS Ground · 1Z9");
  assert.equal(shipmentLine({ carrier: "manual", serviceName: "Courier", trackingNumber: null }), "Courier · no tracking number");
  assert.equal(labelNeedsRotation({ width: 1200, height: 800 }), true);
  assert.equal(labelNeedsRotation({ width: 800, height: 1200 }), false);
  assert.deepEqual(shipmentListParams({ status: "in_transit", carrier: " ", from: "2026-10-01", to: "" }), { status: "in_transit", from: "2026-10-01" });
  assert.equal(filenameFrom('attachment; filename="label-1Z9.zpl"'), "label-1Z9.zpl");
  assert.equal(filenameFrom(null, "label.zpl"), "label.zpl");
});
