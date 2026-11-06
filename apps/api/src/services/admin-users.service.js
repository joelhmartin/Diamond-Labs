import { and, desc, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import { db as appDb } from "../config/database.js";
import { users, accounts, memberships } from "../db/schema/index.js";
import { tagsFor } from "../modules/record-tags/index.js";
import { CLIENT_REP_RECORD_TYPE } from "./lab/lab-tags.js";
import { containsPattern } from "../lib/list-query.js";
import { usersAdministeringAPractice } from "./client-scope.js";

const COLUMNS = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  approvalStatus: users.approvalStatus,
  status: users.status,
  emailVerifiedAt: users.emailVerifiedAt,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  seazonaClientId: users.seazonaClientId,
  seazonaAccountNumber: users.seazonaAccountNumber,
  hasPassword: sql`(${users.passwordHash} IS NOT NULL)`,
};

/** The WHERE of an Admin > Users query (adminUsersQuerySchema): every given filter, ANDed. */
export function adminUsersWhere({ q, role, status, ids, excludeIds } = {}) {
  const conds = [];
  if (q) {
    const like = containsPattern(q);
    conds.push(or(ilike(users.name, like), ilike(users.email, like)));
  }
  if (role) conds.push(eq(users.role, role));
  if (status) conds.push(eq(users.status, status));
  if (ids) conds.push(ids.length ? inArray(users.id, ids) : sql`false`);
  if (excludeIds?.length) conds.push(notInArray(users.id, excludeIds));
  return conds.length ? and(...conds) : undefined;
}

/**
 * Every user with their primary account + linkage flags (+ the client's sales-rep tags).
 * No `limit`: the whole filtered list and the screen's `summary` counts (the Users screen).
 * With `limit`: one page of the filtered list and its `total` (the logins picker) - no summary.
 */
export async function listAdminUsers(query = {}, database = appDb) {
  const where = adminUsersWhere(query);
  const paged = query.limit != null;
  let select = database.select(COLUMNS).from(users).where(where).orderBy(desc(users.createdAt), users.id);
  if (paged) select = select.limit(query.limit).offset(query.offset ?? 0);
  const userRows = await select;

  // Each user's primary (first) active account.
  const primary = new Map();
  const memberQuery = database
    .select({
      userId: memberships.userId,
      accountId: memberships.accountId,
      role: memberships.role,
      accountName: accounts.name,
      accountSlug: accounts.slug,
    })
    .from(memberships)
    .innerJoin(accounts, eq(memberships.accountId, accounts.id));
  const memberRows = await memberQuery.where(and(eq(memberships.status, "active"), (where || paged) ? inArray(memberships.userId, userRows.map((u) => u.id)) : undefined));
  for (const m of memberRows) {
    if (!primary.has(m.userId)) primary.set(m.userId, { accountId: m.accountId, name: m.accountName, slug: m.accountSlug, role: m.role });
  }

  // Who staff may record a payment for besides a doctor: the ONE shared rule (client-scope.js).
  const runs = await usersAdministeringAPractice(userRows.filter((u) => u.role === "user").map((u) => u.id), database);

  const reps = await tagsFor(CLIENT_REP_RECORD_TYPE, userRows.filter((u) => u.role === "doctor").map((u) => u.id));
  const enriched = userRows.map((u) => ({ ...u, account: primary.get(u.id) || null, runsPractice: runs.has(u.id), repTags: reps.get(u.id) ?? [] }));

  if (paged) {
    const [{ n }] = await database.select({ n: sql`count(*)::int` }).from(users).where(where);
    return { users: enriched, total: n };
  }
  return {
    users: enriched,
    summary: {
      total: enriched.length,
      admins: enriched.filter((u) => u.role === "admin").length,
      doctors: enriched.filter((u) => u.role === "doctor").length,
      users: enriched.filter((u) => u.role === "user").length,
      seazonaLinked: enriched.filter((u) => u.seazonaClientId).length,
      neverLoggedIn: enriched.filter((u) => !u.lastLoginAt).length,
      passwordlessCount: enriched.filter((u) => !u.hasPassword).length,
    },
  };
}
