/**
 * Party keys: the "practice" a doctor belongs to, as strings the generic
 * modules (notifications, messaging) can store and compare without knowing
 * what a practice is.
 *
 * They restate canActOnInvoice (services/billing/invoice-rules.js) as keys:
 * a doctor may act for another doctor's records exactly when
 * partyKeysFor(requester) includes practiceKeyFor(owner). practice.test.js
 * holds the two in step. There is no practice entity yet, so the practice is
 * the shared seazonaClientId; when a real one arrives, only this file changes.
 */

/** "practice:<seazonaClientId>", or "user:<id>" for a doctor with none. */
export function practiceKeyFor(user) {
  return user?.seazonaClientId ? `practice:${user.seazonaClientId}` : `user:${user?.id}`;
}

/** Every key this user may act for: always their own, plus their practice's. */
export function partyKeysFor(user) {
  const keys = [`user:${user?.id}`];
  if (user?.seazonaClientId) keys.push(`practice:${user.seazonaClientId}`);
  return keys;
}

/** "practice:X" → { practice: "X" }, "user:Y" → { userId: "Y" }, anything else → null. */
export function parsePartyKey(key) {
  const m = /^(practice|user):(.+)$/.exec(String(key ?? ""));
  if (!m) return null;
  return m[1] === "practice" ? { practice: m[2] } : { userId: m[2] };
}
