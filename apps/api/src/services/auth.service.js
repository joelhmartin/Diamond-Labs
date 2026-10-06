import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { users, accounts, memberships, sessions, doctorProfiles, approvalTokens } from "../db/schema/index.js";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { hashPassword, comparePassword } from "../lib/passwords.js";
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  generateSecureToken,
  signMfaToken,
  verifyMfaToken,
} from "../lib/tokens.js";
import { generateMfaSecret, verifyMfaCode } from "../lib/mfa.js";
import { encryptField, decryptField } from "../lib/crypto.js";
import { ERROR_CODES, slugify } from "@my-app/shared";
import { env } from "../config/env.js";
import * as seazonaService from "./seazona.service.js";
import * as emailService from "./email.service.js";

const LOGIN_ATTEMPTS_PREFIX = "login_attempts:";
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60; // 15 minutes in seconds

const MFA_ATTEMPTS_PREFIX = "mfa_attempts:";
const MFA_CONSUMED_PREFIX = "mfa_consumed:";
const MAX_MFA_ATTEMPTS = 5;
const MFA_TOKEN_TTL = 5 * 60; // matches signMfaToken's 5m expiry
// Doctor email-verification link lifetime — matches the 7-day approval token so
// a registrant approved late in that window can still verify.
const DOCTOR_EMAIL_VERIFY_TTL = 7 * 24 * 60 * 60;

// A real bcrypt hash of a random string, used ONLY to equalize response timing
// when an account is missing or passwordless — so login can't be used as a
// user-enumeration / timing oracle. Never matches any real password.
const DUMMY_PASSWORD_HASH = "$2b$12$buU6piSJmUdceNyxBBK/rOZBKhy19058k99LAW6u.ssTiLXLnrN0m";

function createAppError(errorDef) {
  const err = new Error(errorDef.message);
  err.statusCode = errorDef.status;
  err.code = errorDef.code;
  return err;
}

/** Shape a users-table row into the public user object returned by auth endpoints. */
function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
    approvalStatus: user.approvalStatus,
    emailVerifiedAt: user.emailVerifiedAt,
    mfaEnabled: user.mfaEnabled,
  };
}

async function checkLoginAttempts(email) {
  const key = `${LOGIN_ATTEMPTS_PREFIX}${email}`;
  const attempts = await redis.get(key);
  if (attempts && parseInt(attempts, 10) >= MAX_LOGIN_ATTEMPTS) {
    throw createAppError(ERROR_CODES.ACCOUNT_LOCKED);
  }
}

async function recordFailedLogin(email) {
  const key = `${LOGIN_ATTEMPTS_PREFIX}${email}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, LOCKOUT_DURATION);
  }
}

async function clearLoginAttempts(email) {
  await redis.del(`${LOGIN_ATTEMPTS_PREFIX}${email}`);
}

function refreshTokenExpiry() {
  const match = env.REFRESH_TOKEN_EXPIRY.match(/^(\d+)([dhm])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7d
  const num = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { d: 86400000, h: 3600000, m: 60000 };
  return num * (multipliers[unit] || 86400000);
}

async function createSession(userId, refreshToken, ip, userAgent) {
  const id = createId();
  const expiresAt = new Date(Date.now() + refreshTokenExpiry());
  await db.insert(sessions).values({
    id,
    userId,
    refreshTokenHash: hashToken(refreshToken),
    ipAddress: ip || null,
    userAgent: userAgent || null,
    expiresAt,
  });
  return { id, expiresAt };
}

export async function register({ email, password, name }) {
  // Check uniqueness
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) throw createAppError(ERROR_CODES.EMAIL_ALREADY_EXISTS);

  const userId = createId();
  const passwordHash = await hashPassword(password);

  // Create user
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash,
    name,
    status: "active",
  });

  // Create default account
  const accountId = createId();
  const slug = slugify(name) || `account-${accountId.slice(0, 8)}`;
  await db.insert(accounts).values({
    id: accountId,
    name: `${name}'s Account`,
    slug,
    ownerId: userId,
    status: "active",
  });

  // Create owner membership
  await db.insert(memberships).values({
    id: createId(),
    userId,
    accountId,
    role: "owner",
    status: "active",
  });

  // Generate tokens
  const accessToken = await signAccessToken({ sub: userId });
  const refreshToken = generateRefreshToken();
  await createSession(userId, refreshToken, null, null);

  // Generate email verification token
  const verifyToken = generateSecureToken();
  await redis.set(`email_verify:${verifyToken}`, userId, "EX", 24 * 60 * 60);

  return {
    user: { id: userId, email, name },
    accessToken,
    refreshToken,
    verifyToken,
  };
}

