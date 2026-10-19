import { createId } from "../../../lib/id.js";
import { carrierRequest, TIMEOUTS } from "../carrier-http.js";
import { requestClientCredentialsToken } from "../oauth-client-credentials.js";
import { CarrierError, carrierProblem } from "../shipping-errors.js";
import { sharedTokenCache } from "../oauth-token-cache.js";
import { missingConfigReason } from "../carrier-config.js";
import { emptyTrackResult } from "./carrier-util.js";
import { upsPaths, upsRateRequest, upsShipRequest } from "./ups-requests.js";
import { parseUpsError, parseUpsRates, parseUpsLabel, parseUpsVoid, parseUpsTrack } from "./ups-responses.js";

/** UPS behind the carrier adapter interface (carrier-registry.js). Plain fetch; no UPS SDK exists worth using. */
export function createUpsAdapter({ config, fetchImpl = globalThis.fetch, tokenCache = sharedTokenCache }) {
  const cfg = config.ups;
  const tokenKey = `ups:${config.carrierEnv}`;
  const url = (path) => `${cfg.host}${path}`;
  const request = (opts) => carrierRequest({ carrier: "ups", fetchImpl, parseError: parseUpsError, ...opts });

  const token = () =>
    tokenCache.get(tokenKey, () =>
      requestClientCredentialsToken({
        carrier: "ups", fetchImpl, url: url(upsPaths.token), authStyle: "basic",
        clientId: cfg.clientId, clientSecret: cfg.clientSecret, headers: { "x-merchant-id": cfg.accountNumber },
      }));

  async function authed(opts) {
    const headers = { Authorization: `Bearer ${await token()}`, transId: createId().slice(0, 32), transactionSrc: "diamond-labs" };
    try {
      return await request({ ...opts, headers });
    } catch (err) {
      if (err instanceof CarrierError && err.httpStatus === 401) tokenCache.clear(tokenKey);
      throw err;
    }
  }

  return {
    id: "ups",
    label: "UPS",
    tracks: true,
    configured() {
      const reason = missingConfigReason(
        "UPS",
        { UPS_CLIENT_ID: cfg.clientId, UPS_CLIENT_SECRET: cfg.clientSecret, UPS_ACCOUNT_NUMBER: cfg.accountNumber },
        config.shipFrom,
      );
      return reason ? { ok: false, reason } : { ok: true };
    },
    async rate({ shipFrom, shipTo, parcel }) {
      const body = await authed({ url: url(upsPaths.rate), json: upsRateRequest({ shipFrom, shipTo, parcel, accountNumber: cfg.accountNumber }), timeoutMs: TIMEOUTS.rate });
      return parseUpsRates(body);
    },
    async createLabel({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat = config.labelFormat }) {
      const body = await authed({
        url: url(upsPaths.ship),
        json: upsShipRequest({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat, accountNumber: cfg.accountNumber }),
        timeoutMs: TIMEOUTS.purchase,
        purchase: true,
      });
      const label = parseUpsLabel(body, { serviceCode, labelFormat });
      if (!label) throw new CarrierError("ups", "BAD_RESPONSE", "UPS accepted the shipment but its label couldn't be read.", { uncertain: true });
      return label;
    },
    async voidLabel({ carrierShipmentId }) {
      try {
        return parseUpsVoid(await authed({ method: "DELETE", url: url(upsPaths.void(carrierShipmentId)), timeoutMs: TIMEOUTS.void }));
      } catch (err) {
        if (err instanceof CarrierError) return { ok: false, reason: err.message };
        throw err;
      }
    },
    async track(trackingNumbers) {
      const out = [];
      // UPS tracks one inquiry number per request.
      for (const n of trackingNumbers) {
        try {
          out.push(parseUpsTrack(await authed({ method: "GET", url: url(upsPaths.track(n)), timeoutMs: TIMEOUTS.track }), n));
        } catch (err) {
          if (!(err instanceof CarrierError)) throw err;
          out.push({ ...emptyTrackResult(n), error: carrierProblem(err) });
        }
      }
      return out;
    },
  };
}
