import { maskPhone } from "@my-app/shared";

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
      log(`[SMS] to=${maskPhone(to)} len=${String(body ?? "").length}`);
      return { ok: true, providerId: "log" };
    },
  };
}
