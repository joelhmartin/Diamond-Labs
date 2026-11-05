/**
 * Pure messaging rules: who sees a thread, which side a user is on, when a
 * thread is unread, what a folder means, and what a new post changes. The
 * drizzle queries (queries.js) restate unread and folders in SQL; keep the two
 * in step.
 */

export const SIDES = Object.freeze({ HOST: "host", PARTY: "party" });

/** Folders per side: host staff share completion, party users file their own. */
export const FOLDERS_BY_SIDE = Object.freeze({
  host: Object.freeze(["inbox", "completed"]),
  party: Object.freeze(["inbox", "archived"]),
});

export class MessagingError extends Error {
  /** @param {"NOT_FOUND"|"FORBIDDEN"|"INVALID"} code */
  constructor(code, message) {
    super(message ?? code);
    this.name = "MessagingError";
    this.code = code;
  }
}

/** `isHost` is a boolean or the app's `isHost(user)` predicate. */
export function sideOf(user, isHost) {
  const host = typeof isHost === "function" ? isHost(user) : Boolean(isHost);
  return host ? SIDES.HOST : SIDES.PARTY;
}

/** A host user reads every thread; a party user only threads under its keys. */
export function canRead(_user, thread, { isHost, partyKeys }) {
  if (!thread) return false;
  if (isHost) return true;
  return Array.isArray(partyKeys) && partyKeys.includes(thread.partyKey);
}

/** Unread: the other side posted last, after this user's last read (none = never). */
export function isUnreadFor(thread, participant, side) {
  if (!thread || thread.lastMessageSide === side || !thread.lastMessageAt) return false;
  const readAt = participant?.lastReadAt ? new Date(participant.lastReadAt).getTime() : -Infinity;
  return new Date(thread.lastMessageAt).getTime() > readAt;
}

/**
 * A folder as a filter: `{ completed: bool }` (host, shared thread state) or
 * `{ archived: bool }` (party, per user). null when the folder isn't offered
 * to that side. inbox is the default.
 */
export function folderWhere(folder = "inbox", side) {
  if (!FOLDERS_BY_SIDE[side]?.includes(folder)) return null;
  if (side === SIDES.HOST) return { completed: folder === "completed" };
  return { archived: folder === "archived" };
}

/** The thread patch for a new post. A party post reopens a completed thread. */
export function afterPost(_thread, side, now) {
  const patch = { lastMessageAt: now, lastMessageSide: side, updatedAt: now };
  if (side === SIDES.PARTY) Object.assign(patch, { completedAt: null, completedByUserId: null });
  return patch;
}