export async function login({ email, password, ip, userAgent }) {
  await checkLoginAttempts(email);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user || !user.passwordHash) {
    // Run a dummy compare so a missing/passwordless account takes the same
    // time as a real one — no timing/enumeration oracle. Fail uniformly.
    await comparePassword(password, DUMMY_PASSWORD_HASH);
    await recordFailedLogin(email);
    throw createAppError(ERROR_CODES.INVALID_CREDENTIALS);
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(email);
    throw createAppError(ERROR_CODES.INVALID_CREDENTIALS);
  }

  await clearLoginAttempts(email);

  // Status checks run AFTER password verification so an unauthenticated caller
  // can't distinguish a suspended/deleted account from a wrong password
  // (enumeration). A deleted account is indistinguishable from bad credentials.
  if (user.status === "deleted") throw createAppError(ERROR_CODES.INVALID_CREDENTIALS);
  if (user.status === "suspended") throw createAppError(ERROR_CODES.USER_SUSPENDED);

  // Check doctor approval status
  if (user.role === "doctor" && user.approvalStatus === "pending") {
    return { pendingApproval: true };
  }
  if (user.role === "doctor" && user.approvalStatus === "rejected") {
    throw createAppError(ERROR_CODES.ACCOUNT_REJECTED);
  }

  // If MFA enabled, return MFA challenge
  if (user.mfaEnabled) {
    const mfaToken = await signMfaToken(user.id);
    return { mfaRequired: true, mfaToken };
  }

  // Issue tokens
  const accessToken = await signAccessToken({ sub: user.id });
  const refreshToken = generateRefreshToken();
  await createSession(user.id, refreshToken, ip, userAgent);

  // Update last login
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken,
  };
}

export async function verifyMfa({ mfaToken, code, ip, userAgent }) {
  const payload = await verifyMfaToken(mfaToken);
  const userId = payload.sub;
  const jti = payload.jti;

  // Single-use: reject replay of an already-consumed MFA token.
  if (jti) {
    const consumed = await redis.get(`${MFA_CONSUMED_PREFIX}${jti}`);
    if (consumed) throw createAppError(ERROR_CODES.MFA_INVALID_CODE);
  }

  // Brute-force cap: lock the MFA step after MAX_MFA_ATTEMPTS bad codes within
  // the 15-min window (same pattern as login attempts).
  const attemptsKey = `${MFA_ATTEMPTS_PREFIX}${userId}`;
  const attempts = await redis.get(attemptsKey);
  if (attempts && parseInt(attempts, 10) >= MAX_MFA_ATTEMPTS) {
    // Invalidate the token so the locked-out session can't keep probing.
    if (jti) await redis.set(`${MFA_CONSUMED_PREFIX}${jti}`, "1", "EX", MFA_TOKEN_TTL);
    throw createAppError(ERROR_CODES.ACCOUNT_LOCKED);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.mfaSecret) throw createAppError(ERROR_CODES.MFA_INVALID_CODE);

  // Secret is encrypted at rest (decryptField passes through legacy plaintext).
  const valid = verifyMfaCode(decryptField(user.mfaSecret), code);
  if (!valid) {
    const current = await redis.incr(attemptsKey);
    if (current === 1) await redis.expire(attemptsKey, LOCKOUT_DURATION);
    throw createAppError(ERROR_CODES.MFA_INVALID_CODE);
  }

  // Success: consume the token (single-use) and clear the attempt counter.
  if (jti) await redis.set(`${MFA_CONSUMED_PREFIX}${jti}`, "1", "EX", MFA_TOKEN_TTL);
  await redis.del(attemptsKey);

  const accessToken = await signAccessToken({ sub: user.id });
  const refreshToken = generateRefreshToken();
  await createSession(user.id, refreshToken, ip, userAgent);

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken,
  };
}

