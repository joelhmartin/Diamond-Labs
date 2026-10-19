import { test } from "vitest";
import assert from "node:assert/strict";
import {
  CARRIERS, CARRIER_LABELS, SHIPMENT_STATUSES, TERMINAL_SHIPMENT_STATUSES, isTerminalShipmentStatus, isShipmentMovement,
  PARCEL_PRESETS, PARCEL_PRESET_KEYS, parcelPreset, weightLbFromOz, trackingUrl, carrierName, LABEL_CONTENT_TYPES, isImageLabel,
} from "./shipping.js";

test("three carriers, each with a label; manual is always one of them", () => {
  assert.deepEqual(CARRIERS, ["ups", "fedex", "manual"]);
  for (const c of CARRIERS) assert.equal(typeof CARRIER_LABELS[c], "string");
});

test("terminal statuses stop polling; movement means the carrier has the box", () => {
  assert.deepEqual(TERMINAL_SHIPMENT_STATUSES, ["delivered", "returned", "voided"]);
  assert.ok(TERMINAL_SHIPMENT_STATUSES.every((s) => SHIPMENT_STATUSES.includes(s)));
  assert.equal(isTerminalShipmentStatus("in_transit"), false);
  for (const s of ["in_transit", "out_for_delivery", "delivered"]) assert.equal(isShipmentMovement(s), true, s);
  for (const s of ["label_created", "exception", "returned", "voided"]) assert.equal(isShipmentMovement(s), false, s);
});

test("weights round UP to a tenth of a pound and never go below 0.1 lb", () => {
  assert.equal(weightLbFromOz(1), 0.1);
  assert.equal(weightLbFromOz(16), 1);
  assert.equal(weightLbFromOz(17), 1.1);
  assert.equal(weightLbFromOz(40), 2.5);
  assert.throws(() => weightLbFromOz(0), RangeError);
  assert.throws(() => weightLbFromOz(1.5), RangeError);
});

test("presets have unique keys; every non-custom preset has real dimensions and a weight", () => {
  assert.equal(new Set(PARCEL_PRESET_KEYS).size, PARCEL_PRESETS.length);
  assert.ok(PARCEL_PRESET_KEYS.includes("custom"));
  for (const p of PARCEL_PRESETS.filter((x) => x.key !== "custom")) {
    for (const k of ["lengthIn", "widthIn", "heightIn", "weightOz"]) assert.ok(p[k] > 0, `${p.key}.${k}`);
  }
  assert.equal(parcelPreset("nope"), null);
});

test("tracking links exist for UPS and FedEx only, and only for a plausible number", () => {
  assert.equal(trackingUrl("ups", "1Z999AA10123456784"), "https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784");
  assert.equal(trackingUrl("fedex", "794644790138"), "https://www.fedex.com/fedextrack/?trknbr=794644790138");
  assert.equal(trackingUrl("manual", "ABC123456"), null);
  assert.equal(trackingUrl("ups", "<script>"), null);
  assert.equal(trackingUrl("ups", null), null);
});

test("a manual shipment is named by what staff typed", () => {
  assert.equal(carrierName({ carrier: "ups" }), "UPS");
  assert.equal(carrierName({ carrier: "manual", serviceName: "Lone Star Courier" }), "Lone Star Courier");
  assert.equal(carrierName({ carrier: "manual" }), "Manual");
});

test("label formats map to a content type; GIF and PNG are images, ZPL is a printer file", () => {
  assert.equal(LABEL_CONTENT_TYPES.gif, "image/gif");
  assert.equal(LABEL_CONTENT_TYPES.png, "image/png");
  assert.equal(isImageLabel("zpl"), false);
  assert.equal(isImageLabel("png"), true);
});
