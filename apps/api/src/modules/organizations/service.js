import { and, asc, eq, inArray, ilike, ne, sql } from "drizzle-orm";
import { db as appDb } from "../../config/database.js";
import { createId } from "../../lib/id.js";
import { organizations, organizationAccounts, organizationAdmins } from "./schema.js";
import { OrganizationError, resolveScope } from "./rules.js";

const DEFAULT_SETTINGS = { combinedStatement: false };
const normalizeName = (n) => String(n ?? "").trim().replace(/\s+/g, " ");
const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");
const isUniqueViolation = (err) => err?.code === "23505";
const nameTaken = () => new OrganizationError("CONFLICT", "An organization with that name already exists.");

async function requireOrganization(database, id) {
  const [org] = await database.select().from(organizations).where(eq(organizations.id, id));
  if (!org) throw new OrganizationError("NOT_FOUND", "Organization not found.");
  return org;
}

async function assertNameFree(database, name, exceptId = null) {
  const same = sql`lower(${organizations.name}) = ${name.toLowerCase()}`;
  const [clash] = await database.select({ id: organizations.id }).from(organizations).where(exceptId ? and(same, ne(organizations.id, exceptId)) : same);
  if (clash) throw nameTaken();
}

/**
 * Organizations service. `audit` is the host's audit writer, injected so this
 * module never imports app services; it is called after each write with
 * `{ userId, action, targetType: "organization", targetId, metadata }` and the
 * metadata carries ids and field names only. Every function takes an optional
 * `database` (a transaction in tests) as its last argument.
 *
 * @param {{ audit?: (entry: object) => void }} [opts]
 */
