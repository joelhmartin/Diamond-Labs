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
