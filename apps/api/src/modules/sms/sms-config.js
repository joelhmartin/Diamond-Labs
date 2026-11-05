import { isStaging } from "../../config/app-env.js";
import { env as appEnv } from "../../config/env.js";
import { normalizePhone } from "./phone.js";

const PROVIDERS = ["twilio", "log", "off"];

/**
 * Everything the sms module needs, read once from the environment. It holds
 * credentials: never log it, never return it from a route.
 */
export function smsConfig(env = appEnv) {
  return {
    provider: PROVIDERS.includes(env.SMS_PROVIDER) ? env.SMS_PROVIDER : "off",
    staging: isStaging(env),
    stagingTo: normalizePhone(env.STAGING_SMS_TO),
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      from: env.TWILIO_FROM,
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
    },
  };
}

/**
 * Why a provider can't be used, or null. `creds` is keyed by ENV VARIABLE NAME,
 * so the reason names what to set and never echoes a value.
 */
export function missingConfigReason(label, creds) {
  const unset = Object.entries(creds).filter(([, v]) => !String(v ?? "").trim()).map(([k]) => k);
  return unset.length ? `${label}: credentials not set (${unset.join(", ")})` : null;
}
