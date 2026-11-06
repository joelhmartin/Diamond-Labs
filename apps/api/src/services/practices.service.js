import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db as appDb } from "../config/database.js";
import { accounts, memberships } from "../db/schema/index.js";
import { organizations, organizationAccounts } from "../modules/organizations/index.js";
import { containsPattern } from "../lib/list-query.js";
import { directPracticeIdsQuery } from "./practice-of.js";

/**
 * Practices: the client accounts (`accounts.is_client`). Admin > Practices and
 * the staff order-entry practice picker read this list; editing and members
 * arrive with the practices admin routes.
 *
 * Filters: `q` (name or account number), `organizationId`, `missingNumber`
 * (no lab account number yet) and `memberUserId` (the practices that login can create records for:
 * active direct membership in an active client account). Returns `{ rows, total }`; each row is
 * `{ id, name, accountNumber, organization: { id, name } | null, memberCount }`.
 */
export async function listPractices({ q, organizationId, missingNumber, memberUserId, limit = 25, offset = 0 } = {}, database = appDb) {
  const conds = [eq(accounts.isClient, true), ne(accounts.status, "deleted")];
  if (q?.trim()) {
    const like = containsPattern(q.trim());
    conds.push(or(ilike(accounts.name, like), ilike(accounts.accountNumber, like)));
  }
  if (organizationId) conds.push(eq(organizationAccounts.organizationId, organizationId));
  if (missingNumber === true) conds.push(or(sql`${accounts.accountNumber} is null`, eq(accounts.accountNumber, "")));
  // The same query practiceForNewRecord validates against, so a picker never offers a practice the create path would refuse.
  if (memberUserId) conds.push(inArray(accounts.id, directPracticeIdsQuery(database, memberUserId)));
  const where = and(...conds);
  const base = (select) => database
    .select(select)
    .from(accounts)
    .leftJoin(organizationAccounts, eq(organizationAccounts.accountId, accounts.id))
    .leftJoin(organizations, eq(organizations.id, organizationAccounts.organizationId))
    .where(where);

  const rows = await base({
    id: accounts.id, name: accounts.name, accountNumber: accounts.accountNumber,
    organizationId: organizations.id, organizationName: organizations.name,
    memberCount: sql`(select count(*)::int from ${memberships} m where m.account_id = ${accounts.id} and m.status = 'active')`,
  }).orderBy(asc(accounts.name), asc(accounts.id)).limit(limit).offset(offset);
  const [count] = await base({ total: sql`count(*)::int` });
  return {
    rows: rows.map((r) => ({
      id: r.id, name: r.name, accountNumber: r.accountNumber ?? null,
      organization: r.organizationId ? { id: r.organizationId, name: r.organizationName } : null,
      memberCount: r.memberCount ?? 0,
    })),
    total: count?.total ?? 0,
  };
}
