import { carrierRequest } from "../carrier-http.js";
import { requestClientCredentialsToken } from "../oauth-client-credentials.js";
import { CarrierError } from "../shipping-errors.js";
import { missingConfigReason } from "../carrier-config.js";

/**
 * The plumbing every OAuth client-credentials carrier adapter shares (UPS,
 * FedEx): the cached token, the authed request that drops the token on a 401,
 * `configured()`, and the never-throws void wrapper. Carrier-specific request
 * and response shapes stay in each adapter.
 *
 * `tokenPath`/`tokenOptions` feed requestClientCredentialsToken (authStyle,
 * extra headers); `authHeaders()` adds per-call headers beside the Bearer.
 */
export function createOAuthCore({
  carrier, label, config, creds, fetchImpl, tokenCache, parseError, tokenPath, tokenOptions, required, authHeaders = () => ({}),
}) {
  const tokenKey = `${carrier}:${config.carrierEnv}`;
  const url = (path) => `${creds.host}${path}`;
  const request = (opts) => carrierRequest({ carrier, fetchImpl, parseError, ...opts });

  // Only ever reached through the cache: the carriers rate-limit their token endpoints.
  const token = () =>
    tokenCache.get(tokenKey, () =>
      requestClientCredentialsToken({
        carrier, fetchImpl, url: url(tokenPath), clientId: creds.clientId, clientSecret: creds.clientSecret, ...tokenOptions,
      }));

  async function authed(opts) {
    const headers = { Authorization: `Bearer ${await token()}`, ...authHeaders() };
    try {
      return await request({ ...opts, headers });
    } catch (err) {
      if (err instanceof CarrierError && err.httpStatus === 401) tokenCache.clear(tokenKey);
      throw err;
    }
  }

  /** Env-var name → value; the reason names the missing variables, never a value. */
  function configured() {
    const reason = missingConfigReason(label, required, config.shipFrom);
    return reason ? { ok: false, reason } : { ok: true };
  }

  /** A void reports ok or the carrier's reason; it only throws for non-carrier bugs. */
  async function safeVoid(run) {
    try {
      return await run();
    } catch (err) {
      if (err instanceof CarrierError) return { ok: false, reason: err.message };
      throw err;
    }
  }

  return { url, authed, configured, safeVoid };
}