export async function refresh({ refreshToken, ip, userAgent }) {
  const tokenHash = hashToken(refreshToken);
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.refreshTokenHash, tokenHash), eq(sessions.revokedAt, null))
    )
    .limit(1);

  // Fallback: try without the revokedAt check and filter manually
  let validSession = session;
  if (!validSession) {
    const [s] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, tokenHash))
      .limit(1);
    if (s && !s.revokedAt && new Date(s.expiresAt) > new Date()) {
      validSession = s;
    }
  }

  if (!validSession) throw createAppError(ERROR_CODES.REFRESH_TOKEN_INVALID);
  if (new Date(validSession.expiresAt) <= new Date()) {
    throw createAppError(ERROR_CODES.REFRESH_TOKEN_INVALID);
  }

  // Revoke old session (token rotation)
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, validSession.id));

  // Issue new tokens
  const accessToken = await signAccessToken({ sub: validSession.userId });
  const newRefreshToken = generateRefreshToken();
  await createSession(validSession.userId, newRefreshToken, ip, userAgent);

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken) {
  if (!refreshToken) return;
  const tokenHash = hashToken(refreshToken);
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.refreshTokenHash, tokenHash));
}

export async function forgotPassword(email) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Always return success to avoid email enumeration
  if (!user) return { token: null };

  const token = generateSecureToken();
  await redis.set(`password_reset:${token}`, user.id, "EX", 60 * 60); // 1 hour
  return { token, userId: user.id };
}

export async function resetPassword({ token, password }) {
  const userId = await redis.get(`password_reset:${token}`);
  if (!userId) throw createAppError(ERROR_CODES.TOKEN_INVALID);

  const passwordHash = await hashPassword(password);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));

  // Invalidate token
  await redis.del(`password_reset:${token}`);

  // Revoke all sessions for this user
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.userId, userId));
}

export async function verifyEmail(token) {
  const userId = await redis.get(`email_verify:${token}`);
  if (!userId) throw createAppError(ERROR_CODES.TOKEN_INVALID);

  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));

  await redis.del(`email_verify:${token}`);

  // Verification is one of the two conditions for a pending Seazona link; if the
  // admin already approved that client, this completes it.
  await completePendingSeazonaLink(userId);
}

// Re-key of the second factor is as sensitive as removing it, so it takes the
// same password proof `disableMfa` takes. Without this, anyone holding a live
// session (stolen access token, unlocked laptop) could bind their OWN
// authenticator and hold the account past a password reset.
export async function setupMfa(userId, password) {
  const [user] = await db
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw createAppError(ERROR_CODES.USER_NOT_FOUND);

  if (!user.passwordHash) throw createAppError(ERROR_CODES.INCORRECT_PASSWORD);
  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw createAppError(ERROR_CODES.INCORRECT_PASSWORD);

  const { secret, uri } = generateMfaSecret(user.email);

  // Store secret temporarily until confirmed
  await redis.set(`mfa_setup:${userId}`, secret, "EX", 10 * 60); // 10 minutes

  return { secret, uri };
}

