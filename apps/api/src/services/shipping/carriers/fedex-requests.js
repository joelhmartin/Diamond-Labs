import { weightLbFromOz } from "@my-app/shared";
import { cut, digits } from "./carrier-util.js";

/**
 * Pure FedEx request builders. Field names follow the research note
 * (2026-10-19-carrier-api-research.md); those marked [MEM] there are proven by
 * the sandbox smoke script before go-live.
 */
export const fedexPaths = {
  token: "/oauth/token",
  rate: "/rate/v1/rates/quotes",
  ship: "/ship/v1/shipments",
  // [UNVERIFIED] FedEx's cancel is documented two ways: PUT /ship/v1/shipments/cancel
  // (FedEx community) vs DELETE /ship/v1/shipments/{trackingNumber} (third party).
  // The smoke script confirms which before go-live; change only these two constants.
  cancel: "/ship/v1/shipments/cancel",
  track: "/track/v1/trackingnumbers",
};
export const FEDEX_CANCEL_METHOD = "PUT";
/** FedEx tracks at most 30 numbers per request. */
export const FEDEX_TRACK_BATCH = 30;

function fedexAddress(a) {
  return {
    streetLines: [a.address1, a.address2].filter(Boolean).map((l) => cut(l, 35)),
    city: cut(a.city, 35),
    stateOrProvinceCode: a.state,
    postalCode: a.postalCode,
    countryCode: a.country || "US",
    ...(a.residential ? { residential: true } : {}),
  };
}

/** FedEx requires a phone on every party; a recipient without one gets `fallbackPhone` (the lab's). */
function contact(a, fallbackPhone) {
  return {
    personName: cut(a.name, 35),
    ...(a.company ? { companyName: cut(a.company, 35) } : {}),
    phoneNumber: digits(a.phone) ?? digits(fallbackPhone),
  };
}

function lineItem(parcel, reference) {
  return {
    weight: { units: "LB", value: weightLbFromOz(parcel.weightOz) },
    // FedEx truncates decimal dimensions for rating; round up instead so the box is never under-declared.
    dimensions: { length: Math.ceil(parcel.lengthIn), width: Math.ceil(parcel.widthIn), height: Math.ceil(parcel.heightIn), units: "IN" },
    ...(reference ? { customerReferences: [{ customerReferenceType: "CUSTOMER_REFERENCE", value: cut(reference, 30) }] } : {}),
  };
}

export function fedexRateRequest({ shipFrom, shipTo, parcel, accountNumber }) {
  return {
    accountNumber: { value: accountNumber },
    requestedShipment: {
      shipper: { address: fedexAddress(shipFrom) },
      recipient: { address: fedexAddress(shipTo) },
      pickupType: "USE_SCHEDULED_PICKUP",
      rateRequestType: ["ACCOUNT", "LIST"],
      requestedPackageLineItems: [lineItem(parcel)],
    },
  };
}

export function fedexShipRequest({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat, accountNumber }) {
  const zpl = labelFormat === "zpl";
  return {
    labelResponseOptions: "LABEL",
    accountNumber: { value: accountNumber },
    requestedShipment: {
      shipper: { contact: contact(shipFrom), address: fedexAddress(shipFrom) },
      recipients: [{ contact: contact(shipTo, shipFrom.phone), address: fedexAddress(shipTo) }],
      pickupType: "USE_SCHEDULED_PICKUP",
      serviceType: serviceCode,
      packagingType: "YOUR_PACKAGING",
      shippingChargesPayment: { paymentType: "SENDER" },
      labelSpecification: { imageType: zpl ? "ZPLII" : "PNG", labelStockType: zpl ? "STOCK_4X6" : "PAPER_4X6" },
      requestedPackageLineItems: [lineItem(parcel, reference)],
    },
  };
}

export const fedexCancelRequest = ({ trackingNumber, accountNumber }) => ({
  accountNumber: { value: accountNumber }, trackingNumber, deletionControl: "DELETE_ALL_PACKAGES", emailShipment: false, senderCountryCode: "US",
});

export const fedexTrackRequest = (numbers) => ({
  includeDetailedScans: true,
  trackingInfo: numbers.map((n) => ({ trackingNumberInfo: { trackingNumber: n } })),
});
