/**
 * Generic messaging module: public surface. Threads on any record (or none)
 * between the host and one party, sealed text, per-user read state and
 * folders. The host app wires createMessaging({...}) and messagingRoutes once
 * at boot. See README.md.
 */
export { createMessaging, SEALED_FIELDS } from "./messaging.service.js";
export { messagingRoutes } from "./routes.js";
export { MessagingError, canRead, sideOf, isUnreadFor, folderWhere, afterPost, SIDES, FOLDERS_BY_SIDE } from "./rules.js";
export { createDrizzleStore } from "./store.js";
export { createFakeStore } from "./fake-store.js";
