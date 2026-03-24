import { db } from "../config/database.js";
import { memberships, users } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { ERROR_CODES, parsePagination } from "@my-app/shared";

function createAppError(errorDef) {
  const err = new Error(errorDef.message);
  err.statusCode = errorDef.status;
  err.code = errorDef.code;
  return err;
}

export async function listMembers(accountId, query = {}) {
  const { limit, offset } = parsePagination(query);

  const results = await db
    .select({
      id: memberships.id,
      role: memberships.role,
      status: memberships.status,
      joinedAt: memberships.joinedAt,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      userAvatar: users.avatarUrl,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.accountId, accountId))
    .limit(limit)
    .offset(offset);

  return results;
}

export async function getMembership(membershipId) {
  const [membership] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1);

  if (!membership) throw createAppError(ERROR_CODES.MEMBERSHIP_NOT_FOUND);
  return membership;
}

export async function updateMemberRole(membershipId, newRole, accountId) {
  const membership = await getMembership(membershipId);

  if (membership.accountId !== accountId) {
    throw createAppError(ERROR_CODES.MEMBERSHIP_NOT_FOUND);
  }

  if (membership.role === "owner") {
    throw createAppError(ERROR_CODES.CANNOT_CHANGE_OWNER_ROLE);
  }

  await db
    .update(memberships)
    .set({ role: newRole, updatedAt: new Date() })
    .where(eq(memberships.id, membershipId));

  return { ...membership, role: newRole };
}

export async function removeMember(membershipId, accountId) {
  const membership = await getMembership(membershipId);

  if (membership.accountId !== accountId) {
    throw createAppError(ERROR_CODES.MEMBERSHIP_NOT_FOUND);
  }

  if (membership.role === "owner") {
    throw createAppError(ERROR_CODES.CANNOT_REMOVE_OWNER);
  }

  await db
    .update(memberships)
    .set({ status: "removed", updatedAt: new Date() })
    .where(eq(memberships.id, membershipId));
}

export async function suspendMember(membershipId, accountId) {
  const membership = await getMembership(membershipId);

  if (membership.accountId !== accountId) {
    throw createAppError(ERROR_CODES.MEMBERSHIP_NOT_FOUND);
  }
  if (membership.role === "owner") {
    throw createAppError({ ...ERROR_CODES.FORBIDDEN, message: "Cannot suspend the account owner." });
  }

  await db
    .update(memberships)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(eq(memberships.id, membershipId));
}

export async function reactivateMember(membershipId, accountId) {
  const membership = await getMembership(membershipId);

  if (membership.accountId !== accountId) {
    throw createAppError(ERROR_CODES.MEMBERSHIP_NOT_FOUND);
  }

  await db
    .update(memberships)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(memberships.id, membershipId));
}
