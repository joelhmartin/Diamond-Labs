import { ERROR_CODES } from "@my-app/shared";

/**
 * The pure half of the client-scope seam (services/client-scope.js loads it).
 * No DB: every client authorization decision (which practices a login may
 * read, which it may pay, which `?account=` it may ask for) is decided here
 * from a ClientScope, so the rules are unit-tested without a database.
 *
 * ClientScope:
 *   { accountIds: string[]                       every practice this login may see (sorted)
 *     payable: Set<accountId>                    the subset it may pay (not "viewer")
 *     via: Map<accountId, "member"|"org-admin">
 *     roles: Map<accountId, membershipRole|"org-admin">
 *     organizations: [{ id, name, combinedStatement, accountIds }] }  groups the login is an active admin of
 *
 * @typedef {{ accountIds: string[], payable: Set<string>, via: Map<string, string>, roles: Map<string, string>,
 *             organizations: { id: string, name: string|null, combinedStatement: boolean, accountIds: string[] }[] }} ClientScope
 */

/** The scope of a login with no practice: sees nothing, pays nothing. */
export function emptyClientScope() {
  return { accountIds: [], payable: new Set(), via: new Map(), roles: new Map(), organizations: [] };
}

/** The scope on an authenticated request's user (set by authenticate); an unscoped user sees nothing. */
export const clientScopeOf = (user) => user?.scope ?? emptyClientScope();

/**
 * A ClientScope from organizations.resolveScope's result. `payable` is every
 * account whose role is not "viewer" (a group admin's role is "org-admin", so
 * group admins may always pay). `orgDetails` is `Map<orgId, { name, combinedStatement }>`.
 */
export function toClientScope(resolved, orgDetails = new Map()) {
  const accountIds = [...(resolved?.accountIds ?? [])];
  const roles = new Map(resolved?.roles ?? []);
  const payable = new Set(accountIds.filter((id) => roles.get(id) !== "viewer"));
  const organizations = (resolved?.organizations ?? []).map((o) => ({
    id: o.id,
    name: orgDetails.get(o.id)?.name ?? null,
    combinedStatement: orgDetails.get(o.id)?.combinedStatement === true,
    accountIds: [...o.accountIds],
  }));
  return { accountIds, payable, via: new Map(resolved?.via ?? []), roles, organizations };
}

/**
 * May this login act for `accountId`? Reading needs the account in scope;
 * `pay` also needs it payable (a "viewer" member may read, not pay). A null
 * account (a record the backfill has not reached) is never in scope: it fails
 * closed, so only staff see it.
 */
export function canActForAccount(scope, accountId, { pay = false } = {}) {
  if (accountId == null || !scope?.accountIds?.includes(accountId)) return false;
  return pay ? Boolean(scope.payable?.has(accountId)) : true;
}

/**
 * The accounts this login may PAY, in scope order: what AutoPay sweeps and
 * what a payment for this login can be applied to (a "viewer" practice is
 * readable, never payable).
 */
export function payableAccountIds(scope) {
  return (scope?.accountIds ?? []).filter((id) => scope.payable?.has(id));
}

/** Does this `?account=` value ask for the whole scope (absent, empty or "all")? The one test requestedAccounts uses. */
export function isAllAccounts(param) {
  return param == null || param === "" || param === "all";
}

/** 404 NOT_FOUND as an app error (the error handler sends statusCode + code). */
export function scopeNotFound() {
  const err = new Error(ERROR_CODES.NOT_FOUND.message);
  err.statusCode = ERROR_CODES.NOT_FOUND.status;
  err.code = ERROR_CODES.NOT_FOUND.code;
  return err;
}

/**
 * The accounts a `?account=` value asks for, never wider than the scope:
 *  - absent, empty or "all" → every account in scope (possibly none);
 *  - an id in scope         → [id];
 *  - anything else          → throws 404 NOT_FOUND (out of scope reads the
 *    same as nonexistent, so ids can't be probed). That includes
 *    "organization:<id>": the combined statement parses that form itself
 *    (statements only); every other caller refuses it here.
 */
export function requestedAccounts(scope, param) {
  const all = [...(scope?.accountIds ?? [])];
  if (isAllAccounts(param)) return all;
  if (typeof param === "string" && all.includes(param)) return [param];
  throw scopeNotFound();
}
