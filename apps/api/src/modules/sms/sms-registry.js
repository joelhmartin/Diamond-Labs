import { env } from "../../config/env.js";
import { smsConfig } from "./sms-config.js";
import { maskPhone, normalizePhone } from "./phone.js";
import { createTwilioAdapter } from "./adapters/twilio.adapter.js";
import { createLogAdapter } from "./adapters/log.adapter.js";

/**
 * Every provider the module can use. Adding one means one adapter
 * (adapters/*.adapter.js, the interface in adapters/adapter-contract.test.js)
 * and one line here. "off" is not a provider: it is the absence of one.
 */
const FACTORIES = {
  twilio: createTwilioAdapter,
  log: createLogAdapter,
};

export const SMS_PROVIDER_IDS = Object.keys(FACTORIES);

export function createSmsAdapters({ config, fetchImpl = globalThis.fetch }) {
  return new Map(SMS_PROVIDER_IDS.map((id) => [id, FACTORIES[id]({ config, fetchImpl })]));
}

const suppressed = (error) => ({ ok: false, suppressed: true, error });

export function createSmsRegistry({ config, fetchImpl = globalThis.fetch }) {
  const adapters = createSmsAdapters({ config, fetchImpl });
  const active = adapters.get(config.provider) ?? null;

  function status() {
    if (!active) return { provider: "off", ok: false, reason: "Text messages are switched off (SMS_PROVIDER=off)" };
    return { provider: active.id, ...active.configured() };
  }

  async function send({ to, body }) {
    const state = status();
    if (!state.ok) return suppressed(state.reason);
    const target = normalizePhone(to);
    if (!target) return { ok: false, error: "Not a valid phone number" };
    let text = String(body ?? "");
    let dest = target;
    if (config.staging) {
      if (!config.stagingTo) return suppressed("Staging: STAGING_SMS_TO is not set, text not sent");
      text = `[STAGING → ${maskPhone(target)}] ${text}`;
      dest = config.stagingTo;
    }
    try {
      return await active.send({ to: dest, body: text });
    } catch (err) {
      return { ok: false, error: `${active.label} failed: ${err?.name ?? "error"}` };
    }
  }

  return { status, send };
}

let shared = null;

/** The app's registry, built once from env. */
export function smsRegistry() {
  shared ??= createSmsRegistry({ config: smsConfig(env) });
  return shared;
}
