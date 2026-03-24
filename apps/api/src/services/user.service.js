import { db } from "../config/database.js";
import { users, memberships, accounts, sessions, invitations } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
import { hashPassword, comparePassword } from "../lib/passwords.js";
import { ERROR_CODES } from "@my-app/shared";

function createAppError(errorDef) {
  const err = new Error(errorDef.message);
  err.statusCode = errorDef.status;
  err.code = errorDef.code;
  return err;
}

export async function getProfile(userId) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      emailVerifiedAt: users.emailVerifiedAt,
      mfaEnabled: users.mfaEnabled,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw createAppError(ERROR_CODES.USER_NOT_FOUND);
  return user;
}

export async function updateProfile(userId, data) {
  await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return getProfile(userId);
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.passwordHash) throw createAppError(ERROR_CODES.INCORRECT_PASSWORD);

  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) throw createAppError(ERROR_CODES.INCORRECT_PASSWORD);

  const newHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function getUserAccounts(userId) {
  const results = await db
    .select({
      accountId: accounts.id,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountLogo: accounts.logoUrl,
      accountPlan: accounts.plan,
      role: memberships.role,
      membershipStatus: memberships.status,
    })
    .from(memberships)
    .innerJoin(accounts, eq(memberships.accountId, accounts.id))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        eq(accounts.status, "active"),
      )
    );

  return results;
}

export async function getUserInvitations(userId) {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return [];

  const results = await db
    .select({
      id: invitations.id,
      accountId: invitations.accountId,
      email: invitations.email,
      role: invitations.role,
      token: invitations.token,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
      accountName: accounts.name,
    })
    .from(invitations)
    .innerJoin(accounts, eq(invitations.accountId, accounts.id))
    .where(
      and(
        eq(invitations.email, user.email),
        eq(invitations.status, "pending"),
      )
    );

  return results;
}

export async function getUserSessions(userId) {
  const results = await db
    .select({
      id: sessions.id,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.revokedAt, null),
      )
    );

  // Filter to only non-revoked sessions manually if null comparison is tricky
  return results.filter((s) => !s.revokedAt);
}

export async function revokeSession(sessionId, userId) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);

  if (!session) throw createAppError(ERROR_CODES.NOT_FOUND);

  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}
