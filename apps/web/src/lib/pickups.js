import {
  LAB_TIMEZONE, isoDateIn, formatUsDate, PICKUP_STATUS_LABELS, TIME_PREFERENCE_LABELS, PICKUP_WINDOW_MAX_DAYS,
  PICKUP_BOXES_MIN, PICKUP_BOXES_MAX, pickupRequestSchema, labPickupRequestSchema,
} from "@my-app/shared";
import api from "../config/api.js";

/** Pickup helpers shared by the doctor and lab screens: the request form's rules, the list calls and the row actions. */

const DAY_MS = 86_400_000;
/** "YYYY-MM-DD" plus whole days (calendar arithmetic on the date string, no zone involved). */
export function addDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** A new request form: earliest is today in the lab's zone, latest two days after. */
export function initialPickupForm(now = new Date()) {
  const today = isoDateIn(LAB_TIMEZONE, now);
  return { earliestDate: today, latestDate: addDays(today, 2), timePreference: "any", boxCount: 1, notes: "", clientUserId: "" };
}

/** The request body for the API. Empty latest/notes are left out (no latest = a one-day window). */
export function pickupBody(form, { staff = false } = {}) {
  const body = { earliestDate: form.earliestDate, timePreference: form.timePreference, boxCount: Number(form.boxCount) };
  if (form.latestDate) body.latestDate = form.latestDate;
  if (form.notes?.trim()) body.notes = form.notes.trim();
  if (staff) body.clientUserId = form.clientUserId;
  return body;
}

/**
 * Field → message for a request form (empty when valid). The shared schema checks shapes and limits;
 * the date rules that need "today" mirror the API's pickup-rules.js.
 */
export function pickupFormErrors(form, { staff = false, now = new Date() } = {}) {
  const errors = {};
  const today = isoDateIn(LAB_TIMEZONE, now);
  if (staff && !form.clientUserId) errors.clientUserId = "Choose the client.";
  const parsed = (staff ? labPickupRequestSchema : pickupRequestSchema).safeParse(pickupBody(form, { staff }));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "clientUserId" || errors[field]) continue;
      errors[field] = field === "boxCount" ? `Boxes must be ${PICKUP_BOXES_MIN} to ${PICKUP_BOXES_MAX}.` : issue.message;
    }
  }
  if (!errors.earliestDate && form.earliestDate < today) errors.earliestDate = "Earliest date can't be in the past.";
  if (!errors.latestDate && form.latestDate && form.earliestDate) {
    if (form.latestDate < form.earliestDate) errors.latestDate = "Latest date can't be before the earliest.";
    else if (daysBetween(form.earliestDate, form.latestDate) > PICKUP_WINDOW_MAX_DAYS) {
      errors.latestDate = `The window can be at most ${PICKUP_WINDOW_MAX_DAYS} days.`;
    }
  }
  return errors;
}

export const statusLabel = (s) => PICKUP_STATUS_LABELS[s] ?? s;
export const timePreferenceLabel = (t) => TIME_PREFERENCE_LABELS[t] ?? t;
export const isOpenPickup = (p) => p.status === "requested" || p.status === "scheduled";

/** "11/06/2026" or "11/06/2026 – 11/08/2026". */
export function windowLabel(p) {
  const from = formatUsDate(p.earliestDate);
  return p.latestDate && p.latestDate !== p.earliestDate ? `${from} – ${formatUsDate(p.latestDate)}` : from;
}

/** The address snapshot as one line, or the empty-state text. */
export function addressLine(address) {
  if (!address) return "No address on file";
  const parts = [address.name, address.address1, address.address2, [address.city, address.state, address.postalCode].filter(Boolean).join(" ")];
  return parts.filter(Boolean).join(", ") || "No address on file";
}

// ── API ──────────────────────────────────────────────────────────────────────
const data = (res) => res.data.data;

export const fetchPickups = async (params) => data(await api.get("/pickups", { params }));
export const requestPickup = async (body, { staff = false } = {}) => data(await api.post(staff ? "/lab/pickups" : "/pickups", body));
export const cancelOwnPickup = (p) => api.post(`/pickups/${p.id}/cancel`, { expectedVersion: p.version });
export const searchPickupClients = async (q) => data(await api.get("/lab/pickup-clients", { params: q ? { q } : {} })).clients;
export const fetchAssignableStaff = async () => data(await api.get("/lab/staff")).staff;

/** The lab list: `status` may be "open" (requested + scheduled), the API's own filter. → { rows, total } */
export const fetchLabPickups = async (params) => data(await api.get("/lab/pickups", { params }));
/** One pickup in the lab list's row shape (404 when it doesn't exist). */
export const fetchLabPickup = async (id) => data(await api.get(`/lab/pickups/${encodeURIComponent(id)}`));

export const schedulePickup = (p, { scheduledDate, assigneeUserId }) =>
  api.post(`/lab/pickups/${p.id}/schedule`, { scheduledDate, ...(assigneeUserId !== undefined ? { assigneeUserId } : {}), expectedVersion: p.version });
export const completePickup = (p) => api.post(`/lab/pickups/${p.id}/complete`, { expectedVersion: p.version });
export const cancelPickupAsStaff = (p, reason) =>
  api.post(`/lab/pickups/${p.id}/cancel`, { ...(reason?.trim() ? { reason: reason.trim() } : {}), expectedVersion: p.version });
