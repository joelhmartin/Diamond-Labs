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
 * 422 PRACTICE_REQUIRED "Choose a practice.": a login with several practices
 * creating a thread or pickup in "All practices" must name one.
 */
export function practiceRequired() {
  const err = new Error("Choose a practice.");
  err.statusCode = 422;
  err.code = "PRACTICE_REQUIRED";
  return err;
}

/**
 * The accounts a `?account=` value asks for, never wider than the scope:
 *  - absent, empty or "all" → every account in scope (possibly none);
 *  - an id in scope         → [id];
 *  - anything else          → throws 404 NOT_FOUND (out of scope reads the
 *    same as nonexistent, so ids can't be probed). That includes
 *    "organization:<id>": only requestedStatementSubject (statements) accepts
 *    that form; every other caller refuses it here.
 */
export function requestedAccounts(scope, param) {
  const all = [...(scope?.accountIds ?? [])];
  if (isAllAccounts(param)) return all;
  if (typeof param === "string" && all.includes(param)) return [param];
  throw scopeNotFound();
}

/** The `?account=` prefix that names a group's combined statement (statements only). */
export const ORGANIZATION_SUBJECT_PREFIX = "organization:";

/**
 * Which statement a `?account=` value asks for (GET /invoices/statement.pdf),
 * never wider than the scope:
 *  - "organization:<orgId>" → that group's combined statement, only when the
 *    login is an active admin of the active group (it is in
 *    scope.organizations) AND the group has combinedStatement on; else 404;
 *  - anything else goes through requestedAccounts: exactly one practice →
 *    its statement; none (out of scope, or no practice yet) → 404; several
 *    ("all" with 2+ practices) → 422 "Choose a practice.". A statement is
 *    per practice; practices are never merged except by the combined one.
 * @returns {{ subject: "account", subjectId: string }
 *   | { subject: "organization", subjectId: string, organization: { id, name, combinedStatement, accountIds } }}
 */
export function requestedStatementSubject(scope, param) {
  if (typeof param === "string" && param.startsWith(ORGANIZATION_SUBJECT_PREFIX)) {
    const id = param.slice(ORGANIZATION_SUBJECT_PREFIX.length);
    const org = (scope?.organizations ?? []).find((o) => o.id === id);
    if (!org || org.combinedStatement !== true) throw scopeNotFound();
    return { subject: "organization", subjectId: org.id, organization: { ...org, accountIds: [...org.accountIds] } };
  }
  const ids = requestedAccounts(scope, param);
  if (ids.length === 1) return { subject: "account", subjectId: ids[0] };
  if (ids.length === 0) throw scopeNotFound();
  throw practiceRequired();
}
