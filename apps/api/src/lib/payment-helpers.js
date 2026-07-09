/**
 * Pure, dependency-light helpers shared by the payment routes. None of these
 * import the DB or env, so they're cheap to unit-test in isolation.
 */

// Idempotency TTLs (kv-store / Redis shim).
export const IDEMPOTENCY_RESULT_TTL = 24 * 60 * 60; // 24h — cached completed response
export const IDEMPOTENCY_LOCK_TTL = 120; // 2 min — in-flight lock window for one charge

// D1 — per-invoice charge-mutex TTL. Short: it only needs to cover one
// verify-cap → charge → record critical section (a single Authorize.net round
// trip plus two small writes). Kept well under the idempotency lock so a wedged
// lock (process died mid-charge, del never ran) self-heals quickly; the
// idempotency-key lock and the invoice_payments dedup remain the durable
// backstops if it does lapse.
export const INVOICE_LOCK_TTL = 30; // 30s

/** Thrown by withIdempotency when a concurrent charge holds the lock (→ HTTP 409). */
export class ChargeInProgressError extends Error {
  constructor(message = "A charge for this request is already being processed.") {
    super(message);
    this.name = "ChargeInProgressError";
  }
}

/** Thrown by withInvoiceLocks when another charge holds a per-invoice lock (→ HTTP 409). */
export class InvoiceLockedError extends Error {
  constructor(invoiceId) {
    super("A payment for this invoice is already in progress.");
    this.name = "InvoiceLockedError";
    this.invoiceId = invoiceId;
  }
}

/** Redis key for a per-user, per-invoice charge mutex (D1). */
export const invoiceLockKey = (userId, invoiceId) => `chargeguard:${userId}:${invoiceId}`;

/**
 * Serialize the verify-cap → charge → record critical section PER INVOICE (D1).
 *
 * The per-idempotency-key lock only serializes retries of the SAME key; two
 * charges with DIFFERENT keys hitting the SAME invoice can both read paid=0,
 * both pass the over-allocation cap, and both charge — overpaying the invoice.
 * This wraps that window in a mutex keyed on the invoice id(s).
 *
 * Acquires a `SET … NX` lock for EVERY invoice id in the allocation set (deduped
 * and SORTED so two overlapping charges can't deadlock by grabbing a shared pair
 * in opposite order), runs `fn`, and releases every acquired lock in a `finally`
 * — even when `fn` throws (the caller's charge/record path already handles its
 * own orphan-charge accounting; the lock just guards the read→write window).
 * If ANY lock can't be acquired (another charge is mid-flight for that invoice),
 * the ones already taken are released by the `finally` and an InvoiceLockedError
 * is thrown (caller → 409, retry).
 *
 * @param {object} redis  ioredis-compatible client (set…NX / del).
 * @param {string} userId  Scopes the lock to one doctor.
 * @param {Array<string|number>} invoiceIds  Invoice ids in the allocation set.
 * @param {() => Promise<any>} fn  The critical section to run under the locks.
 */
export async function withInvoiceLocks(redis, userId, invoiceIds, fn, opts = {}) {
  const ttl = opts.lockTtl ?? INVOICE_LOCK_TTL;
  const log = opts.log;
  // Dedupe + sort → one stable global acquisition order → deadlock-free.
  const ids = [...new Set((invoiceIds || []).map((id) => String(id)))].sort();
  const acquired = [];
  try {
    for (const id of ids) {
      const key = invoiceLockKey(userId, id);
      const ok = await redis.set(key, "1", "EX", ttl, "NX");
      if (!ok) throw new InvoiceLockedError(id);
      acquired.push(key);
    }
    return await fn();
  } finally {
    // Release only what we actually took (a failed acquire was never pushed).
    for (const key of acquired) {
      await redis.del(key).catch((delErr) => log?.warn?.({ delErr, key }, "invoice lock release failed"));
    }
  }
}

export function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Cache-key the result of an idempotent operation lives under. */
export const idemResultKey = (key) => `idem:result:${key}`;
/** Lock-key held while an idempotent operation is in flight. */
export const idemLockKey = (key) => `idem:lock:${key}`;

