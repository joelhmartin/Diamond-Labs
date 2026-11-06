import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db as appDb } from "../config/database.js";
import { accounts, memberships, users } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { logSafe } from "./audit.service.js";
import { openInvoicesForAccounts } from "./billing/ledger.service.js";
import { organizations, organizationAccounts } from "../modules/organizations/index.js";
import { containsPattern } from "../lib/list-query.js";
import { directPracticeIdsQuery } from "./practice-of.js";

/**
 * Practices: the client accounts (`accounts.is_client`). Admin > Practices and
 * the staff order-entry practice picker read this list; editing and members
 * arrive with the practices admin routes.
 *
 * Filters: `q` (name or account number), `organizationId`, `ungrouped` (in no group), `missingNumber`
 * (no lab account number yet) and `memberUserId` (the practices that login can create records for:
 * active direct membership in an active client account). Returns `{ rows, total }`; each row is
 * `{ id, name, accountNumber, organization: { id, name } | null, memberCount, openBalanceCents }`;
 * the balance is the sum of the practice's open invoices from the ledger helper (one query for the page).
 */
export async function listPractices({ q, organizationId, missingNumber, ungrouped, memberUserId, limit = 25, offset = 0 } = {}, database = appDb) {
  const conds = [eq(accounts.isClient, true), ne(accounts.status, "deleted")];
  if (q?.trim()) {
    const like = containsPattern(q.trim());
    conds.push(or(ilike(accounts.name, like), ilike(accounts.accountNumber, like)));
  }
  if (organizationId) conds.push(eq(organizationAccounts.organizationId, organizationId));
  if (missingNumber === true) conds.push(or(sql`${accounts.accountNumber} is null`, eq(accounts.accountNumber, "")));
  if (ungrouped === true) conds.push(sql`${organizationAccounts.organizationId} is null`);
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
  const open = await openInvoicesForAccounts(rows.map((r) => r.id), database);
  const balances = new Map();
  for (const inv of open) balances.set(inv.accountId, (balances.get(inv.accountId) ?? 0) + inv.balanceCents);
  return {
    rows: rows.map((r) => ({
      id: r.id, name: r.name, accountNumber: r.accountNumber ?? null,
      organization: r.organizationId ? { id: r.organizationId, name: r.organizationName } : null,
      memberCount: r.memberCount ?? 0,
      openBalanceCents: balances.get(r.id) ?? 0,
    })),
    total: count?.total ?? 0,
  };
}

/**
 * Name and lab account number of each ACTIVE client account among `ids`, in
 * one query: the practice label for statements and the client scope view. An
 * id that is not an active practice is simply absent.
 * @returns {Promise<Map<string, { id: string, name: string, accountNumber: string|null }>>}
 */
export async function describePractices(ids, database = appDb) {
  const unique = [...new Set((ids ?? []).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await database
    .select({ id: accounts.id, name: accounts.name, accountNumber: accounts.accountNumber })
    .from(accounts)
    .where(and(inArray(accounts.id, unique), eq(accounts.status, "active"), eq(accounts.isClient, true)));
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, accountNumber: r.accountNumber ?? null }]));
}

/** A practice-admin refusal; the app error handler maps statusCode + code to the reply. */
export class PracticeError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "PracticeError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Roles staff may hand out; "owner" belongs to the account's creator and never moves here. */
export const ASSIGNABLE_ROLES = ["admin", "member", "viewer"];

async function requirePractice(database, id) {
  const [row] = await database
    .select({ id: accounts.id, ownerId: accounts.ownerId })
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.isClient, true), ne(accounts.status, "deleted")));
  if (!row) throw new PracticeError(404, "NOT_FOUND", "Practice not found.");
  return row;
}

function assertAssignable(role) {
  if (!ASSIGNABLE_ROLES.includes(role)) throw new PracticeError(422, "INVALID_ROLE", "Choose admin, member or viewer.");
}

/** The owner (by role or as the account's recorded owner) can be neither demoted nor removed here. */
function isOwner(practice, membership) {
  return membership.role === "owner" || membership.userId === practice.ownerId;
}

/**
 * Set (or clear, with an empty value) the lab account number. Unique across
 * accounts: a clash is a 409 ACCOUNT_NUMBER_TAKEN. Audited as practice.account_number_set.
 */
