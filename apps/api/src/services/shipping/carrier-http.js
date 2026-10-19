import { CARRIER_LABELS } from "@my-app/shared";
import { CarrierError } from "./shipping-errors.js";

/** Per-call budgets (ms). Rating 10s per carrier and purchase 30s come from the spec. */
export const TIMEOUTS = { token: 10_000, rate: 10_000, purchase: 30_000, void: 15_000, track: 15_000 };

const MAX_MESSAGE = 300;

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * THE one HTTP call to a carrier: JSON (or a form body, for OAuth) out, JSON
 * in, bounded by AbortSignal.timeout. Every failure becomes a CarrierError
 * carrying the carrier's own code and text (`parseError(body) → { code, message }`).
 * Bodies are never logged or attached.
 *
 * `purchase: true` marks failures after which the label may nonetheless exist
 * as `uncertain`: a timeout, a network error, a 5xx, or a 2xx we can't read.
 * A 4xx is a definite refusal.
 */
export async function carrierRequest({
  carrier, fetchImpl, url, method = "POST", headers = {}, json, form, timeoutMs, purchase = false, parseError = () => ({}),
}) {
  const label = CARRIER_LABELS[carrier] ?? carrier;
  const init = { method, headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) };
  if (form) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
  } else if (json !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  }

  let res;
  let text;
  try {
    res = await fetchImpl(url, init);
    text = await res.text();
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new CarrierError(
      carrier,
      timedOut ? "TIMEOUT" : "NETWORK",
      timedOut ? `${label} did not answer within ${Math.round(timeoutMs / 1000)}s.` : `${label} could not be reached.`,
      { timedOut, uncertain: purchase },
    );
  }

  const data = parseJson(text);
  if (!res.ok) {
    const e = (data && parseError(data)) || {};
    throw new CarrierError(
      carrier,
      String(e.code || `HTTP_${res.status}`).slice(0, 60),
      String(e.message || `${label} returned HTTP ${res.status}.`).slice(0, MAX_MESSAGE),
      { httpStatus: res.status, uncertain: purchase && res.status >= 500 },
    );
  }
  if (data === null) {
    throw new CarrierError(carrier, "BAD_RESPONSE", `${label} sent a response we couldn't read.`, { httpStatus: res.status, uncertain: purchase });
  }
  return data;
}
