/**
 * In-memory notification store: the same surface as `createDrizzleStore()`
 * (store.js), kept in plain arrays. It is the test double for the notifier and
 * for any host app's route tests, so it travels with the module. `state` is
 * exposed so a test can seed and inspect rows.
 */
export function createFakeStore({ preferences = [], recipients = [] } = {}) {
  const state = {
    notifications: [],
    preferences: preferences.map((p) => ({ ...p })),
    recipients: recipients.map((r) => ({ active: true, createdAt: new Date(), ...r })),
    deliveries: [],
    prunes: [],
  };
  const now = () => new Date();
  const mine = (userId) => state.notifications.filter((n) => n.userId === userId);
  const newestFirst = (a, b) => b.updatedAt - a.updatedAt;

  return {
    state,

    async preferencesFor(_db, userIds, event) {
      return state.preferences.filter((p) => userIds.includes(p.userId) && p.event === event);
    },
    async preferencesForUser(_db, userId) {
      return state.preferences.filter((p) => p.userId === userId);
    },
    async upsertPreference(_db, row) {
      const hit = state.preferences.find((p) => p.userId === row.userId && p.event === row.event && p.channel === row.channel);
      if (hit) Object.assign(hit, row, { updatedAt: now() });
      else state.preferences.push({ ...row, updatedAt: now() });
    },

    async upsertInApp(_db, row) {
      const hit = state.notifications.find((n) => n.userId === row.userId && n.collapseKey === row.collapseKey && !n.readAt);
      if (hit) {
        hit.count += 1;
        hit.updatedAt = now();
        return { id: hit.id, inserted: false };
      }
      state.notifications.push({ ...row, count: 1, readAt: null, createdAt: now(), updatedAt: now() });
      return { id: row.id, inserted: true };
    },
    async listInApp(_db, userId, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
      return mine(userId).filter((n) => !unreadOnly || !n.readAt).sort(newestFirst).slice(offset, offset + limit);
    },
    async unreadCount(_db, userId) {
      return mine(userId).filter((n) => !n.readAt).length;
    },
    async markRead(_db, userId, ids) {
      const rows = mine(userId).filter((n) => !n.readAt && (ids === null || ids.includes(n.id)));
      for (const n of rows) n.readAt = now();
      return rows.length;
    },
    async markUnread(_db, userId, id) {
      const row = mine(userId).find((n) => n.id === id);
      if (!row) return false;
      if (!row.readAt) return true;
      const clash = mine(userId).some((n) => n !== row && !n.readAt && n.collapseKey === row.collapseKey);
      if (clash) return false;
      row.readAt = null;
      return true;
    },
    async dismiss(_db, userId, id) {
      const i = state.notifications.findIndex((n) => n.userId === userId && n.id === id);
      if (i < 0) return false;
      state.notifications.splice(i, 1);
      return true;
    },

    async activeRecipients(_db, event) {
      return state.recipients.filter((r) => r.event === event && r.active);
    },
    async listRecipients(_db, { event } = {}) {
      return state.recipients.filter((r) => !event || r.event === event);
    },
    async getRecipient(_db, id) {
      return state.recipients.find((r) => r.id === id) ?? null;
    },
    async insertRecipient(_db, row) {
      const dup = state.recipients.some((r) => r.event === row.event && r.channel === row.channel && r.address === row.address);
      if (dup) return null;
      const saved = { createdAt: now(), ...row };
      state.recipients.push(saved);
      return saved;
    },
    async updateRecipient(_db, id, patch) {
      const row = state.recipients.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
    async deleteRecipient(_db, id) {
      const i = state.recipients.findIndex((r) => r.id === id);
      if (i < 0) return false;
      state.recipients.splice(i, 1);
      return true;
    },

    async insertDelivery(_db, row) {
      state.deliveries.push({ createdAt: now(), ...row });
    },
    async listDeliveries(_db, { event, limit = 100, offset = 0 } = {}) {
      return state.deliveries.filter((d) => !event || d.event === event).slice().reverse().slice(offset, offset + limit);
    },
    async pruneDeliveries(_db, days) {
      state.prunes.push(days);
      return 0;
    },
  };
}
