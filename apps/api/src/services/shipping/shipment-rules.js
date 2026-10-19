import { SHIPMENT_STATUSES, isTerminalShipmentStatus, isShipmentMovement } from "@my-app/shared";
import { ShippingError } from "./shipping-errors.js";

/**
 * Pure shipment rules: the new row, void, and what a tracking answer changes.
 * No DB and no clock (callers pass ids and `now`). Generic: nothing here
 * knows a lab order (lab rules live in services/lab/lab-shipping-rules.js).
 */

/** A bought label (createLabel's result plus `carrier`) → the shipments row and its first event. */
export function planNewShipment({ id, label, parcel, shipTo, shipFrom = null, createdByUserId = null, now }) {
  const manual = label.carrier === "manual";
  const shipment = {
    id,
    carrier: label.carrier,
    serviceCode: label.serviceCode ?? null,
    serviceName: label.serviceName ?? null,
    carrierShipmentId: label.carrierShipmentId ?? null,
    trackingNumber: label.trackingNumber ?? null,
    status: "label_created",
    // null = the carrier reported no readable charge (R5a); never coerced to 0.
    chargeCents: label.chargeCents ?? null,
    currency: label.currency ?? "USD",
    parcel,
    shipTo,
    shipFrom,
    labelFormat: label.labelFormat ?? null,
    labelData: label.labelData ?? null,
    createdByUserId,
    purchasedAt: now,
    shippedAt: null,
    deliveredAt: null,
    voidedAt: null,
    lastTrackedAt: null,
    trackingError: null,
    createdAt: now,
    updatedAt: now,
  };
  const event = {
    shipmentId: id, status: "label_created", description: manual ? "Recorded by staff" : "Label created",
    location: null, occurredAt: now, source: manual ? "staff" : "carrier",
  };
  return { shipment, event };
}

/** A label can be voided while it is unused: not voided, not moving, not marked shipped. */
export function assertVoidable(shipment) {
  if (shipment.status === "voided") throw new ShippingError("VOID_REFUSED", "This label is already void.");
  if (shipment.status !== "label_created" || shipment.shippedAt) {
    throw new ShippingError("VOID_REFUSED", "This shipment has already left, so its label can't be voided. Correct the invoice with a credit instead.");
  }
}

export function planVoided(shipment, { now }) {
  return {
    patch: { status: "voided", voidedAt: now, updatedAt: now },
    event: { shipmentId: shipment.id, status: "voided", description: "Label voided", location: null, occurredAt: now, source: "staff" },
  };
}

/**
 * A carrier that answers "not found / no information yet" for a number it has not
 * scanned. Expected for a fresh label; for any other status it is a real problem.
 * (Matches UPS's "No tracking information available" and FedEx's TRACKING.TRACKINGNUMBER.NOTFOUND / NO_RESULT.)
 */
const NO_NEWS_YET_MS = 72 * 3_600_000;
const NO_NEWS_CODE = /TRACKINGNUMBER\.NOTFOUND|^NO_RESULT$/i;
const NO_NEWS_MESSAGE = /no\s+tracking\s+information|tracking\s+number.{0,40}(not\s+found|cannot\s+be\s+found)/i;
// Only the carrier's tracking-not-found answer: a 404 from a wrong path or "account not found" is a real error.
const isNoNewsYet = (error) => NO_NEWS_CODE.test(String(error?.code ?? "")) || NO_NEWS_MESSAGE.test(String(error?.message ?? ""));
const isFreshLabel = (shipment, now) =>
  shipment.status === "label_created" && shipment.purchasedAt instanceof Date && now.getTime() - shipment.purchasedAt.getTime() < NO_NEWS_YET_MS;

const NOTHING = { patch: null, event: null, moved: false, unknownCode: null };

/**
 * One carrier answer → what to write.
 * - A terminal shipment never changes (a stale scan after "delivered" is ignored).
 * - An error, or no answer, is stored (except "not found yet" on a label_created shipment bought < 72h ago: no news) as trackingError and retried next run.
 * - An unknown code changes only lastTrackedAt; the code comes back for the log.
 * - A new status writes ONE event; delivered stamps deliveredAt.
 * - `moved` = the shipment is (now) moving and its orders were never marked
 *   shipped: the caller ships them. Re-reported until it succeeds.
 */
export function planTrackingUpdate(shipment, result, now) {
  if (isTerminalShipmentStatus(shipment.status)) return NOTHING;
  // A label-created shipment nobody has scanned yet: "not found" is no news, not an error to show staff.
  if (result?.error && isFreshLabel(shipment, now) && isNoNewsYet(result.error)) {
    return { ...NOTHING, patch: { lastTrackedAt: now, trackingError: null, updatedAt: now }, noNews: true };
  }
  if (!result || result.error) {
    const message = String(result?.error?.message ?? "No tracking result returned.").slice(0, 300);
    return { ...NOTHING, patch: { lastTrackedAt: now, trackingError: message, updatedAt: now } };
  }
  const base = { lastTrackedAt: now, trackingError: null, updatedAt: now };
  const next = result.status;
  const known = Boolean(next) && SHIPMENT_STATUSES.includes(next) && next !== "voided";
  if (!known || next === shipment.status) {
    return {
      patch: base,
      event: null,
      moved: isShipmentMovement(shipment.status) && !shipment.shippedAt,
      unknownCode: next ? null : (result.carrierCode ?? null),
    };
  }
  const patch = { ...base, status: next };
  if (next === "delivered") patch.deliveredAt = result.deliveredAt ?? result.occurredAt ?? now;
  const event = {
    shipmentId: shipment.id, status: next, description: result.description ?? null,
    location: result.location ?? null, occurredAt: result.occurredAt ?? now, source: "carrier",
  };
  return { patch, event, moved: isShipmentMovement(next) && !shipment.shippedAt, unknownCode: null };
}