export async function setAccountNumber(id, value, byUserId, database = appDb, audit = logSafe) {
  await requirePractice(database, id);
  const next = String(value ?? "").trim() || null;
  if (next) {
    const [clash] = await database.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.accountNumber, next), ne(accounts.id, id)));
    if (clash) throw new PracticeError(409, "ACCOUNT_NUMBER_TAKEN", "That account number belongs to another practice.");
  }
  try {
    await database.update(accounts).set({ accountNumber: next, updatedAt: new Date() }).where(eq(accounts.id, id));
  } catch (err) {
    // The unique index is the real guard when two edits race the check above.
    if (err?.code === "23505") throw new PracticeError(409, "ACCOUNT_NUMBER_TAKEN", "That account number belongs to another practice.");
    throw err;
  }
  audit({ userId: byUserId ?? null, action: "practice.account_number_set", targetType: "account", targetId: id, metadata: { accountId: id } });
  return { id, accountNumber: next };
}

/** Active members of a practice with their login labels; `isOwner` marks the one who cannot be changed. */
export async function listMembers(id, database = appDb) {
  const practice = await requirePractice(database, id);
  const rows = await database
    .select({ userId: memberships.userId, role: memberships.role, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.accountId, id), eq(memberships.status, "active")))
    .orderBy(asc(users.name), asc(users.id));
  return rows.map((r) => ({ userId: r.userId, name: r.name ?? null, email: r.email, role: r.role, isOwner: isOwner(practice, r) }));
}

/** Add a login to a practice; a removed or suspended row for the same login is re-activated with the new role. */
export async function addMember(id, { userId, role }, byUserId, database = appDb, audit = logSafe) {
  assertAssignable(role);
  const practice = await requirePractice(database, id);
  const [user] = await database.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) throw new PracticeError(404, "NOT_FOUND", "User not found.");
  const [existing] = await database
    .select({ id: memberships.id, userId: memberships.userId, role: memberships.role, status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.accountId, id), eq(memberships.userId, userId)));
  if (existing && isOwner(practice, existing)) throw new PracticeError(422, "OWNER_PROTECTED", "The owner's access cannot be changed here.");
  if (userId === practice.ownerId) throw new PracticeError(422, "OWNER_PROTECTED", "The owner's access cannot be changed here.");
  if (existing) {
    await database.update(memberships).set({ role, status: "active", updatedAt: new Date() }).where(eq(memberships.id, existing.id));
  } else {
    await database.insert(memberships).values({ id: createId(), userId, accountId: id, role, status: "active" });
  }
  audit({ userId: byUserId ?? null, action: "practice.member_added", targetType: "account", targetId: id, metadata: { accountId: id, userId, role } });
  return { userId, role };
}

async function activeMembership(database, practice, userId) {
  const [row] = await database
    .select({ id: memberships.id, userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.accountId, practice.id), eq(memberships.userId, userId), eq(memberships.status, "active")));
  if (!row) throw new PracticeError(404, "NOT_FOUND", "Member not found.");
  if (isOwner(practice, row)) throw new PracticeError(422, "OWNER_PROTECTED", "The owner's access cannot be changed here.");
  return row;
}

/** Change an active member's role (admin | member | viewer); never the owner's. */
export async function setMemberRole(id, userId, role, byUserId, database = appDb, audit = logSafe) {
  assertAssignable(role);
  const practice = await requirePractice(database, id);
  const row = await activeMembership(database, practice, userId);
  await database.update(memberships).set({ role, updatedAt: new Date() }).where(eq(memberships.id, row.id));
  audit({ userId: byUserId ?? null, action: "practice.member_role_changed", targetType: "account", targetId: id, metadata: { accountId: id, userId, role } });
  return { userId, role };
}

/** Remove a member (status "removed", the row stays so re-adding re-activates it); never the owner. */
export async function removeMember(id, userId, byUserId, database = appDb, audit = logSafe) {
  const practice = await requirePractice(database, id);
  const row = await activeMembership(database, practice, userId);
  await database.update(memberships).set({ status: "removed", updatedAt: new Date() }).where(eq(memberships.id, row.id));
  audit({ userId: byUserId ?? null, action: "practice.member_removed", targetType: "account", targetId: id, metadata: { accountId: id, userId } });
  return { userId };
}
