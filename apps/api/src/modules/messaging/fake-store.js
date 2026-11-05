import { isUnreadFor } from "./rules.js";

/**
 * In-memory messaging store: the same surface as `createDrizzleStore()`
 * (store.js), kept in plain arrays. It is the test double for the service and
 * for any host app's route tests, so it travels with the module. `state` is
 * exposed so a test can seed and inspect rows (stored sealed, as in the DB).
 */
export function createFakeStore() {
  const state = { threads: [], messages: [], participants: [] };
  const participant = (threadId, userId) => state.participants.find((x) => x.threadId === threadId && x.userId === userId) ?? null;
  const time = (d) => (d ? new Date(d).getTime() : -Infinity);
  const visible = (partyKeys) => (th) => partyKeys === null || partyKeys.includes(th.partyKey);
  const inFolder = (folder, part) => (th) => ("completed" in folder
    ? Boolean(th.completedAt) === folder.completed
    : Boolean(part(th)?.archivedAt) === folder.archived);
  const matches = (match) => (th) => !match
    || (match.partyKeys ?? []).includes(th.partyKey)
    || (match.records ?? []).some((r) => r.recordType === th.recordType && r.recordId === th.recordId);

  return {
    state,

    async insertThread(_db, row) {
      state.threads.push({ ...row });
    },
    async getThread(_db, id) {
      const r = state.threads.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async updateThread(_db, id, patch) {
      const r = state.threads.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    },
    async recordPost(_db, id, patch) {
      const r = state.threads.find((x) => x.id === id);
      if (r) Object.assign(r, patch, { messageCount: r.messageCount + 1 });
    },

    async insertMessage(_db, row) {
      state.messages.push({ ...row });
    },
    async listMessages(_db, threadId) {
      return state.messages.filter((x) => x.threadId === threadId)
        .sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id))
        .map((x) => ({ ...x }));
    },

    async getParticipant(_db, threadId, userId) {
      const r = participant(threadId, userId);
      return r ? { ...r } : null;
    },
    async touchParticipant(_db, { threadId, userId, side }, patch = {}) {
      const r = participant(threadId, userId);
      if (r) Object.assign(r, patch);
      else state.participants.push({ threadId, userId, side, lastReadAt: null, archivedAt: null, joinedAt: new Date(), ...patch });
    },

    async listThreads(_db, { userId, side, partyKeys, folder, unreadOnly, recordType, recordId, party, match, limit, offset }) {
      const part = (th) => participant(th.id, userId);
      const hits = state.threads
        .filter(visible(partyKeys))
        .filter(inFolder(folder, part))
        .filter((th) => !unreadOnly || isUnreadFor(th, part(th), side))
        .filter((th) => (!recordType || th.recordType === recordType) && (!recordId || th.recordId === recordId))
        .filter((th) => !party || th.partyKey === party)
        .filter(matches(match))
        .sort((a, b) => time(b.lastMessageAt) - time(a.lastMessageAt) || b.id.localeCompare(a.id));
      const rows = hits.slice(offset, offset + limit).map((th) => ({
        ...th, unread: isUnreadFor(th, part(th), side), archivedAt: part(th)?.archivedAt ?? null,
      }));
      return { rows, total: hits.length };
    },
    async unreadCount(_db, { userId, side, partyKeys }) {
      return state.threads.filter(visible(partyKeys)).filter((th) => isUnreadFor(th, participant(th.id, userId), side)).length;
    },
  };
}
