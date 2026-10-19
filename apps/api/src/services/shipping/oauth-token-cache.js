/**
 * OAuth client-credentials tokens for every carrier: ONE implementation.
 * Cached per key (`<carrier>:<environment>`), refreshed 60 seconds before
 * `expires_in` (or at half its life, if shorter), and fetched single-flight:
 * concurrent callers share one token request. FedEx locks its token endpoint
 * for 10 minutes above ~1 request/second, so a token is never fetched per call.
 */
export const REFRESH_EARLY_MS = 60_000;

export function createTokenCache({ now = () => Date.now() } = {}) {
  const tokens = new Map(); // key → { accessToken, refreshAt }
  const inflight = new Map(); // key → Promise<string>

  async function get(key, fetchToken) {
    const hit = tokens.get(key);
    if (hit && now() < hit.refreshAt) return hit.accessToken;
    if (inflight.has(key)) return inflight.get(key);
    const pending = (async () => {
      try {
        const { accessToken, expiresInSec } = await fetchToken();
        const lifeMs = Number(expiresInSec) * 1000;
        if (!accessToken || !Number.isFinite(lifeMs) || lifeMs <= 0) throw new TypeError("token response had no access token or lifetime");
        tokens.set(key, { accessToken, refreshAt: now() + lifeMs - Math.min(REFRESH_EARLY_MS, lifeMs / 2) });
        return accessToken;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, pending);
    return pending;
  }

  function clear(key) {
    if (key) tokens.delete(key);
    else tokens.clear();
  }

  return { get, clear };
}

/** The process-wide cache the app's adapters share. */
export const sharedTokenCache = createTokenCache();
