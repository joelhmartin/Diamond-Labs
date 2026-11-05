/**
 * Notification delivery channels (generic notifications module). `in_app` and
 * `email` are per-user preferences; `sms` goes only to an event's static
 * recipient list today (users have no verified mobile), but the list already
 * allows it so a per-user SMS preference needs no new value.
 */
export const CHANNELS = ["in_app", "email", "sms"];

/** Channels a user can switch on or off for themselves. */
export const PREFERENCE_CHANNELS = ["in_app", "email"];

/** Channels a static recipient list can hold. */
export const RECIPIENT_CHANNELS = ["sms", "email"];

/** Statuses of a notification_deliveries row. */
export const DELIVERY_STATUSES = ["sent", "failed", "skipped", "suppressed"];
