import { env as appEnv } from "../../config/env.js";
import { effectiveCarrierEnv } from "../../config/app-env.js";
import { labIdentity } from "../../config/lab-identity.js";

const HOSTS = {
  ups: { sandbox: "https://wwwcie.ups.com", production: "https://onlinetools.ups.com" },
  fedex: { sandbox: "https://apis-sandbox.fedex.com", production: "https://apis.fedex.com" },
};

/**
 * Everything the adapters need, read once from the environment. It holds
 * credentials: never log it, never return it from a route.
 */
export function carrierConfig(env = appEnv) {
  const carrierEnv = effectiveCarrierEnv(env);
  const lab = labIdentity(env);
  return {
    carrierEnv,
    labelFormat: env.LABEL_FORMAT === "zpl" ? "zpl" : "image",
    shipFrom: lab.address,
    shipFromMissing: lab.missing,
    ups: { clientId: env.UPS_CLIENT_ID, clientSecret: env.UPS_CLIENT_SECRET, accountNumber: env.UPS_ACCOUNT_NUMBER, host: HOSTS.ups[carrierEnv] },
    fedex: { apiKey: env.FEDEX_API_KEY, secretKey: env.FEDEX_SECRET_KEY, accountNumber: env.FEDEX_ACCOUNT_NUMBER, host: HOSTS.fedex[carrierEnv] },
  };
}

/**
 * Why a carrier can't be used, or null. `creds` is keyed by ENV VARIABLE NAME,
 * so the reason names what to set and never echoes a value.
 */
export function missingConfigReason(label, creds, shipFrom) {
  const unset = Object.entries(creds).filter(([, v]) => !String(v ?? "").trim()).map(([k]) => k);
  if (unset.length) return `${label}: credentials not set (${unset.join(", ")})`;
  if (!shipFrom) return `${label}: ship-from address not configured (set LAB_ADDRESS_LINE1, LAB_CITY, LAB_STATE, LAB_ZIP and LAB_PHONE)`;
  return null;
}