/**
 * Idempotency wrapper around a charge-producing `fn`, using a SET NX lock + a
 * result cache (works against the ioredis-compatible kv shim).
 *
 *   1. Replay: if a cached result exists for `key`, return it verbatim — `fn`
 *      never runs, no charge happens.
 *   2. Lock: acquire `SET lockKey 1 EX <ttl> NX`. On contention (another request
 *      holds the lock and there's no cached result yet) throw ChargeInProgressError.
 *   3. Run: await `fn()`. On rejection, release the lock (best-effort) so a
 *      legitimate retry can proceed, and rethrow the original error.
 *   4. Cache: persist `fn`'s resolved value under resultKey (guarded — the charge
 *      already succeeded, so a cache-write failure must NEVER surface as an error).
 *
 * Returns `{ result, replayed, cacheWriteFailed }`.
 *
 * @param {object} redis  ioredis-compatible client (get/set/del).
 * @param {string} key    Idempotency key (already namespaced by the caller).
 * @param {() => Promise<any>} fn  Produces the result to cache.
 */
export async function withIdempotency(redis, key, fn, opts = {}) {
  const lockTtl = opts.lockTtl ?? IDEMPOTENCY_LOCK_TTL;
  const resultTtl = opts.resultTtl ?? IDEMPOTENCY_RESULT_TTL;
  const log = opts.log;
  const resultKey = idemResultKey(key);
  const lockKey = idemLockKey(key);

  // 1. Replay a cached result without charging. Also honor any legacy keys so a
  //    result cached under a previous key format (e.g. before the key was
  //    namespaced by user id) still replays across the deploy instead of
  //    re-charging the card.
  const cached = safeParse(await redis.get(resultKey));
  if (cached) {
    log?.info?.({ key }, "idempotent replay — returning cached result, no charge");
    return { result: cached, replayed: true, cacheWriteFailed: false };
  }
  for (const legacyKey of opts.legacyKeys || []) {
    const legacyCached = safeParse(await redis.get(idemResultKey(legacyKey)));
    if (legacyCached) {
      log?.info?.({ key, legacyKey }, "idempotent replay (legacy key) — returning cached result, no charge");
      return { result: legacyCached, replayed: true, cacheWriteFailed: false };
    }
  }

  // 2. Acquire the in-flight lock (atomic set-if-absent + TTL).
  const acquired = await redis.set(lockKey, "1", "EX", lockTtl, "NX");
  if (!acquired) {
    // A concurrent request is mid-charge. It may have just finished — re-check
    // the cache before declaring contention.
    const raced = safeParse(await redis.get(resultKey));
    if (raced) return { result: raced, replayed: true, cacheWriteFailed: false };
    throw new ChargeInProgressError();
  }

  // 3. Run the charge-producing fn. Release the lock on failure so the caller
  //    can legitimately retry; a kv failure here must not mask the real error.
  let result;
  try {
    result = await fn();
  } catch (err) {
    await redis.del(lockKey).catch((delErr) => log?.warn?.({ delErr, key }, "idempotency lock release failed"));
    throw err;
  }

  // 4. Cache the success (guarded — the charge already landed).
  let cacheWriteFailed = false;
  try {
    await redis.set(resultKey, JSON.stringify(result), "EX", resultTtl);
  } catch (cacheErr) {
    cacheWriteFailed = true;
    log?.warn?.({ cacheErr, key }, "idempotency result cache write failed — charge already succeeded");
  }

  return { result, replayed: false, cacheWriteFailed };
}

/**
 * Pull a user-safe decline message out of an Authorize.net error response.
 * Prefers the per-transaction decline text, then the top-level message text.
 * Returns null when nothing usable is present (caller treats that as a system /
 * gateway error rather than a card decline).
 */
export function extractDeclineMessage(authNetResponse) {
  if (!authNetResponse || typeof authNetResponse !== "object") return null;
  const txnErr = authNetResponse.transactionResponse?.errors?.[0]?.errorText;
  if (txnErr) return String(txnErr);
  const msg = authNetResponse.messages?.message?.[0]?.text;
  return msg ? String(msg) : null;
}
