import { labIdentity } from "../config/lab-identity.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { configureNotifications, createNotifier, currentNotifier } from "../modules/notifications/index.js";
import { notificationRoutes } from "../modules/notifications/routes.js";
import { messagingRoutes } from "../modules/messaging/index.js";
import { smsRegistry } from "../modules/sms/sms-registry.js";
import { isEmailConfigured, sendNotificationEmail } from "./email.service.js";
import { labKindOf, registerLabNotificationEvents, resolveLabAudience } from "./lab/lab-notifications.js";
import { createLabMessaging, labMessagingGuard, listLabParties } from "./lab/lab-messaging.js";

let messaging = null;

/** The messaging service configureAppModules built (null before boot). */
export const currentMessaging = () => messaging;

/**
 * Boot wiring for the generic modules (modules/*): each is configured here
 * from env plus the lab glue, once per process. Both entrypoints call it: the
 * API server (index.js) and the job CLI (jobs/cli.js; the tracking sync emits
 * lab.order_shipped). A module added later appends its own lines here.
 */
export function configureAppModules({ env, db, log = console }) {
  registerLabNotificationEvents();
  configureNotifications(createNotifier({
    db,
    resolveAudience: resolveLabAudience,
    // Pass the sender's { ok, reason } through: the notifier records suppressed/unconfigured as such.
    channels: { email: { send: sendNotificationEmail }, sms: smsRegistry() },
    appUrl: env.APP_URL,
    orgName: labIdentity(env).name,
    log,
  }));
  messaging = createLabMessaging({ db, labName: labIdentity(env).name, log });
}

/** What Admin › alerts shows about the channels: the SMS provider state and whether email can send. */
export function channelStatus() {
  return { sms: smsRegistry().status(), email: { configured: isEmailConfigured() } };
}

/** Every generic module's routes, with the lab's guards and kinds. Register under /api/v1 after configureAppModules. */
export async function appModuleRoutes(fastify) {
  const notifier = currentNotifier();
  if (!notifier) throw new Error("appModuleRoutes: call configureAppModules() first");
  await fastify.register(notificationRoutes, { notifier, authenticate, requireAdmin, kindOf: labKindOf, channelStatus });
  await fastify.register(messagingRoutes, { messaging, authenticate, guard: labMessagingGuard, listParties: listLabParties });
}
