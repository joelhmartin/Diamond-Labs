import { test } from "vitest";
import assert from "node:assert/strict";
import { upsRateRequest, upsShipRequest, upsPaths } from "./ups-requests.js";
import { TEST_SHIP_FROM } from "../../../test/carrier-config.js";

const shipTo = {
  name: "Dr. Ada Smile", company: "Smile Dental Group of Greater San Antonio", phone: "(210) 555-0100",
  address1: "100 Main St", address2: null, city: "Austin", state: "TX", postalCode: "78701", country: "US",
};
const parcel = { preset: "small_box", weightOz: 17, lengthIn: 8, widthIn: 6.2, heightIn: 4 };

test("rating shops every UPS service for the lane, as the lab's account (negotiated rates)", () => {
  const { RateRequest: r } = upsRateRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, accountNumber: "A1B2C3" });
  assert.equal(r.Request.RequestOption, "Shop");
  assert.equal(r.Shipment.Shipper.ShipperNumber, "A1B2C3");
  assert.deepEqual(r.Shipment.ShipmentRatingOptions, { NegotiatedRatesIndicator: "Y" });
  assert.deepEqual(r.Shipment.Package.PackagingType, { Code: "02" });
  assert.deepEqual(r.Shipment.Package.PackageWeight, { UnitOfMeasurement: { Code: "LBS" }, Weight: "1.1" });
  assert.equal(r.Shipment.Package.Dimensions.Width, "7", "dimensions round up to whole inches");
});

test("an address becomes UPS's shape: company as Name, the person as AttentionName, digits-only phone, 35-char lines", () => {
  const { ShipmentRequest: s } = upsShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 100245", labelFormat: "image", accountNumber: "A1B2C3" });
  const to = s.Shipment.ShipTo;
  assert.equal(to.Name, "Smile Dental Group of Greater San A");
  assert.equal(to.Name.length, 35);
  assert.equal(to.AttentionName, "Dr. Ada Smile");
  assert.deepEqual(to.Phone, { Number: "2105550100" });
  assert.deepEqual(to.Address, { AddressLine: ["100 Main St"], City: "Austin", StateProvinceCode: "TX", PostalCode: "78701", CountryCode: "US" });
});

test("no phone on the ship-to: the Phone block is left out, not sent empty", () => {
  const { ShipmentRequest: s } = upsShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo: { ...shipTo, phone: null }, parcel, serviceCode: "03", reference: "Order 1", labelFormat: "image", accountNumber: "A" });
  assert.equal("Phone" in s.Shipment.ShipTo, false);
});

test("the label request: GIF or ZPL on 4×6 stock, billed to the shipper, the service picked, order numbers as the only reference", () => {
  const gif = upsShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 100245, 100246", labelFormat: "image", accountNumber: "A1B2C3" }).ShipmentRequest;
  assert.deepEqual(gif.LabelSpecification, { LabelImageFormat: { Code: "GIF" }, LabelStockSize: { Height: "6", Width: "4" } });
  assert.deepEqual(gif.Shipment.PaymentInformation, { ShipmentCharge: [{ Type: "01", BillShipper: { AccountNumber: "A1B2C3" } }] });
  assert.deepEqual(gif.Shipment.Service, { Code: "03" });
  assert.deepEqual(gif.Shipment.Package[0].ReferenceNumber, [{ Value: "Order 100245, 100246" }]);
  assert.equal(JSON.stringify(gif).includes("Description"), false, "no free-text description travels to UPS");
  const zpl = upsShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "03", reference: "Order 1", labelFormat: "zpl", accountNumber: "A" }).ShipmentRequest;
  assert.equal(zpl.LabelSpecification.LabelImageFormat.Code, "ZPL");
});

test("paths carry the API version and encode ids", () => {
  assert.equal(upsPaths.ship, "/api/shipments/v2409/ship");
  assert.equal(upsPaths.void("1Z 9"), "/api/shipments/v2409/void/cancel/1Z%209");
  assert.match(upsPaths.track("1Z999"), /^\/api\/track\/v1\/details\/1Z999\?locale=en_US/);
});
