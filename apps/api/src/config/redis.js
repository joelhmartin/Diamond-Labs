import { queryClient as sql } from "./database.js";

/**
 * Postgres-backed drop-in for the small subset of ioredis this app uses
 * (get / set…EX / del / incr / expire). Keeps auth tokens, login-attempt
 * counters, and OAuth state in our Cloud SQL DB — under the existing Google
 * Cloud BAA — instead of a third-party Redis. Holds NO PHI.
 *
 * TTL is enforced two ways: lazily on read (expired rows are treated as absent)
 * and by a periodic sweep that deletes expired rows.
 */

async function get(key) {
  const rows = await sql`
    SELECT value FROM kv_store
    WHERE key = ${key} AND (expires_at IS NULL OR expires_at > now())
  `;
  return rows.length ? rows[0].value : null;
}

// Mirrors redis.set(key, value, "EX", seconds). Other modes aren't used here.
async function set(key, value, mode, seconds) {
  const expiresAt =
    mode === "EX" && seconds ? new Date(Date.now() + Number(seconds) * 1000).toISOString() : null;
  await sql`
    INSERT INTO kv_store (key, value, expires_at)
    VALUES (${key}, ${String(value)}, ${expiresAt}::timestamptz)
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
  `;
  return "OK";
}

async function del(...keys) {
  const flat = keys.flat();
  if (!flat.length) return 0;
  const res = await sql`DELETE FROM kv_store WHERE key = ANY(${flat})`;
  return res.count;
}

// Atomic increment. An expired counter resets to 1 (and loses its old TTL,
// which the caller re-applies via expire()).
async function incr(key) {
  const rows = await sql`
    INSERT INTO kv_store (key, value, expires_at)
    VALUES (${key}, '1', NULL)
    ON CONFLICT (key) DO UPDATE SET
      value = ((CASE
        WHEN kv_store.expires_at IS NOT NULL AND kv_store.expires_at <= now() THEN 0
        ELSE kv_store.value::bigint END) + 1)::text,
      expires_at = CASE
        WHEN kv_store.expires_at IS NOT NULL AND kv_store.expires_at <= now() THEN NULL
        ELSE kv_store.expires_at END
    RETURNING value
  `;
  return parseInt(rows[0].value, 10);
}

async function expire(key, seconds) {
  const res = await sql`
    UPDATE kv_store SET expires_at = now() + make_interval(secs => ${Number(seconds)})
    WHERE key = ${key}
  `;
  return res.count > 0 ? 1 : 0;
}

// Compat no-op for the old `redis.on("error", …)` call shape.
function on() {}

// Periodic sweep of expired rows (every 10 min). unref() so it never holds the
// process open. Errors are swallowed — lazy expiry already guarantees behavior.
const sweep = setInterval(() => {
  sql`DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= now()`.catch(() => {});
}, 10 * 60 * 1000);
sweep.unref?.();

export const redis = { get, set, del, incr, expire, on };
