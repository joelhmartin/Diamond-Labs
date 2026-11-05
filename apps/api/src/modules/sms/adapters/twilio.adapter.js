import { missingConfigReason } from "../sms-config.js";
import { maskPhone } from "@my-app/shared";

const TIMEOUT_MS = 10_000;

/**
 * Twilio Programmable Messaging over plain fetch (no SDK). Either
 * TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM is enough as the sender.
 * Results never carry the auth token.
 */
export function createTwilioAdapter({ config, fetchImpl = globalThis.fetch }) {
  const t = config.twilio ?? {};
  return {
    id: "twilio",
    label: "Twilio",
    configured() {
      const sender = String(t.messagingServiceSid ?? "").trim()
        ? {}
        : { TWILIO_FROM: t.from };
      const reason = missingConfigReason("Twilio", {
        TWILIO_ACCOUNT_SID: t.accountSid,
        TWILIO_AUTH_TOKEN: t.authToken,
        ...sender,
      });
      return reason ? { ok: false, reason } : { ok: true };
    },
    async send({ to, body }) {
      const form = new URLSearchParams({ To: to, Body: body });
      if (String(t.messagingServiceSid ?? "").trim()) form.set("MessagingServiceSid", t.messagingServiceSid);
      else form.set("From", t.from);
      try {
        const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return { ok: true, providerId: data.sid };
        // Twilio's text can embed the destination number (21211): mask it.
        const message = String(data.message ?? "Twilio rejected the message").replace(/\+?\d{8,15}/g, maskPhone);
        return { ok: false, error: `${data.code ?? res.status} ${message}` };
      } catch (err) {
        return { ok: false, error: `Twilio request failed: ${err?.name === "TimeoutError" ? "timed out" : "network error"}` };
      }
    },
  };
}
