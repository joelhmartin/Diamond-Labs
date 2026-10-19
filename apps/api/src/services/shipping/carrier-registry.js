import { env } from "../../config/env.js";
import { carrierConfig } from "./carrier-config.js";
import { sharedTokenCache } from "./oauth-token-cache.js";
import { ShippingError } from "./shipping-errors.js";
import { createUpsAdapter } from "./carriers/ups.adapter.js";
import { createFedexAdapter } from "./carriers/fedex.adapter.js";
import { createManualAdapter } from "./carriers/manual.adapter.js";

/**
 * Every carrier the system can use. Adding or swapping a carrier means one
 * adapter (carriers/*.adapter.js, the interface in adapter-contract.test.js)
 * and one line here. A carrier with missing configuration is simply disabled;
 * it never fails at boot.
 */
const FACTORIES = {
  ups: createUpsAdapter,
  fedex: createFedexAdapter,
  manual: createManualAdapter,
};

export const CARRIER_IDS = Object.keys(FACTORIES);

/** The keys every createLabel result has (adapter-contract.test.js). */
export const LABEL_RESULT_KEYS = [
  "trackingNumber", "carrierShipmentId", "labelFormat", "labelData", "chargeCents", "currency", "serviceCode", "serviceName",
];

export function createRegistry({ config, fetchImpl = globalThis.fetch, tokenCache = sharedTokenCache }) {
  const adapters = new Map(CARRIER_IDS.map((id) => [id, FACTORIES[id]({ config, fetchImpl, tokenCache })]));
  return {
    get(id) {
      const adapter = adapters.get(id);
      if (!adapter) throw new ShippingError("INVALID", `Unknown carrier: ${id}`);
      return adapter;
    },
    all: () => [...adapters.values()],
    enabled: () => [...adapters.values()].filter((a) => a.configured().ok),
    /** For the Carriers panel: each carrier's state and, when disabled, why. */
    status: () => [...adapters.values()].map((a) => ({ id: a.id, label: a.label, tracks: a.tracks, ...a.configured() })),
  };
}

let shared = null;

/** The app's registry, built once from env. */
export function carrierRegistry() {
  shared ??= createRegistry({ config: carrierConfig(env) });
  return shared;
}
