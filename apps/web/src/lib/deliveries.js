import { LAB_TIMEZONE, LAB_STATUS_LABELS, addIsoDays, isoDateIn, formatUsDate } from "@my-app/shared";
import api from "../config/api.js";
import { ROUTES } from "../config/routes.js";

/**
 * The local-delivery route list's helpers (Deliveries page and its print
 * sheet). A stop is `GET /lab/deliveries`' shape: { id, day, late, practice,
 * address, phone, deliveryNotes, orders: [{ id, orderNumber, status, version }],
 * pickups: [{ id, pickupNumber, boxCount, version }] }. Order numbers only:
 * the route list never carries a patient name.
 */

/** Today in the lab's zone through six days later (the API's own default). */
export function defaultDeliveryRange(now = new Date()) {
  const from = isoDateIn(LAB_TIMEZONE, now);
  return { from, to: addIsoDays(from, 6) };
}

/** The first and last day of these stops. */
export function deliveryRangeOf(stops) {
  const days = stops.map((s) => s.day).sort();
  return { from: days[0], to: days[days.length - 1] };
}

export function deliveryPrintPath({ from, to }) {
  return `${ROUTES.LAB_DELIVERIES_PRINT}?${new URLSearchParams({ from, to })}`;
}

/**
 * "Mark delivered" over the selected stops: ready-to-ship orders move to
 * shipped; anything else still open is named back as skipped. An order
 * already shipped is done, so it is neither.
 * → { moves: [{ id, orderNumber, version }], skipped: [{ orderNumber, reason }] }
 */
export function planMarkDelivered(stops) {
  const moves = [];
  const skipped = [];
  for (const o of stops.flatMap((s) => s.orders)) {
    if (o.status === "ready_to_ship") moves.push({ id: o.id, orderNumber: o.orderNumber, version: o.version });
    else if (o.status !== "shipped") skipped.push({ orderNumber: o.orderNumber, reason: `not ready to ship (${LAB_STATUS_LABELS[o.status] ?? o.status})` });
  }
  return { moves, skipped };
}

/** "Thu 11/05/2026": the weekday of a calendar date (no zone involved). */
export function dayLabel(day) {
  const weekday = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${formatUsDate(day)}`;
}

export function addressLine(address) {
  if (!address) return "No address on file";
  const place = [address.city, address.state, address.zip].filter(Boolean).join(" ");
  return [address.address1, address.address2, place].filter(Boolean).join(", ") || "No address on file";
}

export const ordersLabel = (orders) => orders.map((o) => `#${o.orderNumber}`).join(", ");

// ── API ──────────────────────────────────────────────────────────────────────

export const markOrderShipped = (o) => api.post(`/lab/orders/${o.id}/status`, { to: "shipped", expectedVersion: o.version });