export async function enableMfa(userId, code) {
  const staged = await redis.get(`mfa_setup:${userId}`);
  if (!staged) throw createAppError({ ...ERROR_CODES.TOKEN_EXPIRED, message: "MFA setup expired. Please start again." });

  // Staged secret is plaintext today; decryptField passes it through unchanged.
  const secret = decryptField(staged);
  const valid = verifyMfaCode(secret, code);
  if (!valid) throw createAppError(ERROR_CODES.MFA_INVALID_CODE);

  // Encrypt the TOTP secret before persisting (PHI/credential at rest).
  await db
    .update(users)
    .set({ mfaSecret: encryptField(secret), mfaEnabled: true, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await redis.del(`mfa_setup:${userId}`);
}

export async function disableMfa(userId, password) {
  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.passwordHash) throw createAppError(ERROR_CODES.INCORRECT_PASSWORD);

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw createAppError(ERROR_CODES.INCORRECT_PASSWORD);

  await db
    .update(users)
    .set({ mfaSecret: null, mfaEnabled: false, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// ── Doctor Registration ──

export async function registerDoctor(data) {
  // Check for duplicate email in local DB
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);
  if (existing) throw createAppError(ERROR_CODES.EMAIL_ALREADY_EXISTS);

  // Match this registration against existing Seazona clients — but link NOTHING
  // here. Registration is public and unauthenticated, and the linked client id is
  // what gates access to that practice's invoices (patient names — PHI).
  //
  //  • Email match: stored as a PENDING link (users.pending*) and bound into the
  //    approval token. It becomes the real link only when BOTH the registrant
  //    verifies the address (proves inbox access) AND an admin approves the
  //    registration confirming that exact client (authority over the practice —
  //    a shared front-desk inbox is not that). Either order; see
  //    completePendingSeazonaLink.
  //  • Phone match: a practice's phone number is public, so it is only surfaced
  //    to the admin as a suggestion and never stored or linked.
  //
  // An approved doctor with no link gets SEAZONA_CLIENT_NOT_LINKED on billing
  // routes until both conditions hold.
  let seazonaEmailMatch = null;
  let suggestedSeazonaClient = null;

  const emailMatch = await seazonaService.checkLoginExists(data.email);
  if (emailMatch && emailMatch.clientId) {
    seazonaEmailMatch = {
      clientId: String(emailMatch.clientId),
      accountNumber: emailMatch.accountNumber ? String(emailMatch.accountNumber) : null,
      // From Seazona's record — never the registrant-supplied companyName.
      company: emailMatch.company || emailMatch.fullName || null,
    };
  } else if (data.phone) {
    const phoneMatch = await seazonaService.findClientByPhone(data.phone);
    if (phoneMatch) {
      suggestedSeazonaClient = {
        clientId: String(phoneMatch.clientId || phoneMatch.id),
        accountNumber: phoneMatch.accountNumber ? String(phoneMatch.accountNumber) : null,
        company: phoneMatch.company || phoneMatch.fullName || null,
        matchedOn: "phone",
      };
    }
  }

  // Create user
  const userId = createId();
  const passwordHash = await hashPassword(data.password);

  await db.insert(users).values({
    id: userId,
    email: data.email,
    passwordHash,
    name: data.name,
    status: "active",
    role: "doctor",
    approvalStatus: "pending",
    // Deliberately unlinked — see the matching comment above.
    seazonaClientId: null,
    seazonaAccountNumber: null,
    pendingSeazonaClientId: seazonaEmailMatch?.clientId ?? null,
    pendingSeazonaAccountNumber: seazonaEmailMatch?.accountNumber ?? null,
  });

  // Create default account
  const accountId = createId();
  const slug = slugify(data.name) || `doctor-${accountId.slice(0, 8)}`;
  await db.insert(accounts).values({
    id: accountId,
    name: `${data.name}'s Practice`,
    slug,
    ownerId: userId,
    status: "active",
  });

  await db.insert(memberships).values({
    id: createId(),
    userId,
    accountId,
    role: "owner",
    status: "active",
  });

  // Create doctor profile
  await db.insert(doctorProfiles).values({
    id: createId(),
    userId,
    npiNumber: data.npiNumber,
    licenseNumber: data.licenseNumber || null,
    companyName: data.companyName,
    address1: data.address1,
    address2: data.address2 || null,
    city: data.city,
    state: data.state,
    zip: data.zip,
    phone: data.phone || null,
    phone2: data.phone2 || null,
    deliveryMethod: data.deliveryMethod || null,
    deliveryNotes: data.deliveryNotes || null,
  });

  // Generate approval token
  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(approvalTokens).values({
    id: createId(),
    userId,
    token,
    expiresAt,
    // Bind the exact client the admin is about to be shown; "approve" confirms
    // this id and nothing else.
    seazonaClientId: seazonaEmailMatch?.clientId ?? null,
    seazonaClientLabel: seazonaEmailMatch ? seazonaClientLabel(seazonaEmailMatch) : null,
  });

  // Send admin notification email
  const baseUrl = env.API_URL || env.APP_URL;
  const approveUrl = `${baseUrl}/api/v1/auth/approve/${token}?action=approve`;
  const rejectUrl = `${baseUrl}/api/v1/auth/approve/${token}?action=reject`;
  const approveUnlinkedUrl = seazonaEmailMatch
    ? `${baseUrl}/api/v1/auth/approve/${token}?action=${APPROVAL_ACTIONS.APPROVE_UNLINKED}`
    : null;

  await emailService.sendAdminApprovalRequest({
    doctorName: data.name,
    doctorEmail: data.email,
    npiNumber: data.npiNumber,
    companyName: data.companyName,
    approveUrl,
    approveUnlinkedUrl,
    rejectUrl,
    seazonaEmailMatch,
    suggestedSeazonaClient,
  });

  // Email-ownership proof. Sent to every doctor registrant (it marks
  // emailVerifiedAt); for an email match it is one of the two conditions for the
  // Seazona link. Lives as long as the approval token so either order works.
  const verifyToken = generateSecureToken();
  await redis.set(`email_verify:${verifyToken}`, userId, "EX", DOCTOR_EMAIL_VERIFY_TTL);
  await emailService.sendWelcome({
    email: data.email,
    name: data.name,
    verifyUrl: `${env.APP_URL}/auth/verify-email?token=${encodeURIComponent(verifyToken)}`,
    expiresIn: "7 days",
  });

  return {
    message: "Registration submitted. Check your email to verify your address — your account also needs admin approval.",
  };
}

/**
 * Approval actions the admin can take on a doctor registration.
 *  - approve:          approve the doctor AND confirm the Seazona client bound
 *                      into this token (if any).
 *  - approve_unlinked: approve the doctor, decline the suggested client (the
 *                      pending link is discarded; nothing is linked).
 *  - reject:           reject; the pending link is discarded.
 * With no client bound to the token, approve and approve_unlinked are the same
 * — one-click approval for no-match registrations is unchanged.
 */
export const APPROVAL_ACTIONS = Object.freeze({
  APPROVE: "approve",
  APPROVE_UNLINKED: "approve_unlinked",
  REJECT: "reject",
});

/** "Company (acct N)" from Seazona's own client record — what the admin confirms. */
function seazonaClientLabel(match) {
  return `${match.company || "Unnamed Seazona client"} (acct ${match.accountNumber || "—"})`.slice(0, 255);
}

/**
 * Turn a PENDING Seazona link into the real one, iff BOTH conditions hold:
 *   1. the user verified their email (emailVerifiedAt) — proves inbox access;
 *   2. an admin approved the registration confirming that exact client
 *      (pendingSeazonaLinkApprovedAt) — authority over the practice.
 * Called after each of those events, so it completes in either order. One
 * conditional UPDATE does the check and the write, so a concurrent call (or a
 * link someone set by hand) can't race it into a double or overriding link.
 *
 * @returns {Promise<boolean>} true if this call wrote the link.
 */
export async function completePendingSeazonaLink(userId) {
  const linked = await db
    .update(users)
    .set({
      seazonaClientId: sql`${users.pendingSeazonaClientId}`,
      seazonaAccountNumber: sql`${users.pendingSeazonaAccountNumber}`,
      pendingSeazonaClientId: null,
      pendingSeazonaAccountNumber: null,
      pendingSeazonaLinkApprovedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, userId),
        eq(users.role, "doctor"),
        isNull(users.seazonaClientId),
        isNotNull(users.pendingSeazonaClientId),
        isNotNull(users.pendingSeazonaLinkApprovedAt),
        isNotNull(users.emailVerifiedAt)
      )
    )
    .returning({ id: users.id, seazonaClientId: users.seazonaClientId });
  if (linked.length) {
    console.log(`[auth] linked user ${userId} to Seazona client ${linked[0].seazonaClientId} (email verified + admin confirmed)`);
    return true;
  }
  return false;
}

/** Load an approval token and assert it is usable. */
async function loadUsableApprovalToken(token) {
  const [record] = await db
    .select()
    .from(approvalTokens)
    .where(eq(approvalTokens.token, token))
    .limit(1);

  if (!record) throw createAppError(ERROR_CODES.APPROVAL_TOKEN_INVALID);
  if (record.usedAt) throw createAppError(ERROR_CODES.APPROVAL_TOKEN_INVALID);
  if (new Date(record.expiresAt) <= new Date()) throw createAppError(ERROR_CODES.APPROVAL_TOKEN_EXPIRED);
  return record;
}

/**
 * Read-only lookup for the approval CONFIRMATION page. Validates the token
 * exists, is unused, and hasn't expired, and returns the doctor's name plus the
 * Seazona client this approval would confirm — WITHOUT consuming the token or
 * mutating any state. The consuming write happens only in processApproval
 * (invoked by the POST). This is what makes the GET safe against mail-scanner /
 * prefetch auto-approval.
 */
export async function getApprovalPreview(token) {
  const record = await loadUsableApprovalToken(token);

  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, record.userId))
    .limit(1);

  if (!user) throw createAppError(ERROR_CODES.USER_NOT_FOUND);

  return {
    doctorName: user.name,
    seazonaClient: record.seazonaClientId
      ? { clientId: record.seazonaClientId, label: record.seazonaClientLabel }
      : null,
  };
}

