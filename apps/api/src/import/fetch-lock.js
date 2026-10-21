import { createPgClient } from "../config/pg-client.js";

/**
 * One live Seazona fetch at a time, enforced by the import database: a
 * session-level Postgres advisory lock taken on a dedicated connection and held
 * until the process ends (Postgres frees it when the session dies, so a crash
 * or Ctrl-C cannot leave it stuck). The lock being free is also the proof that
 * no live process owns a run still marked "running" (see --mark-stale, --resume).
 */
export const FETCH_LOCK_KEY = 7_351_005_001;

const YEAR_SECONDS = 365 * 24 * 3600;

/** { tryLock, close } for one import DB. tryLock() is true when this process holds the lock (idempotent). */
export function makeFetchLock(url) {
  let client = null;
  let held = false;
  return {
    async tryLock() {
      if (held) return true;
      // One connection, never recycled: postgres-js would otherwise close it after
      // max_lifetime and silently drop the lock.
      client ??= createPgClient(url, { max: 1, idle_timeout: 0, max_lifetime: YEAR_SECONDS, connect_timeout: 15 });
      const [row] = await client`select pg_try_advisory_lock(${FETCH_LOCK_KEY}::bigint) as ok`;
      held = row?.ok === true;
      if (!held) {
        await client.end({ timeout: 5 });
        client = null;
      }
      return held;
    },
    async close() {
      if (client) await client.end({ timeout: 5 });
      client = null;
      held = false;
    },
  };
}