export function createOrganizationsService({ audit } = {}) {
  const record = (userId, action, targetId, metadata = {}) =>
    audit?.({ userId: userId ?? null, action, targetType: "organization", targetId, metadata });

  async function listOrganizations({ q, status, limit = 25, offset = 0 } = {}, database = appDb) {
    const conds = [];
    if (status) conds.push(eq(organizations.status, status));
    if (q?.trim()) conds.push(ilike(organizations.name, `%${escapeLike(q.trim())}%`));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await database
      .select({
        id: organizations.id, name: organizations.name, settings: organizations.settings, status: organizations.status,
        createdAt: organizations.createdAt, updatedAt: organizations.updatedAt,
        accountCount: sql`(select count(*)::int from organization_accounts oa where oa.organization_id = ${organizations.id})`,
        adminCount: sql`(select count(*)::int from organization_admins ad where ad.organization_id = ${organizations.id} and ad.status = 'active')`,
      })
      .from(organizations)
      .where(where)
      .orderBy(asc(organizations.name))
      .limit(limit)
      .offset(offset);
    const [count] = await database.select({ total: sql`count(*)::int` }).from(organizations).where(where);
    return { rows, total: count?.total ?? 0 };
  }

  async function getOrganization(id, database = appDb) {
    const org = await requireOrganization(database, id);
    const accounts = await database.select({ accountId: organizationAccounts.accountId }).from(organizationAccounts)
      .where(eq(organizationAccounts.organizationId, id));
    const admins = await database.select({ userId: organizationAdmins.userId, status: organizationAdmins.status }).from(organizationAdmins)
      .where(and(eq(organizationAdmins.organizationId, id), eq(organizationAdmins.status, "active")));
    return { ...org, accountIds: accounts.map((a) => a.accountId).sort(), admins };
  }

  async function createOrganization({ name, settings, byUserId }, database = appDb) {
    const clean = normalizeName(name);
    if (!clean) throw new OrganizationError("INVALID", "Name is required.");
    await assertNameFree(database, clean);
    const row = { id: createId(), name: clean, settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) }, status: "active" };
    try {
      await database.insert(organizations).values(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken();
      throw err;
    }
    record(byUserId, "organization.created", row.id);
    return row;
  }

  async function updateOrganization(id, patch, byUserId, database = appDb) {
    const current = await requireOrganization(database, id);
    const set = {};
    if (patch.name !== undefined) {
      const clean = normalizeName(patch.name);
      if (!clean) throw new OrganizationError("INVALID", "Name is required.");
      await assertNameFree(database, clean, id);
      set.name = clean;
    }
    if (patch.settings !== undefined) set.settings = { ...DEFAULT_SETTINGS, ...(current.settings ?? {}), ...patch.settings };
    if (patch.status !== undefined) set.status = patch.status;
    try {
      await database.update(organizations).set({ ...set, updatedAt: new Date() }).where(eq(organizations.id, id));
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken();
      throw err;
    }
    record(byUserId, "organization.updated", id, { fields: Object.keys(set) });
    return { ...current, ...set };
  }

  /** `exists(ids)` returns the Set of account ids that exist (the host owns accounts). */
  async function addAccounts(orgId, accountIds, { byUserId, exists } = {}, database = appDb) {
    const org = await requireOrganization(database, orgId);
    if (org.status !== "active") throw new OrganizationError("INVALID", "Organization is archived.");
    const ids = [...new Set(accountIds)];
    if (exists) {
      const found = await exists(ids);
      if (ids.some((i) => !found.has(i))) throw new OrganizationError("INVALID", "One or more accounts do not exist.");
    }
    const taken = await database.select({ organizationId: organizationAccounts.organizationId, accountId: organizationAccounts.accountId })
      .from(organizationAccounts).where(inArray(organizationAccounts.accountId, ids));
    const takenBy = new Map(taken.map((t) => [t.accountId, t.organizationId]));
    const alreadyInOther = ids.filter((i) => takenBy.has(i) && takenBy.get(i) !== orgId);
    const added = ids.filter((i) => !takenBy.has(i));
    if (added.length) {
      await database.insert(organizationAccounts)
        .values(added.map((accountId) => ({ organizationId: orgId, accountId, addedBy: byUserId ?? null })))
        .onConflictDoNothing();
      record(byUserId, "organization.accounts_added", orgId, { accountIds: added });
    }
    return { added, alreadyInOther };
  }

  async function removeAccount(orgId, accountId, { byUserId } = {}, database = appDb) {
    const [link] = await database.select().from(organizationAccounts)
      .where(and(eq(organizationAccounts.organizationId, orgId), eq(organizationAccounts.accountId, accountId)));
    if (!link) throw new OrganizationError("NOT_FOUND", "Account is not in this organization.");
    await database.delete(organizationAccounts)
      .where(and(eq(organizationAccounts.organizationId, orgId), eq(organizationAccounts.accountId, accountId)));
    record(byUserId, "organization.account_removed", orgId, { accountId });
  }

  /** `exists(userId)` (optional) checks the user in the host's user table. */
  async function addAdmin(orgId, userId, { byUserId, exists } = {}, database = appDb) {
    const org = await requireOrganization(database, orgId);
    if (org.status !== "active") throw new OrganizationError("INVALID", "Organization is archived.");
    if (exists && !(await exists(userId))) throw new OrganizationError("INVALID", "User not found.");
    await database.insert(organizationAdmins)
      .values({ id: createId(), organizationId: orgId, userId, status: "active", addedBy: byUserId ?? null })
      .onConflictDoUpdate({
        target: [organizationAdmins.organizationId, organizationAdmins.userId],
        set: { status: "active", addedBy: byUserId ?? null, updatedAt: new Date() },
      });
    record(byUserId, "organization.admin_added", orgId, { userId });
  }

  async function removeAdmin(orgId, userId, { byUserId } = {}, database = appDb) {
    const [grant] = await database.select().from(organizationAdmins)
      .where(and(eq(organizationAdmins.organizationId, orgId), eq(organizationAdmins.userId, userId), eq(organizationAdmins.status, "active")));
    if (!grant) throw new OrganizationError("NOT_FOUND", "Admin not found.");
    await database.update(organizationAdmins).set({ status: "removed", updatedAt: new Date() })
      .where(eq(organizationAdmins.id, grant.id));
    record(byUserId, "organization.admin_removed", orgId, { userId });
  }

  /** Map<accountId, { id, name, settings }> for accounts in an active organization; others are absent. */
  async function organizationOf(accountIds, database = appDb) {
    const out = new Map();
    if (!accountIds?.length) return out;
    const rows = await database
      .select({ accountId: organizationAccounts.accountId, id: organizations.id, name: organizations.name, settings: organizations.settings })
      .from(organizationAccounts)
      .innerJoin(organizations, eq(organizations.id, organizationAccounts.organizationId))
      .where(and(inArray(organizationAccounts.accountId, accountIds), eq(organizations.status, "active")));
    for (const r of rows) out.set(r.accountId, { id: r.id, name: r.name, settings: r.settings });
    return out;
  }

  /**
   * The `resolveScope` result for a user. Always read live, never cached.
   * Glue callbacks: `loadMemberships(userId)` → `[{ accountId, role, status, accountActive }]`;
   * `isEligibleAccount(accountId)` → boolean (the host's rule for which accounts count; it also
   * covers the account being active for organization-granted accounts).
   */
  async function scopeForUser(userId, { loadMemberships, isEligibleAccount }, database = appDb) {
    const rawMemberships = await loadMemberships(userId);
    const memberships = [];
    for (const m of rawMemberships) memberships.push({ ...m, accountEligible: await isEligibleAccount(m.accountId) });

    const adminOf = await database
      .select({ organizationId: organizationAdmins.organizationId, status: organizationAdmins.status, organizationActive: sql`${organizations.status} = 'active'` })
      .from(organizationAdmins)
      .innerJoin(organizations, eq(organizations.id, organizationAdmins.organizationId))
      .where(and(eq(organizationAdmins.userId, userId), eq(organizationAdmins.status, "active")));

    let orgAccounts = [];
    if (adminOf.length) {
      const rows = await database
        .select({ organizationId: organizationAccounts.organizationId, accountId: organizationAccounts.accountId })
        .from(organizationAccounts)
        .where(inArray(organizationAccounts.organizationId, adminOf.map((g) => g.organizationId)));
      for (const r of rows) {
        orgAccounts.push({ ...r, accountActive: true, accountEligible: await isEligibleAccount(r.accountId) });
      }
    }
    return resolveScope({ memberships, adminOf, orgAccounts });
  }

  return {
    listOrganizations, getOrganization, createOrganization, updateOrganization,
    addAccounts, removeAccount, addAdmin, removeAdmin, organizationOf, scopeForUser,
  };
}
