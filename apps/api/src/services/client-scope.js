import { and, eq, inArray } from "drizzle-orm";
import { ERROR_CODES } from "@my-app/shared";
import { db as appDb } from "../config/database.js";
import { accounts } from "../db/schema/index.js";
import { organizations } from "../modules/organizations/index.js";
import { organizationsService } from "./organizations.service.js";
import { directPracticeMembershipsQuery } from "./practice-of.js";
import { clientScopeOf, emptyClientScope, toClientScope } from "./client-scope-rules.js";

/**
 * THE client authorization seam (piece 11, spec "Authorization seam"). Every
 * client-facing read or write of an invoice, case, payment, pickup, message
 * thread or statement asks this file (or its pure half, client-scope-rules.js)
 * which practices the login may see and pay. Nothing compares
 * users.seazonaClientId for authorization (routes/__tests__/no-seazona-authz.test.js).
 *
 * A practice is a client account (`accounts.is_client`). A login reaches one
 * through an ACTIVE direct membership (practice-of.js, the one definition), or
 * as an ACTIVE admin of the ACTIVE organization (group) the practice is in.
 *
 * `authenticate` loads the scope from the DB on every request and sets
 * `request.user.scope`. It is never cached (not in the token, Redis or the
 * browser), so a removed member loses access on their next request.
 */

export { emptyClientScope, toClientScope, clientScopeOf, canActForAccount, requestedAccounts, isAllAccounts, payableAccountIds, administersAPractice, scopeNotFound, practiceRequired, requestedStatementSubject } from "./client-scope-rules.js";

/** Of a list of candidate accounts, those that are active client accounts (one query): the scope's eligibility, also the alert audience's. */
export async function activeClientAccounts(ids, database) {
  if (!ids.length) return [];
  const rows = await database
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(inArray(accounts.id, ids), eq(accounts.status, "active"), eq(accounts.isClient, true)));
  return rows.map((r) => r.id);
}

/** Name and combined-statement setting of the groups a login administers (only queried for group admins). */
async function organizationDetails(orgIds, database) {
  if (!orgIds.length) return new Map();
  const rows = await database
    .select({ id: organizations.id, name: organizations.name, settings: organizations.settings })
    .from(organizations)
    .where(inArray(organizations.id, orgIds));
  return new Map(rows.map((r) => [r.id, { name: r.name, combinedStatement: r.settings?.combinedStatement === true }]));
}

/**
 * The practices `userId` may see and pay, read live. A plain practice member
 * costs two queries (memberships, group-admin grants); a group admin two more
 * (the group's accounts and their eligibility, plus group names). Never N.
 *
 * @returns {Promise<import("./client-scope-rules.js").ClientScope>}
 */
export async function loadClientScope(userId, database = appDb) {
  if (!userId) return emptyClientScope();
  // Direct memberships come back already filtered to active client accounts,
  // so only organization-granted accounts need the eligibility query.
  const direct = new Set();
  const resolved = await organizationsService.scopeForUser(userId, {
    loadMemberships: async (uid) => {
      const rows = await directPracticeMembershipsQuery(database, uid);
      for (const r of rows) direct.add(r.accountId);
      return rows.map((r) => ({ accountId: r.accountId, role: r.role, status: "active", accountActive: true }));
    },
    eligibleAccounts: async (ids) => {
      const unknown = ids.filter((id) => !direct.has(id));
      return new Set([...ids.filter((id) => direct.has(id)), ...(await activeClientAccounts(unknown, database))]);
    },
  }, database);
  return toClientScope(resolved, await organizationDetails(resolved.organizations.map((o) => o.id), database));
}

/**
 * The client-portal guard: a login with at least one practice in scope, or an
 * approved doctor (a doctor not yet given a practice gets empty lists, never
 * someone else's data). Rx submit stays doctor-only (requireApprovedDoctor).
 * Re-exported from middleware/require-role.js.
 */
export async function requireClientPortal(request, reply) {
  const user = request.user;
  const scoped = clientScopeOf(user).accountIds.length > 0;
  const approvedDoctor = user?.role === "doctor" && user?.approvalStatus === "approved";
  if (user && (scoped || approvedDoctor)) return undefined;
  return reply.code(403).send({
    error: { ...ERROR_CODES.FORBIDDEN, message: "Client portal access required." },
  });
}
