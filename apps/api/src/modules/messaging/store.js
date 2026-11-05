import { and, desc, eq, getTableColumns, isNotNull, ne, sql } from "drizzle-orm";
import { messageThreads as t, messageParticipants as p, messages as m } from "./schema.js";
import { participantJoin, unreadSql, visibleWhere, threadListWhere, isEmptyMatch } from "./queries.js";

/**
 * The messaging service's data access, over drizzle. Every method takes the
 * `db` (or transaction) it should run on. Rows go in and come out exactly as
 * stored: sealing and opening happen in the service. fake-store.js mirrors this
 * surface in memory; keep the two in step.
 */
export function createDrizzleStore() {
  return {
    async insertThread(db, row) {
      await db.insert(t).values(row);
    },
    async getThread(db, id) {
      const [r] = await db.select().from(t).where(eq(t.id, id)).limit(1);
      return r ?? null;
    },
    async updateThread(db, id, patch) {
      await db.update(t).set(patch).where(eq(t.id, id));
    },
    /**
     * A new post: apply rules.afterPost's patch, count the message, and bring
     * the thread back to the inbox of everyone on the other side who archived it.
     */
    async recordPost(db, id, patch) {
      await db.update(t).set({ ...patch, messageCount: sql`${t.messageCount} + 1` }).where(eq(t.id, id));
      await db.update(p).set({ archivedAt: null })
        .where(and(eq(p.threadId, id), ne(p.side, patch.lastMessageSide), isNotNull(p.archivedAt)));
    },

    async insertMessage(db, row) {
      await db.insert(m).values(row);
    },
    async getMessage(db, id) {
      const [r] = await db.select().from(m).where(eq(m.id, id)).limit(1);
      return r ?? null;
    },
    async listMessages(db, threadId) {
      return db.select().from(m).where(eq(m.threadId, threadId)).orderBy(m.createdAt, m.id);
    },

    async getParticipant(db, threadId, userId) {
      const [r] = await db.select().from(p).where(and(eq(p.threadId, threadId), eq(p.userId, userId))).limit(1);
      return r ?? null;
    },
    /** Ensure the user's row exists, then apply `patch` (lastReadAt / archivedAt). */
    async touchParticipant(db, { threadId, userId, side }, patch = {}) {
      const q = db.insert(p).values({ threadId, userId, side, ...patch });
      await (Object.keys(patch).length
        ? q.onConflictDoUpdate({ target: [p.threadId, p.userId], set: patch })
        : q.onConflictDoNothing());
    },

    /**
     * One page of the caller's threads, newest activity first, each with the
     * caller's `unread` and `archivedAt`. `total` ignores limit/offset.
     */
    async listThreads(db, { userId, side, partyKeys, folder, unreadOnly, recordType, recordId, party, match, limit, offset }) {
      if (isEmptyMatch(match)) return { rows: [], total: 0 };
      const rows = await db.select({
        ...getTableColumns(t),
        unread: sql`${unreadSql(side)}`.mapWith(toBool),
        archivedAt: p.archivedAt,
        total: sql`count(*) over()`.mapWith(Number),
      })
        .from(t)
        .leftJoin(p, participantJoin(userId))
        .where(threadListWhere({ side, partyKeys, folder, unreadOnly, recordType, recordId, party, match }))
        .orderBy(desc(t.lastMessageAt), desc(t.id))
        .limit(limit)
        .offset(offset);
      const total = rows.length ? Number(rows[0].total) : 0;
      return { rows: rows.map(({ total: _total, ...r }) => r), total };
    },
    /** Threads unread for the caller across every folder they can see. */
    async unreadCount(db, { userId, side, partyKeys }) {
      const [r] = await db.select({ n: sql`count(*)::int` })
        .from(t)
        .leftJoin(p, participantJoin(userId))
        .where(and(visibleWhere(partyKeys), unreadSql(side)));
      return Number(r?.n ?? 0);
    },
  };
}

const toBool = (v) => v === true || v === "t" || v === "true";
