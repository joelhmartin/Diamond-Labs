import { db } from "../config/database.js";
import { invitations, memberships, users } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { generateSecureToken } from "../lib/tokens.js";
import { ERROR_CODES } from "@my-app/shared";

function createAppError(errorDef) {
  const err = new Error(errorDef.message);
  err.statusCode = errorDef.status;
  err.code = errorDef.code;
  return err;
}

export async function createInvitation({ accountId, invitedById, email, role }) {
  // Check if already a member
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser) {
    const [existingMembership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, existingUser.id),
          eq(memberships.accountId, accountId),
        )
      )
      .limit(1);
    if (existingMembership) throw createAppError(ERROR_CODES.ALREADY_MEMBER);
  }

  // Check for pending invitation
  const [existingInvite] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.accountId, accountId),
        eq(invitations.email, email),
        eq(invitations.status, "pending"),
      )
    )
    .limit(1);

  if (existingInvite) throw createAppError(ERROR_CODES.INVITATION_ALREADY_EXISTS);

  const id = createId();
  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(invitations).values({
    id,
    accountId,
    invitedById,
    email,
    role,
    token,
    status: "pending",
    expiresAt,
  });

  return { id, token, email, role, expiresAt };
}

export async function acceptInvitation(token, userId) {
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1);

  if (!invitation) throw createAppError(ERROR_CODES.INVITATION_NOT_FOUND);
  if (invitation.status !== "pending") throw createAppError(ERROR_CODES.INVITATION_ALREADY_ACCEPTED);
  if (new Date(invitation.expiresAt) < new Date()) {
    await db.update(invitations).set({ status: "expired" }).where(eq(invitations.id, invitation.id));
    throw createAppError(ERROR_CODES.INVITATION_EXPIRED);
  }

  // Verify the accepting user's email matches the invitation
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.email !== invitation.email) {
    throw createAppError({ ...ERROR_CODES.FORBIDDEN, message: "This invitation is for a different email address." });
  }

  // Create membership
  await db.insert(memberships).values({
    id: createId(),
    userId,
    accountId: invitation.accountId,
    role: invitation.role,
    status: "active",
  });

  // Mark invitation as accepted
  await db
    .update(invitations)
    .set({ status: "accepted", updatedAt: new Date() })
    .where(eq(invitations.id, invitation.id));

  return { accountId: invitation.accountId, role: invitation.role };
}

export async function declineInvitation(token, userId) {
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1);

  if (!invitation) throw createAppError(ERROR_CODES.INVITATION_NOT_FOUND);
  if (invitation.status !== "pending") throw createAppError(ERROR_CODES.INVITATION_ALREADY_ACCEPTED);

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.email !== invitation.email) {
    throw createAppError({ ...ERROR_CODES.FORBIDDEN, message: "This invitation is for a different email address." });
  }

  await db
    .update(invitations)
    .set({ status: "declined", updatedAt: new Date() })
    .where(eq(invitations.id, invitation.id));
}

export async function revokeInvitation(invitationId, accountId) {
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.id, invitationId), eq(invitations.accountId, accountId)))
    .limit(1);

  if (!invitation) throw createAppError(ERROR_CODES.INVITATION_NOT_FOUND);
  if (invitation.status !== "pending") {
    throw createAppError({ ...ERROR_CODES.FORBIDDEN, message: "Can only revoke pending invitations." });
  }

  await db
    .update(invitations)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(invitations.id, invitationId));
}

export async function resendInvitation(invitationId, accountId) {
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.id, invitationId), eq(invitations.accountId, accountId)))
    .limit(1);

  if (!invitation) throw createAppError(ERROR_CODES.INVITATION_NOT_FOUND);
  if (invitation.status !== "pending") {
    throw createAppError({ ...ERROR_CODES.FORBIDDEN, message: "Can only resend pending invitations." });
  }

  // Extend expiry
  const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db
    .update(invitations)
    .set({ expiresAt: newExpiry, updatedAt: new Date() })
    .where(eq(invitations.id, invitationId));

  return { ...invitation, expiresAt: newExpiry };
}
