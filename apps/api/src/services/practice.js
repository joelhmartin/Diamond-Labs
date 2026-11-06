import { practiceKeyFor } from "@my-app/shared";
import { clientScopeOf, isAllAccounts, practiceRequired, requestedAccounts } from "./client-scope-rules.js";

// The label and key helpers live in packages/shared (the web portal uses the same ones).
export { practiceKeyFor, practiceLabel, parsePartyKey } from "@my-app/shared";

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

/**
 * A client naming the key of a NEW general thread: their own `user:<id>` key
 * is a practice-less login's only, so a login with any practice in scope is
 * refused it (422 "Choose a practice."), as newPartyKey refuses "All
 * practices". Without this, naming the own key would sidestep the choice.
 */
export function assertNamedPartyKey(user, partyKey) {
  if (partyKey === `user:${user?.id}` && clientScopeOf(user).accountIds.length > 0) throw practiceRequired();
}
