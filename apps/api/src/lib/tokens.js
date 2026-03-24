import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import { env } from "../config/env.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);

export async function signAccessToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRY)
    .sign(secret);
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, secret);
  return payload;
}

export function generateRefreshToken() {
  return crypto.randomBytes(40).toString("hex");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateSecureToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generate a short-lived MFA token (used between password verification and TOTP entry).
 */
export async function signMfaToken(userId) {
  return new SignJWT({ sub: userId, type: "mfa" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

export async function verifyMfaToken(token) {
  const { payload } = await jwtVerify(token, secret);
  if (payload.type !== "mfa") throw new Error("Invalid MFA token type");
  return payload;
}
