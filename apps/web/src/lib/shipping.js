import { parcelPreset, carrierName, isTerminalShipmentStatus, SHIPMENT_STATUS_LABELS } from "@my-app/shared";

/**
 * Pure helpers for the Ship form, the Shipping panel, the label print page and
 * Admin › Shipments. The API owns every rule; these only shape requests and text.
 */
export const EMPTY_ADDRESS = { name: "", company: "", phone: "", address1: "", address2: "", city: "", state: "", postalCode: "" };
const DEFAULT_PRESET = "small_box";

/** The Ship form from GET /lab/orders/:id/ship. Server nulls become "" so every input stays controlled. */
export function initialShipForm(context) {
  const p = parcelPreset(DEFAULT_PRESET);
  const shipTo = {
    ...Object.fromEntries(Object.keys(EMPTY_ADDRESS).map((k) => [k, context?.shipTo?.[k] ?? ""])),
    residential: Boolean(context?.shipTo?.residential), // shop orders arrive true; staff tick it for a home-office practice
  };
  return {
    orderIds: context?.order ? [context.order.id] : [],
    shipTo,
    parcel: { preset: p.key, weightOz: p.weightOz, lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn },
    choice: null,
    manual: { carrierName: "", trackingNumber: "" },
  };
}

/** A preset fills its dimensions and keeps the weight staff typed; "custom" keeps everything. */
export function applyPreset(parcel, key) {
  const p = parcelPreset(key);
  if (!p || key === "custom") return { ...parcel, preset: "custom" };
  return { ...parcel, preset: key, lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn, weightOz: parcel.weightOz || p.weightOz };
}

/** Pounds + ounces typed → whole ounces (what the API takes); 0 when nothing usable was typed. */
export function weightOzFrom(lb, oz) {
  const total = Math.round((Number(lb) || 0) * 16 + (Number(oz) || 0));
  return total > 0 ? total : 0;
}
export const splitWeight = (weightOz) => ({ lb: Math.floor((weightOz || 0) / 16), oz: (weightOz || 0) % 16 });

const text = (v) => String(v ?? "").trim();
const blankToNull = (v) => text(v) || null;

function cleanAddress(a) {
  return {
    name: text(a.name), company: blankToNull(a.company), phone: blankToNull(a.phone),
    address1: text(a.address1), address2: blankToNull(a.address2), city: text(a.city),
    state: text(a.state).toUpperCase(), postalCode: text(a.postalCode), country: "US",
    residential: Boolean(a.residential),
  };
}
const cleanParcel = (p) => ({
  preset: p.preset, weightOz: Number(p.weightOz), lengthIn: Number(p.lengthIn), widthIn: Number(p.widthIn), heightIn: Number(p.heightIn),
});

/** Form → POST /lab/shipments/rates. */
export const ratesBody = (form) => ({ shipTo: cleanAddress(form.shipTo), parcel: cleanParcel(form.parcel) });

/** Form → POST /lab/shipments. */
export function buyBody(form) {
  const base = { orderIds: [...form.orderIds], shipTo: cleanAddress(form.shipTo), parcel: cleanParcel(form.parcel) };
  if (form.choice?.carrier === "manual") {
    return { ...base, carrier: "manual", manual: { carrierName: text(form.manual.carrierName), trackingNumber: blankToNull(form.manual.trackingNumber) } };
  }
  return { ...base, carrier: form.choice?.carrier, serviceCode: form.choice?.serviceCode };
}

/** One attempt = one Idempotency-Key (lib/idempotency.js): the same box, address and service. */
export const buySignature = (body) => JSON.stringify(body);

/** What was rated. A change makes the quotes on screen stale; picking a service doesn't. */
export const quoteKey = (form) => JSON.stringify(ratesBody(form));
export const quoteId = (q) => `${q.carrier}:${q.serviceCode}`;

/** The server couldn't confirm the purchase, or the attempt's key is still held: don't retry blindly. */
export function isUncertainPurchase(err) {
  const code = err?.response?.data?.error?.code;
  return code === "PURCHASE_UNCERTAIN" || code === "IN_PROGRESS";
}

/**
 * What staff read after an uncertain purchase. Nothing is saved for it, so
 * Admin › Shipments can't show the label: the check is at the carrier, by reference.
 */
export function uncertainNotice(err) {
  const e = err?.response?.data?.error;
  if (e?.code === "PURCHASE_UNCERTAIN" && e.reference) {
    return `Don't buy again yet. The label may exist: check the UPS or FedEx account for a label with the reference "${e.reference}" and void it there first.`;
  }
  return e?.message || "The purchase may have gone through. Check the UPS or FedEx account for a label with these order numbers as its reference and void it there before buying again.";
}

/** The server can only poll a carrier shipment that has a tracking number and hasn't finished. */
export const canRefreshTracking = (s) => s.carrier !== "manual" && Boolean(s.trackingNumber) && !isTerminalShipmentStatus(s.status);

/** "Label printed" on a board card while the box hasn't left. */
export const labelBadge = (card) => (card?.labelled && card.status === "ready_to_ship" ? "Label printed" : null);

/** "UPS Ground · 1Z…" */
export const shipmentLine = (s) => `${s.serviceName || carrierName(s)} · ${s.trackingNumber || "no tracking number"}`;
export const shipmentStatusLabel = (status) => SHIPMENT_STATUS_LABELS[status] ?? status ?? "—";

/** UPS GIF labels arrive landscape; the print page turns them onto the 4×6 portrait page. */
export const labelNeedsRotation = ({ width, height }) => Number(width) > Number(height);

/** Admin › Shipments filters → GET /lab/shipments params, blanks dropped. */
export function shipmentListParams(filters = {}) {
  const out = {};
  for (const k of ["status", "carrier", "from", "to"]) {
    const v = text(filters[k]);
    if (v) out[k] = v;
  }
  return out;
}

/** The filename the API sent in Content-Disposition. */
export function filenameFrom(disposition, fallback = "label") {
  const m = /filename="([^"]+)"/.exec(disposition ?? "");
  return m ? m[1] : fallback;
}
