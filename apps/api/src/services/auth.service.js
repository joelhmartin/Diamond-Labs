import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { users, accounts, memberships, sessions, doctorProfiles, approvalTokens } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
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
import { ERROR_CODES, slugify } from "@my-app/shared";
import { env } from "../config/env.js";
import * as seazonaService from "./seazona.service.js";
import * as emailService from "./email.service.js";

const LOGIN_ATTEMPTS_PREFIX = "login_attempts:";
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60; // 15 minutes in seconds

function createAppError(errorDef) {
  const err = new Error(errorDef.message);
  err.statusCode = errorDef.status;
  err.code = errorDef.code;
  return err;
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
    await recordFailedLogin(email);
    throw createAppError(ERROR_CODES.INVALID_CREDENTIALS);
  }

  if (user.status === "suspended") throw createAppError(ERROR_CODES.USER_SUSPENDED);
  if (user.status === "deleted") throw createAppError(ERROR_CODES.INVALID_CREDENTIALS);

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(email);
    throw createAppError(ERROR_CODES.INVALID_CREDENTIALS);
  }

  await clearLoginAttempts(email);

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
    user: { id: user.id, email: user.email, name: user.name },
    accessToken,
    refreshToken,
  };
}

export async function verifyMfa({ mfaToken, code, ip, userAgent }) {
  const payload = await verifyMfaToken(mfaToken);
  const userId = payload.sub;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.mfaSecret) throw createAppError(ERROR_CODES.MFA_INVALID_CODE);

  const valid = verifyMfaCode(user.mfaSecret, code);
  if (!valid) throw createAppError(ERROR_CODES.MFA_INVALID_CODE);

  const accessToken = await signAccessToken({ sub: user.id });
  const refreshToken = generateRefreshToken();
  await createSession(user.id, refreshToken, ip, userAgent);

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  return {
    user: { id: user.id, email: user.email, name: user.name },
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
}

export async function requestMagicLink(email) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Always return success to avoid email enumeration
  if (!user) return { token: null };

  const token = generateSecureToken();
  await redis.set(`magic_link:${token}`, user.id, "EX", 15 * 60); // 15 minutes
  return { token, userId: user.id };
}

export async function verifyMagicLink({ token, ip, userAgent }) {
  const userId = await redis.get(`magic_link:${token}`);
  if (!userId) throw createAppError(ERROR_CODES.TOKEN_INVALID);

  await redis.del(`magic_link:${token}`);

  // Mark email as verified if not already
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), lastLoginAt: new Date(), updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.emailVerifiedAt, null)));

  // Update last login for already-verified users
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));

  const accessToken = await signAccessToken({ sub: userId });
  const refreshToken = generateRefreshToken();
  await createSession(userId, refreshToken, ip, userAgent);

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return { user, accessToken, refreshToken };
}

export async function setupMfa(userId) {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw createAppError(ERROR_CODES.USER_NOT_FOUND);

  const { secret, uri } = generateMfaSecret(user.email);

  // Store secret temporarily until confirmed
  await redis.set(`mfa_setup:${userId}`, secret, "EX", 10 * 60); // 10 minutes

  return { secret, uri };
}

export async function enableMfa(userId, code) {
  const secret = await redis.get(`mfa_setup:${userId}`);
  if (!secret) throw createAppError({ ...ERROR_CODES.TOKEN_EXPIRED, message: "MFA setup expired. Please start again." });

  const valid = verifyMfaCode(secret, code);
  if (!valid) throw createAppError(ERROR_CODES.MFA_INVALID_CODE);

  await db
    .update(users)
    .set({ mfaSecret: secret, mfaEnabled: true, updatedAt: new Date() })
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

  // Try to find existing Seazona client by email, then by phone
  let seazonaClientId = null;
  let seazonaAccountNumber = null;

  const emailMatch = await seazonaService.checkLoginExists(data.email);
  if (emailMatch && emailMatch.clientId) {
    seazonaClientId = String(emailMatch.clientId);
    seazonaAccountNumber = emailMatch.accountNumber ? String(emailMatch.accountNumber) : null;
  } else if (data.phone) {
    const phoneMatch = await seazonaService.findClientByPhone(data.phone);
    if (phoneMatch) {
      seazonaClientId = String(phoneMatch.clientId || phoneMatch.id);
      seazonaAccountNumber = phoneMatch.accountNumber ? String(phoneMatch.accountNumber) : null;
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
    seazonaClientId,
    seazonaAccountNumber,
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
  });

  // Send admin notification email
  const baseUrl = env.API_URL || env.APP_URL;
  const approveUrl = `${baseUrl}/api/v1/auth/approve/${token}?action=approve`;
  const rejectUrl = `${baseUrl}/api/v1/auth/approve/${token}?action=reject`;

  await emailService.sendAdminApprovalRequest({
    doctorName: data.name,
    doctorEmail: data.email,
    npiNumber: data.npiNumber,
    companyName: data.companyName,
    approveUrl,
    rejectUrl,
  });

  return { message: "Registration submitted. Awaiting admin approval." };
}

export async function processApproval(token, action) {
  if (!["approve", "reject"].includes(action)) {
    throw createAppError(ERROR_CODES.APPROVAL_TOKEN_INVALID);
  }

  // Look up the token
  const [record] = await db
    .select()
    .from(approvalTokens)
    .where(eq(approvalTokens.token, token))
    .limit(1);

  if (!record) throw createAppError(ERROR_CODES.APPROVAL_TOKEN_INVALID);
  if (record.usedAt) throw createAppError(ERROR_CODES.APPROVAL_TOKEN_INVALID);
  if (new Date(record.expiresAt) <= new Date()) throw createAppError(ERROR_CODES.APPROVAL_TOKEN_EXPIRED);

  // Load the user
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, record.userId))
    .limit(1);

  if (!user) throw createAppError(ERROR_CODES.USER_NOT_FOUND);

  // Mark token as used
  await db
    .update(approvalTokens)
    .set({ usedAt: new Date() })
    .where(eq(approvalTokens.id, record.id));

  if (action === "approve") {
    await db
      .update(users)
      .set({ approvalStatus: "approved", updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const loginUrl = `${env.APP_URL}/login`;
    await emailService.sendDoctorApproved({ email: user.email, name: user.name, loginUrl });

    return { approved: true, doctorName: user.name };
  } else {
    await db
      .update(users)
      .set({ approvalStatus: "rejected", updatedAt: new Date() })
      .where(eq(users.id, user.id));

    await emailService.sendDoctorRejected({ email: user.email, name: user.name });

    return { rejected: true, doctorName: user.name };
  }
}
