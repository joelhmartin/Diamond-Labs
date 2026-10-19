/**
 * Shipping vocabulary shared by the API and the web: carriers, the normalised
 * shipment statuses, label formats, parcel presets and the tracking-URL
 * builder. Nothing here knows about lab orders, so another site can reuse it.
 * Carrier code tables (a UPS/FedEx code → one of these statuses) live in the
 * API: apps/api/src/services/shipping/carriers/carrier-status.js.
 */
export const CARRIERS = ["ups", "fedex", "manual"];
export const CARRIER_LABELS = { ups: "UPS", fedex: "FedEx", manual: "Manual" };

export const SHIPMENT_STATUSES = [
  "label_created", "in_transit", "out_for_delivery", "delivered", "exception", "returned", "voided",
];
export const SHIPMENT_STATUS_LABELS = {
  label_created: "Label created",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Exception",
  returned: "Returned",
  voided: "Voided",
};

/** No further carrier change is possible: the tracking sync stops polling these. */
export const TERMINAL_SHIPMENT_STATUSES = ["delivered", "returned", "voided"];
export const isTerminalShipmentStatus = (s) => TERMINAL_SHIPMENT_STATUSES.includes(s);

/** The carrier has the box. The first of these marks the shipment's orders shipped. */
export const MOVEMENT_STATUSES = ["in_transit", "out_for_delivery", "delivered"];
export const isShipmentMovement = (s) => MOVEMENT_STATUSES.includes(s);

export const LABEL_FORMATS = ["gif", "png", "zpl"];
export const LABEL_CONTENT_TYPES = { gif: "image/gif", png: "image/png", zpl: "application/octet-stream" };
export const isImageLabel = (f) => f === "gif" || f === "png";

/**
 * The boxes the lab packs into. Placeholder sizes until the lab confirms its
 * stock; changing them is a one-line edit here (the web form and the API read
 * the same list).
 */
export const PARCEL_PRESETS = [
  { key: "mailer", label: "Padded mailer (10 × 7 × 2 in)", lengthIn: 10, widthIn: 7, heightIn: 2, weightOz: 8 },
  { key: "small_box", label: "Small box (8 × 6 × 4 in)", lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 16 },
  { key: "medium_box", label: "Medium box (12 × 10 × 6 in)", lengthIn: 12, widthIn: 10, heightIn: 6, weightOz: 32 },
  { key: "custom", label: "Custom size", lengthIn: null, widthIn: null, heightIn: null, weightOz: null },
];
export const PARCEL_PRESET_KEYS = PARCEL_PRESETS.map((p) => p.key);
export const parcelPreset = (key) => PARCEL_PRESETS.find((p) => p.key === key) ?? null;

/** Whole ounces → pounds for a carrier request: rounded UP to 0.1 lb, never below 0.1 lb. */
export function weightLbFromOz(oz) {
  if (!Number.isInteger(oz) || oz < 1) throw new RangeError(`weightOz must be a positive whole number, got ${oz}`);
  return Math.max(1, Math.ceil((oz * 10) / 16)) / 10;
}

const TRACKING_PAGES = {
  ups: (n) => `https://www.ups.com/track?loc=en_US&tracknum=${n}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
};

/** The carrier's public tracking page, or null (manual carriers, a missing or implausible number). */
export function trackingUrl(carrier, trackingNumber) {
  const n = String(trackingNumber ?? "").trim();
  const page = TRACKING_PAGES[carrier];
  if (!page || !/^[A-Za-z0-9]{6,40}$/.test(n)) return null;
  return page(n);
}

/** What a person calls the carrier: "UPS", "FedEx", or what staff typed for a manual shipment. */
export function carrierName({ carrier, serviceName } = {}) {
  if (carrier === "manual") return serviceName || CARRIER_LABELS.manual;
  return CARRIER_LABELS[carrier] ?? carrier ?? "—";
}
