import { PREFERENCE_CHANNELS } from "@my-app/shared";
import { effectivePreference, isOffered } from "./preferences.js";
import { clampInt, collapseKeyFor, NotificationInputError, uniq } from "./util.js";

const listFilter = (q) => ({ unreadOnly: q.unread === true || q.unread === "true", event: q.event || undefined });

/** A user's own side: in-app list and read state, and their channel preferences. */
export function createInbox({ store, events, use }) {
  async function getPreferences(db, user) {
    const rows = await store.preferencesForUser(use(db), user.id);
    return events.listEvents({ kind: user.kind }).map((e) => ({
      event: e.key,
      label: e.label,
      channels: Object.fromEntries(PREFERENCE_CHANNELS.filter((c) => isOffered(e, user.kind, c))
        .map((c) => [c, effectivePreference(rows, e, user.kind, c)])),
    }));
  }

  async function setPreference(db, user, { event: key, channel, enabled } = {}) {
    const event = events.getEvent(key);
    if (!event) throw new NotificationInputError(`unknown event ${key}`, "unknown_event");
    if (!PREFERENCE_CHANNELS.includes(channel)) throw new NotificationInputError(`channel ${channel} has no preference`, "invalid_channel");
    if (!isOffered(event, user.kind, channel)) throw new NotificationInputError(`event ${key} is not offered on ${channel} to kind ${user.kind}`, "not_offered");
    await store.upsertPreference(use(db), { userId: user.id, event: key, channel, enabled: Boolean(enabled) });
  }

  return {
    listForUser: (db, userId, q = {}) => store.listInApp(use(db), userId, {
      ...listFilter(q),
      limit: clampInt(q.limit, 1, 100, 50),
      offset: clampInt(q.offset, 0, 1e6, 0),
    }),
    countForUser: (db, userId, q = {}) => store.countInApp(use(db), userId, listFilter(q)),
    unreadCount: (db, userId) => store.unreadCount(use(db), userId),
    markRead: (db, userId, { ids, all } = {}) => store.markRead(use(db), userId, all ? null : uniq(ids)),
    /**
     * The user has seen the thing an event was about (e.g. opened it): mark
     * their unread row for that event and record read, so the next notify
     * starts a fresh alert instead of collapsing into a stale one. → count.
     */
    markReadFor: async (db, userId, { event, recordType, recordId } = {}) => {
      if (!userId || !event) return 0;
      return store.markReadByKey(use(db), userId, collapseKeyFor(event, recordType ?? null, recordId ?? null));
    },
    markUnread: (db, userId, id) => store.markUnread(use(db), userId, id),
    dismiss: (db, userId, id) => store.dismiss(use(db), userId, id),
    getPreferences,
    setPreference,
  };
}
