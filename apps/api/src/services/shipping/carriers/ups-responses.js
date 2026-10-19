import { upsServiceName } from "./ups-requests.js";
import { normalizeCarrierStatus } from "./carrier-status.js";
import { asList as list, dollarsToCents as cents, emptyTrackResult, isAlreadyVoidedAnswer } from "./carrier-util.js";

/**
 * Pure UPS response parsers. Dollars become cents HERE, once. UPS returns an
 * object instead of a one-item array (RatedShipment, PackageResults,
 * activity), so every list goes through `list`.
 */
export function parseUpsError(body) {
  const e = list(body?.response?.errors)[0];
  return e ? { code: e.code, message: e.message } : {};
}

export function parseUpsRates(body) {
  return list(body?.RateResponse?.RatedShipment)
    .map((r) => {
      const code = r?.Service?.Code;
      const days = Number(r?.GuaranteedDelivery?.BusinessDaysInTransit);
      return {
        carrier: "ups",
        serviceCode: code,
        serviceName: upsServiceName(code),
        amountCents: cents(r?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ?? r?.TotalCharges?.MonetaryValue),
        estimatedDelivery: Number.isInteger(days) && days > 0 ? `${days} business day${days === 1 ? "" : "s"}` : null,
      };
    })
    .filter((q) => q.serviceCode && Number.isSafeInteger(q.amountCents));
}

/**
 * The bought label, or null when the success body can't be read (the adapter treats that as uncertain).
 * `chargeCents` is null when the charge is unreadable, never 0 (a silent $0 would under-bill).
 */
export function parseUpsLabel(body, { serviceCode, labelFormat }) {
  const r = body?.ShipmentResponse?.ShipmentResults;
  const pkg = list(r?.PackageResults)[0];
  const image = pkg?.ShippingLabel?.GraphicImage;
  const trackingNumber = pkg?.TrackingNumber ?? r?.ShipmentIdentificationNumber;
  if (!r?.ShipmentIdentificationNumber || !trackingNumber || !image) return null;
  return {
    trackingNumber,
    carrierShipmentId: r.ShipmentIdentificationNumber,
    labelFormat: labelFormat === "zpl" ? "zpl" : "gif",
    labelData: image,
    chargeCents: cents(r?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ?? r?.ShipmentCharges?.TotalCharges?.MonetaryValue),
    currency: r?.ShipmentCharges?.TotalCharges?.CurrencyCode ?? "USD",
    serviceCode,
    serviceName: upsServiceName(serviceCode),
  };
}

/**
 * [UNVERIFIED] UPS's "already voided" answer: no code is documented, so this matches the
 * words conservatively. Confirm against the sandbox re-void (docs/shipping-operations.md).
 */
export const upsAlreadyVoided = isAlreadyVoidedAnswer;

export function parseUpsVoid(body) {
  const status = body?.VoidShipmentResponse?.Response?.ResponseStatus;
  return status?.Code === "1" ? { ok: true } : { ok: false, reason: status?.Description || "UPS did not confirm the void." };
}

// UPS gives a date (YYYYMMDD) and time (HHMMSS) in the scan's local time with
// no zone; read as UTC, which is close enough for a timeline.
function scanTime(a) {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(a?.date ?? "");
  if (!d) return null;
  const t = /^(\d{2})(\d{2})(\d{2})$/.exec(a?.time ?? "") ?? [null, "00", "00", "00"];
  return new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]));
}
const place = (addr) => [addr?.city, addr?.stateProvince].filter(Boolean).join(", ") || null;

export function parseUpsTrack(body, inquiry) {
  const pkg = list(list(body?.trackResponse?.shipment)[0]?.package)[0];
  const events = list(pkg?.activity)
    .map((a) => ({
      status: normalizeCarrierStatus("ups", a?.status?.type, a?.status?.description),
      carrierCode: a?.status?.type ?? null,
      description: a?.status?.description ?? null,
      location: place(a?.location?.address),
      occurredAt: scanTime(a),
    }))
    .sort((x, y) => (y.occurredAt?.getTime() ?? 0) - (x.occurredAt?.getTime() ?? 0));
  const latest = events[0];
  if (!latest) return emptyTrackResult(pkg?.trackingNumber ?? inquiry);
  return {
    trackingNumber: pkg.trackingNumber ?? inquiry,
    status: latest.status,
    carrierCode: latest.carrierCode,
    description: latest.description,
    location: latest.location,
    occurredAt: latest.occurredAt,
    deliveredAt: latest.status === "delivered" ? latest.occurredAt : null,
    events,
  };
}
