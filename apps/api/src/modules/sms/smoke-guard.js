export const TWILIO_TEST_FROM = "+15005550006";

/**
 * Why the smoke script must not send, or null. Without --live only a send that
 * cannot reach a real handset is allowed: the log provider, or Twilio's magic
 * test sender with no messaging service (the adapter prefers the service SID
 * over From, so a set SID could send for real).
 */
export function smokeRefusal(config, { live }) {
  if (live || config.provider === "log") return null;
  const t = config.twilio ?? {};
  const testSender = config.provider === "twilio" && t.from === TWILIO_TEST_FROM && !String(t.messagingServiceSid ?? "").trim();
  return testSender
    ? null
    : `Refusing: without --live the provider must be log, or twilio with TWILIO_FROM=${TWILIO_TEST_FROM} and no TWILIO_MESSAGING_SERVICE_SID (Twilio test credentials).`;
}