export async function processApproval(token, action) {
  if (!Object.values(APPROVAL_ACTIONS).includes(action)) {
    throw createAppError(ERROR_CODES.APPROVAL_TOKEN_INVALID);
  }

  const record = await loadUsableApprovalToken(token);

  // Load the user
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      pendingSeazonaClientId: users.pendingSeazonaClientId,
    })
    .from(users)
    .where(eq(users.id, record.userId))
    .limit(1);

  if (!user) throw createAppError(ERROR_CODES.USER_NOT_FOUND);

  // Consume the token — conditionally, so two concurrent clicks can't both act.
  const consumed = await db
    .update(approvalTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(approvalTokens.id, record.id), isNull(approvalTokens.usedAt)))
    .returning({ id: approvalTokens.id });
  if (!consumed.length) throw createAppError(ERROR_CODES.APPROVAL_TOKEN_INVALID);

  if (action === APPROVAL_ACTIONS.REJECT) {
    await db
      .update(users)
      .set({
        approvalStatus: "rejected",
        pendingSeazonaClientId: null,
        pendingSeazonaAccountNumber: null,
        pendingSeazonaLinkApprovedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await emailService.sendDoctorRejected({ email: user.email, name: user.name });

    return { rejected: true, doctorName: user.name };
  }

  // Approve. The client is confirmed only by "approve", only for the client id
  // bound into THIS token, and only if that is still the user's pending
  // suggestion — the bound id can't be swapped for another after the admin saw it.
  const confirmsClient =
    action === APPROVAL_ACTIONS.APPROVE &&
    record.seazonaClientId != null &&
    String(record.seazonaClientId) === String(user.pendingSeazonaClientId);

  const set = { approvalStatus: "approved", updatedAt: new Date() };
  if (confirmsClient) {
    set.pendingSeazonaLinkApprovedAt = new Date();
  } else {
    // Approved without confirming the client: discard the suggestion.
    set.pendingSeazonaClientId = null;
    set.pendingSeazonaAccountNumber = null;
    set.pendingSeazonaLinkApprovedAt = null;
  }
  await db.update(users).set(set).where(eq(users.id, user.id));

  // If the email is already verified, this completes the link now; otherwise
  // verifyEmail will.
  const linked = confirmsClient ? await completePendingSeazonaLink(user.id) : false;

  const loginUrl = `${env.APP_URL}/login`;
  await emailService.sendDoctorApproved({ email: user.email, name: user.name, loginUrl });

  return {
    approved: true,
    doctorName: user.name,
    seazonaClientConfirmed: confirmsClient,
    seazonaLinked: linked,
  };
}
