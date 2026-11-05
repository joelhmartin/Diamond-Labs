import {
  canMovePickup, TIME_PREFERENCES, PICKUP_STATUS_LABELS, PICKUP_WINDOW_MAX_DAYS, PICKUP_BOXES_MIN, PICKUP_BOXES_MAX, PICKUP_NOTES_MAX,
} from "@my-app/shared";
import { parseDueDate } from "./lab-order-rules.js";

/**
 * Pure rules for pickups (spec "Pickups (glue)"): a request's limits and the
 * row patch for each staff or doctor move. No DB and no clock — callers pass
 * today (CT) and `now` — so pickups.service.js only runs these inside a
 * transaction. Every move checks the shared move table and the version the
 * caller saw.
 */

export class PickupError extends Error {
  /**
   * @param {"NOT_FOUND"|"STALE"|"INVALID_TRANSITION"|"REASON_REQUIRED"|"INVALID"} code
   * @param {string} message  safe to show the user
   */
  constructor(code, message) {
    super(message);
    this.name = "PickupError";
    this.code = code;
  }
}

const invalid = (message) => new PickupError("INVALID", message);

/** "YYYY-MM-DD" + n calendar days. */
export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Trimmed free text, null when empty; refused over the limit. */
function cleanText(value, what) {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length > PICKUP_NOTES_MAX) throw invalid(`${what} can be at most ${PICKUP_NOTES_MAX} characters.`);
  return s || null;
}

/** A request → the row's request values. `todayIso` is today in LAB_TIMEZONE. Dates are "YYYY-MM-DD", so string order is date order. */
export function planRequest({ earliestDate, latestDate, timePreference, boxCount, notes }, todayIso) {
  const earliest = parseDueDate(earliestDate);
  if (!earliest) throw invalid("Pick the first day the boxes are ready.");
  if (earliest < todayIso) throw invalid("The first pickup day can't be in the past.");
  const latest = latestDate == null || latestDate === "" ? earliest : parseDueDate(latestDate);
  if (!latest) throw invalid("Pick the last day for the pickup.");
  if (latest < earliest) throw invalid("The last pickup day can't be before the first.");
  if (latest > addDays(earliest, PICKUP_WINDOW_MAX_DAYS)) throw invalid(`The pickup window can be at most ${PICKUP_WINDOW_MAX_DAYS} days.`);
  if (!TIME_PREFERENCES.includes(timePreference)) throw invalid("Pick a time of day.");
  if (!Number.isInteger(boxCount) || boxCount < PICKUP_BOXES_MIN || boxCount > PICKUP_BOXES_MAX) {
    throw invalid(`Boxes must be between ${PICKUP_BOXES_MIN} and ${PICKUP_BOXES_MAX}.`);
  }
  return { earliestDate: earliest, latestDate: latest, timePreference, boxCount, notes: cleanText(notes, "Notes") };
}

/**
 * The caller must have seen the version it is changing. `undefined` skips the
 * check only where the caller allows it (a doctor's cancel); the service's
 * conditional UPDATE still refuses a lost race.
 */
function assertFresh(pickup, expectedVersion, { optional = false } = {}) {
  if (optional && expectedVersion == null) return;
  if (!Number.isInteger(expectedVersion) || expectedVersion !== pickup.version) {
    throw new PickupError("STALE", "This pickup changed — reload.");
  }
}

const label = (s) => PICKUP_STATUS_LABELS[s] ?? s;

function assertMove(pickup, to) {
  if (!canMovePickup(pickup.status, to)) {
    throw new PickupError("INVALID_TRANSITION", `Pickup #${pickup.pickupNumber} can't move from ${label(pickup.status)} to ${label(to)}.`);
  }
}

const bump = (pickup, now) => ({ version: pickup.version + 1, updatedAt: now });

/** Schedule or reschedule: on or after the first day of the window (staff may push it later). */
export function planSchedule(pickup, { scheduledDate, assigneeUserId, expectedVersion }, now) {
  assertFresh(pickup, expectedVersion);
  assertMove(pickup, "scheduled");
  const date = parseDueDate(scheduledDate);
  if (!date) throw invalid("Pick a pickup date.");
  if (date < pickup.earliestDate) throw invalid("The pickup date can't be before the first day the boxes are ready.");
  return {
    status: "scheduled", scheduledDate: date,
    assigneeUserId: assigneeUserId === undefined ? pickup.assigneeUserId ?? null : assigneeUserId,
    ...bump(pickup, now),
  };
}

/** Staff only: the driver has the boxes. */
export function planComplete(pickup, { byUserId, expectedVersion }, now) {
  assertFresh(pickup, expectedVersion);
  assertMove(pickup, "completed");
  return { status: "completed", completedAt: now, completedByUserId: byUserId ?? null, ...bump(pickup, now) };
}

/** Staff cancel with a reason; a doctor may cancel without one (and without a version). */
export function planCancel(pickup, { reason, byStaff, expectedVersion }, now) {
  assertFresh(pickup, expectedVersion, { optional: !byStaff });
  assertMove(pickup, "cancelled");
  const why = cleanText(reason, "The reason");
  if (byStaff && !why) throw new PickupError("REASON_REQUIRED", "Say why this pickup is cancelled.");
  return { status: "cancelled", cancelledAt: now, cancelReason: why, ...bump(pickup, now) };
}
