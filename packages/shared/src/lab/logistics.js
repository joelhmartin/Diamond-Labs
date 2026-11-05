import { daysBetween } from "../dates/iso-days.js";

/**
 * Lab logistics vocabulary shared by the API and the web: pickup statuses,
 * the moves between them, and the pickup time preferences. A pickup is the
 * lab's own driver collecting boxes from a practice (no carrier label).
 * Delivery methods are owned by another piece and do not live here.
 */
export const PICKUP_STATUSES = ["requested", "scheduled", "completed", "cancelled"];
export const PICKUP_STATUS_LABELS = {
  requested: "Requested",
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** from → the statuses it may move to. scheduled → scheduled is a reschedule. */
export const PICKUP_MOVES = {
  requested: ["scheduled", "cancelled"],
  scheduled: ["scheduled", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const canMovePickup = (from, to) => (PICKUP_MOVES[from] ?? []).includes(to);
export const isTerminalPickupStatus = (s) => (PICKUP_MOVES[s] ?? []).length === 0;

export const TIME_PREFERENCES = ["am", "pm", "any"];
export const TIME_PREFERENCE_LABELS = { am: "Morning", pm: "Afternoon", any: "Any time" };

/** Request limits (spec "Pickups (glue)"): the API rules and the web form read the same numbers. */
export const PICKUP_WINDOW_MAX_DAYS = 14;
export const PICKUP_BOXES_MIN = 1;
export const PICKUP_BOXES_MAX = 20;
export const PICKUP_NOTES_MAX = 500;

/**
 * The request window's date rules, for the API (pickup-rules.js) and the web
 * form alike: earliest not before today (CT), latest not before earliest, and
 * at most PICKUP_WINDOW_MAX_DAYS apart. Takes real "YYYY-MM-DD" dates (shape
 * is the schema's job); a missing latest is a one-day window.
 * → null, or { field: "earliestDate" | "latestDate", message } for the first rule broken.
 */
export function pickupWindowError(earliest, latest, today) {
  if (earliest < today) return { field: "earliestDate", message: "The first pickup day can't be in the past." };
  if (!latest) return null;
  if (latest < earliest) return { field: "latestDate", message: "The last pickup day can't be before the first." };
  if (daysBetween(earliest, latest) > PICKUP_WINDOW_MAX_DAYS) {
    return { field: "latestDate", message: `The pickup window can be at most ${PICKUP_WINDOW_MAX_DAYS} days.` };
  }
  return null;
}
