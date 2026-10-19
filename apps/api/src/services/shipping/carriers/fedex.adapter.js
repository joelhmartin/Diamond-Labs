import { TIMEOUTS } from "../carrier-http.js";
import { CarrierError, carrierProblem } from "../shipping-errors.js";
import { sharedTokenCache } from "../oauth-token-cache.js";
import { createOAuthCore } from "./oauth-adapter.js";
import { emptyTrackResult } from "./carrier-util.js";
import {
  fedexPaths, FEDEX_CANCEL_METHOD, FEDEX_TRACK_BATCH, fedexRateRequest, fedexShipRequest, fedexCancelRequest, fedexTrackRequest,
} from "./fedex-requests.js";
import { parseFedexError, parseFedexRates, parseFedexLabel, parseFedexCancel, parseFedexTrack, fedexAlreadyCancelled } from "./fedex-responses.js";

/** FedEx behind the carrier adapter interface (carrier-registry.js). Plain fetch; FedEx has no official Node client. */
export function createFedexAdapter({ config, fetchImpl = globalThis.fetch, tokenCache = sharedTokenCache }) {
  const cfg = config.fedex;
  // FedEx locks its token endpoint for 10 minutes above ~1 rps: the core only reaches it through the cache.
  const { url, authed, configured, safeVoid } = createOAuthCore({
    carrier: "fedex", label: "FedEx", config, creds: { host: cfg.host, clientId: cfg.apiKey, clientSecret: cfg.secretKey },
    fetchImpl, tokenCache, parseError: parseFedexError, tokenPath: fedexPaths.token, tokenOptions: { authStyle: "body" },
    required: { FEDEX_API_KEY: cfg.apiKey, FEDEX_SECRET_KEY: cfg.secretKey, FEDEX_ACCOUNT_NUMBER: cfg.accountNumber },
    alreadyVoided: fedexAlreadyCancelled,
    authHeaders: () => ({ "X-locale": "en_US" }),
  });

  async function trackBatch(numbers) {
    try {
      const byNumber = new Map(parseFedexTrack(await authed({ url: url(fedexPaths.track), json: fedexTrackRequest(numbers), timeoutMs: TIMEOUTS.track }))
        .map((r) => [r.trackingNumber, r]));
      return numbers.map((n) => byNumber.get(n) ?? { ...emptyTrackResult(n), error: { carrier: "fedex", code: "NO_RESULT", message: "FedEx returned no result for this number." } });
    } catch (err) {
      if (!(err instanceof CarrierError)) throw err;
      return numbers.map((n) => ({ ...emptyTrackResult(n), error: carrierProblem(err) }));
    }
  }

  return {
    id: "fedex",
    label: "FedEx",
    tracks: true,
    configured,
    async rate({ shipFrom, shipTo, parcel }) {
      return parseFedexRates(await authed({ url: url(fedexPaths.rate), json: fedexRateRequest({ shipFrom, shipTo, parcel, accountNumber: cfg.accountNumber }), timeoutMs: TIMEOUTS.rate }));
    },
    async createLabel({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat = config.labelFormat }) {
      const body = await authed({
        url: url(fedexPaths.ship),
        json: fedexShipRequest({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat, accountNumber: cfg.accountNumber }),
        timeoutMs: TIMEOUTS.purchase,
        purchase: true,
      });
      const label = parseFedexLabel(body, { serviceCode, labelFormat });
      if (!label) throw new CarrierError("fedex", "BAD_RESPONSE", "FedEx accepted the shipment but its label couldn't be read.", { uncertain: true });
      return label;
    },
    async voidLabel({ trackingNumber }) {
      return safeVoid(async () => parseFedexCancel(await authed({
        method: FEDEX_CANCEL_METHOD, url: url(fedexPaths.cancel),
        json: fedexCancelRequest({ trackingNumber, accountNumber: cfg.accountNumber }), timeoutMs: TIMEOUTS.void,
      })));
    },
    async track(trackingNumbers) {
      const out = [];
      for (let i = 0; i < trackingNumbers.length; i += FEDEX_TRACK_BATCH) out.push(...(await trackBatch(trackingNumbers.slice(i, i + FEDEX_TRACK_BATCH))));
      return out;
    },
  };
}
