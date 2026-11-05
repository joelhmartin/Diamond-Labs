import { createId } from "@paralleldrive/cuid2";
import * as registry from "./registry.js";
import { createDrizzleStore } from "./store.js";
import { createSender } from "./sender.js";
import { createDispatch } from "./dispatch.js";
import { createInbox } from "./inbox.js";
import { createRecipients } from "./recipients.js";
import { clampInt } from "./util.js";

export { NotificationInputError } from "./util.js";

/**
 * Build a notifier. Collaborators (all injected, so another app wires its own):
 * - resolveAudience(db, audience) → [{ id, email, kind }]
 * - channels.email.send({ to, subject, heading, line, actionUrl, actionLabel })
 *     → boolean | { ok, reason }   (reason "suppressed" / "unconfigured" /
 *     "undeliverable" is recorded as not-a-failure)
 * - channels.sms.send({ to, body }) → { ok, error? }
 * - store: data access (default: drizzle, store.js; tests pass fake-store.js)
 * - events: { getEvent, listEvents } (default: the module registry)
 * Every method takes the db to run on; `db` here is the fallback.
 *
 * The pieces: dispatch.js (notify), sender.js (channels + deliveries log),
 * inbox.js (a user's alerts and preferences), recipients.js (static list).
 */
export function createNotifier({
  db: rootDb = null,
  store = createDrizzleStore(),
  events = registry,
  resolveAudience = async () => [],
  channels = {},
  appUrl = "",
  orgName = "",
  log = console,
  random = Math.random,
  newId = createId,
} = {}) {
  const use = (db) => db ?? rootDb;
  const sender = createSender({ store, channels, appUrl, orgName, log, newId });
  return {
    notify: createDispatch({ store, events, resolveAudience, sender, log, random, newId, use }),
    ...createInbox({ store, events, use }),
    recipients: createRecipients({ store, events, sender, orgName, use, newId }),
    deliveries: {
      list: (db, q = {}) => store.listDeliveries(use(db), {
        event: q.event || undefined, limit: clampInt(q.limit, 1, 500, 100), offset: clampInt(q.offset, 0, 1e6, 0),
      }),
    },
  };
}
