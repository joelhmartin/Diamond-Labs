import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import { env } from "../config/env.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);

// Every JWT we mint is signed with the same secret and alg, so the token's
// PURPOSE has to be carried in the payload and checked on the way back in.
// Without this, a token issued for one step of a flow is accepted anywhere a
// token is accepted — e.g. the short-lived MFA token handed out after password
// verification but BEFORE the second factor would authenticate a full session,
// making MFA decorative. Each verifier below asserts its own type.
const TOKEN_TYPE_ACCESS = "access";
const TOKEN_TYPE_MFA = "mfa";

export async function signAccessToken(payload) {
  return new SignJWT({ ...payload, type: TOKEN_TYPE_ACCESS })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRY)
    .sign(secret);
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  // Fail closed on anything that is not explicitly an access token. Access
  // tokens issued before this check existed carry no `type` and are rejected;
  // they expire in 15m and the client's 401 -> /auth/refresh -> retry
  // interceptor mints a conforming one, so the practical cost is one refresh.
  if (payload.type !== TOKEN_TYPE_ACCESS) throw new Error("Invalid access token type");
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
  return new SignJWT({ sub: userId, type: TOKEN_TYPE_MFA })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

export async function verifyMfaToken(token) {
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  if (payload.type !== TOKEN_TYPE_MFA) throw new Error("Invalid MFA token type");
  return payload;
}
