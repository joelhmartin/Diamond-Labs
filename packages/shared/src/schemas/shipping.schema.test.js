import { test } from "vitest";
import assert from "node:assert/strict";
import {
  shippingAddressSchema, parcelSchema, shipmentRatesSchema, shipmentBuySchema, shipmentListQuerySchema,
} from "./shipping.schema.js";

const addr = {
  name: "Dr. Ada Smile", company: "Smile Dental", phone: "(210) 555-0100",
  address1: "100 Main St", city: "San Antonio", state: "tx", postalCode: "78205-1234",
};
const parcel = { preset: "small_box", weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };

test("an address normalises the state, accepts ZIP+4 and defaults to the US", () => {
  const a = shippingAddressSchema.parse(addr);
  assert.equal(a.state, "TX");
  assert.equal(a.postalCode, "78205-1234");
  assert.equal(a.country, "US");
});

test("addresses a carrier would reject are refused here first", () => {
  for (const bad of [
    { postalCode: "7820" }, { state: "Texas" }, { address1: "" }, { address1: "x".repeat(36) },
    { city: "" }, { name: "   " }, { phone: "call me" },
  ]) {
    assert.equal(shippingAddressSchema.safeParse({ ...addr, ...bad }).success, false, JSON.stringify(bad));
  }
});

test("blank optional lines become null, so the request builders can drop them", () => {
  const a = shippingAddressSchema.parse({ ...addr, company: "", address2: "  ", phone: "" });
  assert.equal(a.company, null);
  assert.equal(a.address2, null);
  assert.equal(a.phone, null);
});

test("a parcel needs whole ounces within the carriers' limits and real dimensions", () => {
  assert.equal(parcelSchema.safeParse(parcel).success, true);
  for (const bad of [{ weightOz: 0 }, { weightOz: 2401 }, { weightOz: 1.5 }, { lengthIn: 0 }, { heightIn: 109 }, { preset: "crate" }]) {
    assert.equal(parcelSchema.safeParse({ ...parcel, ...bad }).success, false, JSON.stringify(bad));
  }
});

test("rates need only the ship-to and the parcel", () => {
  assert.equal(shipmentRatesSchema.safeParse({ shipTo: addr, parcel }).success, true);
});

test("buy: a carrier label needs a service; a manual one needs the carrier's name", () => {
  const base = { orderIds: ["lo1"], shipTo: addr, parcel };
  assert.equal(shipmentBuySchema.safeParse({ ...base, carrier: "ups", serviceCode: "03" }).success, true);
  assert.equal(shipmentBuySchema.safeParse({ ...base, carrier: "ups" }).success, false);
  assert.equal(shipmentBuySchema.safeParse({ ...base, carrier: "manual" }).success, false);
  const manual = shipmentBuySchema.parse({ ...base, carrier: "manual", manual: { carrierName: "Courier" } });
  assert.equal(manual.manual.trackingNumber, null, "a hand delivery has no tracking number");
});

test("buy: one to twenty distinct orders", () => {
  const base = { shipTo: addr, parcel, carrier: "ups", serviceCode: "03" };
  assert.equal(shipmentBuySchema.safeParse({ ...base, orderIds: [] }).success, false);
  assert.equal(shipmentBuySchema.safeParse({ ...base, orderIds: ["a", "a"] }).success, false);
  assert.equal(shipmentBuySchema.safeParse({ ...base, orderIds: Array.from({ length: 21 }, (_, i) => `o${i}`) }).success, false);
});

test("the shipments list filters by status, carrier and date range", () => {
  assert.deepEqual(shipmentListQuerySchema.parse({ status: "in_transit", carrier: "fedex", from: "2026-10-01" }), {
    status: "in_transit", carrier: "fedex", from: "2026-10-01",
  });
  assert.equal(shipmentListQuerySchema.safeParse({ status: "lost" }).success, false);
  assert.equal(shipmentListQuerySchema.safeParse({ from: "10/01/2026" }).success, false);
});

test("shipment list: limit/offset/q validate (limit 1-200, q 1-100 after trim)", () => {
  assert.deepEqual(shipmentListQuerySchema.parse({ limit: "20", offset: "40", q: " 1Z99 " }), { limit: 20, offset: 40, q: "1Z99" });
  for (const bad of [{ limit: "201" }, { offset: "-1" }, { q: "  " }]) assert.equal(shipmentListQuerySchema.safeParse(bad).success, false, JSON.stringify(bad));
});
