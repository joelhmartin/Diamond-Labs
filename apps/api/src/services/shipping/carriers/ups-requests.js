import { weightLbFromOz } from "@my-app/shared";
import { cut, digits } from "./carrier-util.js";

/**
 * Pure UPS request builders (UPS OpenAPI specs: Shipping.yaml, Rating.yaml,
 * Tracking.yaml). Addresses in, UPS JSON out. The `reference` is order
 * numbers only (lab-shipping-rules.js shipmentReference), so no patient data
 * can reach a label.
 */
export const UPS_API_VERSION = "v2409";

export const UPS_SERVICE_NAMES = {
  "01": "Next Day Air", "02": "2nd Day Air", "03": "Ground", "12": "3 Day Select",
  "13": "Next Day Air Saver", "14": "Next Day Air Early", "59": "2nd Day Air A.M.",
};
export const upsServiceName = (code) => `UPS ${UPS_SERVICE_NAMES[code] ?? `service ${code}`}`;

export const upsPaths = {
  token: "/security/v1/oauth/token",
  rate: `/api/rating/${UPS_API_VERSION}/Shop`,
  ship: `/api/shipments/${UPS_API_VERSION}/ship`,
  void: (id) => `/api/shipments/${UPS_API_VERSION}/void/cancel/${encodeURIComponent(id)}`,
  track: (n) => `/api/track/v1/details/${encodeURIComponent(n)}?locale=en_US&returnMilestones=false`,
};

function upsAddress(a) {
  return {
    AddressLine: [a.address1, a.address2].filter(Boolean).map((l) => cut(l, 35)),
    City: cut(a.city, 30),
    StateProvinceCode: a.state,
    PostalCode: a.postalCode,
    CountryCode: a.country || "US",
    ...(a.residential ? { ResidentialAddressIndicator: "" } : {}),
  };
}

/** Shipper / ShipTo / ShipFrom: the company is the Name UPS prints, the person is the attention line. */
function party(a, extra = {}) {
  const phone = digits(a.phone);
  return {
    Name: cut(a.company || a.name, 35),
    AttentionName: cut(a.name, 35),
    ...(phone ? { Phone: { Number: phone } } : {}),
    Address: upsAddress(a),
    ...extra,
  };
}

function upsPackage(parcel, packagingKey) {
  const inches = (n) => String(Math.ceil(n));
  return {
    [packagingKey]: { Code: "02" }, // customer-supplied package
    Dimensions: {
      UnitOfMeasurement: { Code: "IN" },
      Length: inches(parcel.lengthIn), Width: inches(parcel.widthIn), Height: inches(parcel.heightIn),
    },
    PackageWeight: { UnitOfMeasurement: { Code: "LBS" }, Weight: String(weightLbFromOz(parcel.weightOz)) },
  };
}

/** Shop: every UPS service for the lane, negotiated (account) rates where eligible. */
export function upsRateRequest({ shipFrom, shipTo, parcel, accountNumber }) {
  return {
    RateRequest: {
      Request: { RequestOption: "Shop" },
      Shipment: {
        Shipper: party(shipFrom, { ShipperNumber: accountNumber }),
        ShipTo: party(shipTo),
        ShipFrom: party(shipFrom),
        ShipmentRatingOptions: { NegotiatedRatesIndicator: "Y" },
        Package: upsPackage(parcel, "PackagingType"),
      },
    },
  };
}

export function upsShipRequest({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat, accountNumber }) {
  return {
    ShipmentRequest: {
      Request: { RequestOption: "nonvalidate" },
      Shipment: {
        Shipper: party(shipFrom, { ShipperNumber: accountNumber }),
        ShipTo: party(shipTo),
        ShipFrom: party(shipFrom),
        PaymentInformation: { ShipmentCharge: [{ Type: "01", BillShipper: { AccountNumber: accountNumber } }] },
        Service: { Code: serviceCode },
        ShipmentRatingOptions: { NegotiatedRatesIndicator: "X" },
        Package: [{ ...upsPackage(parcel, "Packaging"), ReferenceNumber: [{ Value: cut(reference, 35) }] }],
      },
      LabelSpecification: {
        LabelImageFormat: { Code: labelFormat === "zpl" ? "ZPL" : "GIF" },
        LabelStockSize: { Height: "6", Width: "4" },
      },
    },
  };
}
