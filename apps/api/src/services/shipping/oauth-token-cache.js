/**
 * OAuth client-credentials tokens for every carrier: ONE implementation.
 * Cached per key (`<carrier>:<environment>`), refreshed 60 seconds before
 * `expires_in` (or at half its life, if shorter), and fetched single-flight:
 * concurrent callers share one token request. After a failed fetch the key is
 * refused for 30 seconds (the failure is rethrown), so bad credentials can't
 * hammer the endpoint; `clear(key)` lifts the cooldown. FedEx locks its token endpoint
 * for 10 minutes above ~1 request/second, so a token is never fetched per call.
 */
export const REFRESH_EARLY_MS = 60_000;
export const FAILURE_COOLDOWN_MS = 30_000;

export function createTokenCache({ now = () => Date.now() } = {}) {
  const tokens = new Map(); // key → { accessToken, refreshAt }
  const inflight = new Map(); // key → Promise<string>
  const failures = new Map(); // key → { error, until }

  async function get(key, fetchToken) {
    const hit = tokens.get(key);
    if (hit && now() < hit.refreshAt) return hit.accessToken;
    const failed = failures.get(key);
    if (failed) {
      if (now() < failed.until) throw failed.error;
      failures.delete(key);
    }
    if (inflight.has(key)) return inflight.get(key);
    const pending = (async () => {
      try {
        const { accessToken, expiresInSec } = await fetchToken();
        const lifeMs = Number(expiresInSec) * 1000;
        if (!accessToken || !Number.isFinite(lifeMs) || lifeMs <= 0) throw new TypeError("token response had no access token or lifetime");
        tokens.set(key, { accessToken, refreshAt: now() + lifeMs - Math.min(REFRESH_EARLY_MS, lifeMs / 2) });
        failures.delete(key);
        return accessToken;
      } catch (error) {
        failures.set(key, { error, until: now() + FAILURE_COOLDOWN_MS });
        throw error;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, pending);
    return pending;
  }

  function clear(key) {
    if (key) {
      tokens.delete(key);
      failures.delete(key);
    } else {
      tokens.clear();
      failures.clear();
    }
  }

  return { get, clear };
}

/** The process-wide cache the app's adapters share. */
export const sharedTokenCache = createTokenCache();
