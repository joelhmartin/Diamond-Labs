import { carrierRequest, TIMEOUTS } from "./carrier-http.js";
import { CarrierError } from "./shipping-errors.js";

// Both carriers answer token errors in different shapes; take what is there.
const parseTokenError = (b) => ({
  code: b?.error || b?.errors?.[0]?.code || b?.response?.errors?.[0]?.code,
  message: b?.error_description || b?.errors?.[0]?.message || b?.response?.errors?.[0]?.message,
});

/**
 * THE one OAuth2 client-credentials token request, for UPS and FedEx. Feed it
 * to `tokenCache.get(key, () => requestClientCredentialsToken(...))`.
 *
 * `authStyle`:
 *   "basic" (UPS)  Authorization: Basic base64(id:secret), body grant_type only.
 *   "body" (FedEx) grant_type, client_id and client_secret in the form body.
 *
 * Returns { accessToken, expiresInSec }. Neither the secret nor the token is
 * ever logged or put in an error message.
 */
export async function requestClientCredentialsToken({
  carrier, fetchImpl, url, clientId, clientSecret, authStyle, headers = {}, timeoutMs = TIMEOUTS.token,
}) {
  const form = { grant_type: "client_credentials" };
  const reqHeaders = { ...headers };
  if (authStyle === "basic") {
    reqHeaders.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else if (authStyle === "body") {
    form.client_id = clientId;
    form.client_secret = clientSecret;
  } else {
    throw new TypeError(`unknown OAuth auth style: ${authStyle}`);
  }
  const body = await carrierRequest({
    carrier, fetchImpl, url, headers: reqHeaders, form, timeoutMs, parseError: parseTokenError,
  });
  const accessToken = typeof body?.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new CarrierError(carrier, "BAD_RESPONSE", "The token response had no access token.");
  const expiresInSec = Number(body.expires_in);
  if (!Number.isFinite(expiresInSec) || expiresInSec <= 0) {
    throw new CarrierError(carrier, "BAD_RESPONSE", "The token response had no usable lifetime.");
  }
  return { accessToken, expiresInSec };
}
