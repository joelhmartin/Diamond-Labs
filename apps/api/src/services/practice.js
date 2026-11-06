import { clientScopeOf, isAllAccounts, practiceRequired, requestedAccounts } from "./client-scope-rules.js";

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

/**
 * The key a client's NEW thread or pickup gets. `accountId` names a practice in
 * the login's scope (anything else: 404, as requestedAccounts). Without one
 * (absent or "all"): the default key, except that a login with several
 * practices must choose (422 "Choose a practice.").
 */
export function newPartyKey(user, accountId) {
  const scope = clientScopeOf(user);
  if (!isAllAccounts(accountId)) return practiceKeyFor({ accountId: requestedAccounts(scope, accountId)[0] });
  if (scope.accountIds.length > 1) throw practiceRequired();
  return defaultPartyKey(user);
}

/** A practice (client account) as staff and clients read it: "Name (account number)". */
export function practiceLabel({ name, accountNumber } = {}) {
  const n = String(name ?? "").trim();
  const num = String(accountNumber ?? "").trim();
  if (n && num) return `${n} (${num})`;
  return n || num;
}

/** "practice:X" → { practice: "X" }, "user:Y" → { userId: "Y" }, anything else → null. */
export function parsePartyKey(key) {
  const m = /^(practice|user):(.+)$/.exec(String(key ?? ""));
  if (!m) return null;
  return m[1] === "practice" ? { practice: m[2] } : { userId: m[2] };
}
