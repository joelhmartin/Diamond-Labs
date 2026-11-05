import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { messageThreads as t, messageParticipants as p } from "./schema.js";

/**
 * SQL restatements of rules.js, shared by the thread list and the unread
 * count so the two can never disagree. Every query that uses them left-joins
 * the caller's own participant row (participantJoin).
 */

/** The caller's read-state row for each thread (absent until they post or open it). */
export const participantJoin = (userId) => and(eq(p.threadId, t.id), eq(p.userId, userId));

/** rules.isUnreadFor in SQL: the other side posted last, after this user's last read. */
export const unreadSql = (side) =>
  sql`(${t.lastMessageSide} <> ${side} and ${t.lastMessageAt} > coalesce(${p.lastReadAt}, '-infinity'::timestamptz))`;

/** null partyKeys = a host user (every thread); an empty list sees nothing. */
export function visibleWhere(partyKeys) {
  if (partyKeys === null) return undefined;
  return partyKeys.length ? inArray(t.partyKey, partyKeys) : sql`false`;
}

/** rules.folderWhere's descriptor in SQL. */
export function folderSql(folder) {
  if ("completed" in folder) return folder.completed ? isNotNull(t.completedAt) : isNull(t.completedAt);
  return folder.archived ? isNotNull(p.archivedAt) : isNull(p.archivedAt);
}

/** A search hit list: threads with one of these parties or about one of these records. */
export function matchSql(match) {
  const parts = [];
  if (match.partyKeys?.length) parts.push(inArray(t.partyKey, match.partyKeys));
  for (const r of match.records ?? []) parts.push(and(eq(t.recordType, r.recordType), eq(t.recordId, r.recordId)));
  return parts.length ? or(...parts) : sql`false`;
}

export const isEmptyMatch = (match) => Boolean(match) && !match.partyKeys?.length && !match.records?.length;

/** The full list filter. Every input is optional except side and folder. */
export function threadListWhere({ side, partyKeys, folder, unreadOnly, recordType, recordId, party, match }) {
  return and(
    visibleWhere(partyKeys),
    folderSql(folder),
    unreadOnly ? unreadSql(side) : undefined,
    recordType ? eq(t.recordType, recordType) : undefined,
    recordId ? eq(t.recordId, recordId) : undefined,
    party ? eq(t.partyKey, party) : undefined,
    match ? matchSql(match) : undefined,
  );
}
