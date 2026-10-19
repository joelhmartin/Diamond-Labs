import { formatUsDate } from "@my-app/shared";
import { normalizeCarrierStatus } from "./carrier-status.js";
import { dollarsToCents as cents, emptyTrackResult } from "./carrier-util.js";

/** Pure FedEx response parsers. Dollars (JSON numbers) become cents HERE, once. */
const tidy = (name) => (name ? String(name).replace(/[®™]/g, "").trim() : null);
/** The account (negotiated) rate when FedEx sent one, else the first. */
const accountDetail = (details = []) => details.find((d) => /ACCOUNT/.test(d?.rateType ?? ""));
const accountCharge = (details = []) => (accountDetail(details) ?? details[0])?.totalNetCharge;
const place = (loc) => [loc?.city, loc?.stateOrProvinceCode].filter(Boolean).join(", ") || null;
const when = (s) => {
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export function parseFedexError(body) {
  const e = body?.errors?.[0];
  return e ? { code: e.code, message: e.message } : {};
}

export function parseFedexRates(body) {
  return (body?.output?.rateReplyDetails ?? [])
    .map((r) => {
      const by = formatUsDate(r?.commit?.dateDetail?.dayFormat ?? "");
      return {
        carrier: "fedex",
        serviceCode: r?.serviceType,
        serviceName: tidy(r?.serviceName) || `FedEx ${r?.serviceType}`,
        amountCents: cents(accountCharge(r?.ratedShipmentDetails)),
        estimatedDelivery: by ? `by ${by}` : null,
      };
    })
    .filter((q) => q.serviceCode && Number.isSafeInteger(q.amountCents));
}

/**
 * The bought label, or null when the success body can't be read (the adapter treats that as uncertain).
 * `chargeCents` is null when the charge is unreadable, never 0 (a silent $0 would under-bill).
 */
export function parseFedexLabel(body, { serviceCode, labelFormat }) {
  const s = body?.output?.transactionShipments?.[0];
  const piece = s?.pieceResponses?.[0];
  const doc = (piece?.packageDocuments ?? []).find((d) => d?.encodedLabel);
  const trackingNumber = piece?.trackingNumber ?? s?.masterTrackingNumber;
  if (!trackingNumber || !doc) return null;
  return {
    trackingNumber,
    carrierShipmentId: s.masterTrackingNumber ?? trackingNumber,
    labelFormat: labelFormat === "zpl" ? "zpl" : "png",
    labelData: doc.encodedLabel,
    // ACCOUNT-rated only: a list price recorded as our cost would over-bill (R6a).
    chargeCents: cents(accountDetail(s?.completedShipmentDetail?.shipmentRating?.shipmentRateDetails)?.totalNetCharge),
    currency: "USD",
    serviceCode,
    serviceName: tidy(s.serviceName) || `FedEx ${serviceCode}`,
  };
}

/**
 * [UNVERIFIED] FedEx's "already cancelled" answer, like the cancel path itself: matched on
 * the words (and an ALREADY..CANCEL code) conservatively. Confirm in the sandbox re-void.
 */
export const fedexAlreadyCancelled = (code, message) =>
  /already\s+(been\s+)?(void|cancel)/i.test(String(message ?? "")) || /ALREADY.*(CANCEL|VOID)/i.test(String(code ?? ""));

export function parseFedexCancel(body) {
  return body?.output?.cancelledShipment === true
    ? { ok: true }
    : { ok: false, reason: body?.output?.message || "FedEx did not confirm the cancellation." };
}

function trackResult(c) {
  const r = c?.trackResults?.[0] ?? {};
  const empty = emptyTrackResult(c?.trackingNumber);
  if (r.error) return { ...empty, error: { carrier: "fedex", code: r.error.code, message: r.error.message } };
  const latest = r.latestStatusDetail ?? {};
  const status = normalizeCarrierStatus("fedex", latest.code, latest.description);
  const events = (r.scanEvents ?? [])
    .map((e) => ({
      status: normalizeCarrierStatus("fedex", e.derivedStatusCode || e.eventType, e.eventDescription),
      carrierCode: e.derivedStatusCode || e.eventType || null,
      description: e.eventDescription ?? null,
      location: place(e.scanLocation),
      occurredAt: when(e.date),
    }))
    .sort((x, y) => (y.occurredAt?.getTime() ?? 0) - (x.occurredAt?.getTime() ?? 0));
  const delivered = when((r.dateAndTimes ?? []).find((d) => d.type === "ACTUAL_DELIVERY")?.dateTime);
  return {
    ...empty,
    status,
    carrierCode: latest.code ?? null,
    description: latest.description ?? null,
    location: place(latest.scanLocation),
    occurredAt: events[0]?.occurredAt ?? delivered,
    deliveredAt: status === "delivered" ? delivered : null,
    events,
  };
}

export const parseFedexTrack = (body) => (body?.output?.completeTrackResults ?? []).map(trackResult);
