import { clientScopeOf } from "./client-scope-rules.js";

/**
 * Party keys: the practice a record belongs to, as strings the generic
 * modules (notifications, messaging) can store and compare without knowing
 * what a practice is.
 *
 * They restate the client scope (services/client-scope.js) as keys: a login
 * may act for a record exactly when partyKeysFor(login) includes the record's
 * key. A practice is a client account, so the key is `practice:<accountId>`;
 * a record with no practice (a shopper's own order) is keyed to its owner.
 * practice.test.js holds the keys and canActForAccount in step.
 */

/** "practice:<accountId>", or "user:<ownerId>" when the record has no account. */
export function practiceKeyFor({ accountId = null, ownerId = null } = {}) {
  return accountId ? `practice:${accountId}` : `user:${ownerId}`;
}

/** Every key this login may act for: always their own, plus every practice in their scope (request.user.scope). */
export function partyKeysFor(user) {
  return [`user:${user?.id}`, ...clientScopeOf(user).accountIds.map((accountId) => practiceKeyFor({ accountId }))];
}

/**
 * The key a new thread or pickup gets when the login names no practice: the
 * one practice in scope, else the login's own key. A login with several
 * practices must choose one explicitly (the "All practices" view).
 */
export function defaultPartyKey(user) {
  const { accountIds } = clientScopeOf(user);
  return accountIds.length === 1 ? practiceKeyFor({ accountId: accountIds[0] }) : `user:${user?.id}`;
}

/** "practice:X" → { practice: "X" }, "user:Y" → { userId: "Y" }, anything else → null. */
export function parsePartyKey(key) {
  const m = /^(practice|user):(.+)$/.exec(String(key ?? ""));
  if (!m) return null;
  return m[1] === "practice" ? { practice: m[2] } : { userId: m[2] };
}
