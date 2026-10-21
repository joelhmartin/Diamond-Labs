import { createPgClient } from "../config/pg-client.js";

/**
 * One live Seazona fetch at a time, enforced by the import database: a
 * session-level Postgres advisory lock taken on a dedicated connection and held
 * until the process ends (Postgres frees it when the session dies, so a crash
 * or Ctrl-C cannot leave it stuck). The lock being free is also the proof that
 * no live process owns a run still marked "running" (see --mark-stale, --resume).
 */
export const FETCH_LOCK_KEY = 7_351_005_001;

/**
 * Options for the lock's connection. postgres-js reads idle_timeout and
 * max_lifetime in SECONDS and arms a setTimeout for them; max_lifetime defaults
 * to a random 30-60 minutes, and a value over ~24.8 days overflows setTimeout's
 * 32-bit limit and fires at 1 ms (which recycled the connection and dropped the
 * lock). 0 disables the timer, which is what this connection needs.
 */
export const LOCK_CLIENT_OPTIONS = { max: 1, idle_timeout: 0, max_lifetime: 0, connect_timeout: 15 };

export class FetchLockLost extends Error {
  constructor() {
    super("The fetch lock was lost (the lock connection closed). Stopping before the next request: another live fetch could now start. Check the run, then resume it.");
    this.name = "FetchLockLost";
  }
}

/**
 * { tryLock, isHeld, assertHeld, close } for one import DB. tryLock() is true when this
 * process holds the lock (idempotent). If the lock connection closes while held, the
 * session (and so the lock) is gone: isHeld() turns false and assertHeld() throws.
 */
export function makeFetchLock(url, { createClient = createPgClient } = {}) {
  let client = null;
  let held = false;
  let lost = false;
  let closing = false;
  const onclose = () => {
    if (held && !closing) lost = true;
  };
  return {
    async tryLock() {
      if (held) return !lost;
      client ??= createClient(url, { ...LOCK_CLIENT_OPTIONS, onclose });
      const [row] = await client`select pg_try_advisory_lock(${FETCH_LOCK_KEY}::bigint) as ok`;
      held = row?.ok === true;
      if (!held) {
        closing = true;
        await client.end({ timeout: 5 });
        client = null;
        closing = false;
      }
      return held;
    },
    isHeld: () => held && !lost,
    assertHeld() {
      if (held && lost) throw new FetchLockLost();
    },
    async close() {
      closing = true;
      if (client) await client.end({ timeout: 5 });
      client = null;
      held = false;
      closing = false;
    },
  };
}
