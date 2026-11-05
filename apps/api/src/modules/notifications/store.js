import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { notifications, notificationPreferences, notificationRecipients, notificationDeliveries } from "./schema.js";

/**
 * The notifier's data access, over drizzle. Every method takes the `db` it
 * should run on (the caller's root db). fake-store.js mirrors this surface in
 * memory; keep the two in step.
 */
export function createDrizzleStore() {
  return {
    async preferencesFor(db, userIds, event) {
      if (!userIds.length) return [];
      return db.select().from(notificationPreferences)
        .where(and(inArray(notificationPreferences.userId, userIds), eq(notificationPreferences.event, event)));
    },
    async preferencesForUser(db, userId) {
      return db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    },
    async upsertPreference(db, { userId, event, channel, enabled }) {
      await db.insert(notificationPreferences).values({ userId, event, channel, enabled })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.event, notificationPreferences.channel],
          set: { enabled, updatedAt: sql`now()` },
        });
    },

    // Collapse: while the user has an unread row with this key, bump it. The
    // predicate must match the partial unique index in schema.js. xmax = 0 is
    // postgres's tell that the row was inserted rather than updated.
    async upsertInApp(db, row) {
      const [r] = await db.insert(notifications).values(row)
        .onConflictDoUpdate({
          target: [notifications.userId, notifications.collapseKey],
          targetWhere: sql`read_at is null`,
          set: { count: sql`${notifications.count} + 1`, updatedAt: sql`now()` },
        })
        .returning({ id: notifications.id, inserted: sql`(xmax = 0)` });
      return { id: r?.id ?? row.id, inserted: r?.inserted === true || r?.inserted === "t" };
    },
    async listInApp(db, userId, { unreadOnly = false, event, limit = 50, offset = 0 } = {}) {
      return db.select().from(notifications).where(inAppWhere(userId, { unreadOnly, event }))
        .orderBy(desc(notifications.updatedAt)).limit(limit).offset(offset);
    },
    async countInApp(db, userId, { unreadOnly = false, event } = {}) {
      const [r] = await db.select({ n: sql`count(*)::int` }).from(notifications).where(inAppWhere(userId, { unreadOnly, event }));
      return Number(r?.n ?? 0);
    },
    async unreadCount(db, userId) {
      const [r] = await db.select({ n: sql`count(*)::int` }).from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
      return Number(r?.n ?? 0);
    },
    async markRead(db, userId, ids) {
      const conds = [eq(notifications.userId, userId), isNull(notifications.readAt)];
      if (ids !== null) {
        if (!ids.length) return 0;
        conds.push(inArray(notifications.id, ids));
      }
      const rows = await db.update(notifications).set({ readAt: sql`now()` }).where(and(...conds)).returning({ id: notifications.id });
      return rows.length;
    },
    async markReadByKey(db, userId, collapseKey) {
      const rows = await db.update(notifications).set({ readAt: sql`now()` })
        .where(and(eq(notifications.userId, userId), eq(notifications.collapseKey, collapseKey), isNull(notifications.readAt)))
        .returning({ id: notifications.id });
      return rows.length;
    },
    // Refused (false) when another unread row already holds the collapse key:
    // the partial unique index allows only one.
    async markUnread(db, userId, id) {
      const rows = await db.update(notifications).set({ readAt: null })
        .where(and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          sql`not exists (select 1 from "notifications" "n2" where "n2"."user_id" = ${userId} and "n2"."collapse_key" = ${notifications.collapseKey} and "n2"."read_at" is null and "n2"."id" <> ${id})`,
        ))
        .returning({ id: notifications.id });
      return rows.length > 0;
    },
    async dismiss(db, userId, id) {
      const rows = await db.delete(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .returning({ id: notifications.id });
      return rows.length > 0;
    },

    async activeRecipients(db, event) {
      return db.select().from(notificationRecipients)
        .where(and(eq(notificationRecipients.event, event), eq(notificationRecipients.active, true)));
    },
    async listRecipients(db, { event } = {}) {
      const q = db.select().from(notificationRecipients);
      return (event ? q.where(eq(notificationRecipients.event, event)) : q)
        .orderBy(notificationRecipients.event, notificationRecipients.createdAt);
    },
    async getRecipient(db, id) {
      const [r] = await db.select().from(notificationRecipients).where(eq(notificationRecipients.id, id)).limit(1);
      return r ?? null;
    },
    // null when (event, channel, address) already exists.
    async insertRecipient(db, row) {
      const [r] = await db.insert(notificationRecipients).values(row).onConflictDoNothing().returning();
      return r ?? null;
    },
    async updateRecipient(db, id, patch) {
      const [r] = await db.update(notificationRecipients).set(patch).where(eq(notificationRecipients.id, id)).returning();
      return r ?? null;
    },
    async deleteRecipient(db, id) {
      const rows = await db.delete(notificationRecipients).where(eq(notificationRecipients.id, id)).returning({ id: notificationRecipients.id });
      return rows.length > 0;
    },

    async insertDelivery(db, row) {
      await db.insert(notificationDeliveries).values(row);
    },
    async listDeliveries(db, { event, channel, status, limit = 100, offset = 0 } = {}) {
      const conds = deliveryConds({ event, channel, status });
      const q = db.select().from(notificationDeliveries);
      return (conds.length ? q.where(and(...conds)) : q)
        .orderBy(desc(notificationDeliveries.createdAt)).limit(limit).offset(offset);
    },
    async countDeliveries(db, { event, channel, status } = {}) {
      const conds = deliveryConds({ event, channel, status });
      const q = db.select({ n: sql`count(*)::int` }).from(notificationDeliveries);
      const [r] = await (conds.length ? q.where(and(...conds)) : q);
      return Number(r?.n ?? 0);
    },
    pruneDeliveries,
  };
}

function deliveryConds({ event, channel, status }) {
  return [
    event && eq(notificationDeliveries.event, event),
    channel && eq(notificationDeliveries.channel, channel),
    status && eq(notificationDeliveries.status, status),
  ].filter(Boolean);
}

function inAppWhere(userId, { unreadOnly, event }) {
  return and(
    eq(notifications.userId, userId),
    unreadOnly ? isNull(notifications.readAt) : undefined,
    event ? eq(notifications.event, event) : undefined,
  );
}

/** Delete delivery log rows older than `days`. */
export async function pruneDeliveries(db, days) {
  await db.delete(notificationDeliveries)
    .where(lt(notificationDeliveries.createdAt, sql`now() - make_interval(days => ${days}::int)`));
}
