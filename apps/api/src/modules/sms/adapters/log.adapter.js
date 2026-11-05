import { maskPhone } from "../phone.js";

/**
 * Development provider: writes one line (masked number and length, never the
 * text) and reports success. Always configured.
 */
export function createLogAdapter({ log = console.log } = {}) {
  return {
    id: "log",
    label: "Log only",
    configured: () => ({ ok: true }),
    async send({ to, body }) {
      log(`[sms:log] to ${maskPhone(to)} (${String(body ?? "").length} chars)`);
      return { ok: true, providerId: "log" };
    },
  };
}
