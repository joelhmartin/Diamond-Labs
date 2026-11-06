/**
 * Favorites are stored by the host, not by this module. A store is:
 *
 *   listKeys(db, userId) -> Promise<Set<string>>   report keys the user starred
 *   set(db, userId, key, on) -> Promise<void>      star (on) or unstar
 *
 * The memory store below is a complete implementation for tests and for hosts
 * that have no persistent per-user stars yet (it forgets on restart).
 */
export function createMemoryFavoritesStore() {
  const byUser = new Map();
  return {
    async listKeys(_db, userId) {
      return new Set(byUser.get(userId) || []);
    },
    async set(_db, userId, key, on) {
      const keys = byUser.get(userId) || new Set();
      if (on) keys.add(key);
      else keys.delete(key);
      byUser.set(userId, keys);
    },
  };
}
