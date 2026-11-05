/**
 * Generic notifications module: public surface. App code emits through
 * services/notify-seam.js, never from here; boot wiring calls
 * configureNotifications(createNotifier({...})) once. See README.md.
 */
export { defineNotificationEvent, getEvent, listEvents, clearEvents } from "./registry.js";
export { assertSafeData, NotificationDataError, maskAddress, MAX_DATA_BYTES, MAX_DATA_STRING } from "./data-guard.js";
export { effectivePreference, isOffered } from "./preferences.js";
export { createNotifier, NotificationInputError } from "./notifier.js";
export { createDrizzleStore, pruneDeliveries } from "./store.js";
export { createFakeStore } from "./fake-store.js";

let current = null;

/** Install the app's notifier (null removes it: notify() then resolves to zeros). */
export function configureNotifications(notifier) {
  current = notifier ?? null;
}

export function currentNotifier() {
  return current;
}
