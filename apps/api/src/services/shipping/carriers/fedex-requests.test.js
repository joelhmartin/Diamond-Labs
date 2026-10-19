import { test } from "vitest";
import assert from "node:assert/strict";
import { fedexRateRequest, fedexShipRequest, fedexCancelRequest, fedexTrackRequest, fedexPaths, FEDEX_TRACK_BATCH } from "./fedex-requests.js";
import { TEST_SHIP_FROM } from "../../../test/carrier-config.js";

const shipTo = { name: "Dr. Ada Smile", company: "Smile Dental", phone: null, address1: "100 Main St", address2: "Suite 4", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const parcel = { weightOz: 40, lengthIn: 8.5, widthIn: 6, heightIn: 4 };

test("rating asks for account and list rates for every service on the lab's account", () => {
  const r = fedexRateRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, accountNumber: "740561073" });
  assert.deepEqual(r.accountNumber, { value: "740561073" });
  assert.deepEqual(r.requestedShipment.rateRequestType, ["ACCOUNT", "LIST"]);
  assert.equal("serviceType" in r.requestedShipment, false, "no service = every service is rated");
  assert.deepEqual(r.requestedShipment.requestedPackageLineItems[0].weight, { units: "LB", value: 2.5 });
  assert.deepEqual(r.requestedShipment.recipient.address.streetLines, ["100 Main St", "Suite 4"]);
});

test("a recipient with no phone gets the lab's phone (FedEx requires one)", () => {
  const s = fedexShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 100245", labelFormat: "image", accountNumber: "740561073" });
  assert.equal(s.requestedShipment.recipients[0].contact.phoneNumber, "2105550199");
  assert.equal(s.requestedShipment.recipients[0].contact.companyName, "Smile Dental");
  assert.equal(fedexShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo: { ...shipTo, phone: "512-555-0123" }, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 1", labelFormat: "image", accountNumber: "A" })
    .requestedShipment.recipients[0].contact.phoneNumber, "5125550123");
});

test("the label request: PNG on paper or ZPLII on thermal 4×6, sender pays, order numbers as the only reference", () => {
  const png = fedexShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 100245", labelFormat: "image", accountNumber: "740561073" });
  assert.equal(png.labelResponseOptions, "LABEL");
  assert.deepEqual(png.requestedShipment.labelSpecification, { imageType: "PNG", labelStockType: "PAPER_4X6" });
  assert.deepEqual(png.requestedShipment.shippingChargesPayment, { paymentType: "SENDER" });
  assert.equal(png.requestedShipment.serviceType, "FEDEX_GROUND");
  assert.deepEqual(png.requestedShipment.requestedPackageLineItems[0].customerReferences, [{ customerReferenceType: "CUSTOMER_REFERENCE", value: "Order 100245" }]);
  assert.deepEqual(png.requestedShipment.requestedPackageLineItems[0].dimensions, { length: 9, width: 6, height: 4, units: "IN" });
  const zpl = fedexShipRequest({ shipFrom: TEST_SHIP_FROM, shipTo, parcel, serviceCode: "FEDEX_GROUND", reference: "Order 1", labelFormat: "zpl", accountNumber: "A" });
  assert.deepEqual(zpl.requestedShipment.labelSpecification, { imageType: "ZPLII", labelStockType: "STOCK_4X6" });
});

test("a residential ship-to is flagged residential; a commercial one is not", () => {
  const line = (to) => fedexRateRequest({ shipFrom: TEST_SHIP_FROM, shipTo: to, parcel, accountNumber: "A" }).requestedShipment.recipient.address;
  assert.equal(line({ ...shipTo, residential: true }).residential, true);
  assert.equal("residential" in line(shipTo), false);
});

test("cancel and track bodies; track batches stay within FedEx's 30-number limit", () => {
  assert.deepEqual(fedexCancelRequest({ trackingNumber: "794644790138", accountNumber: "A" }), {
    accountNumber: { value: "A" }, trackingNumber: "794644790138", deletionControl: "DELETE_ALL_PACKAGES", emailShipment: false, senderCountryCode: "US",
  });
  assert.equal(FEDEX_TRACK_BATCH, 30);
  assert.deepEqual(fedexTrackRequest(["1", "2"]).trackingInfo, [{ trackingNumberInfo: { trackingNumber: "1" } }, { trackingNumberInfo: { trackingNumber: "2" } }]);
  assert.equal(fedexPaths.ship, "/ship/v1/shipments");
});
