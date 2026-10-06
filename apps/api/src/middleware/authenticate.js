import { verifyAccessToken } from "../lib/tokens.js";
import { db } from "../config/database.js";
import { users } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { ERROR_CODES } from "@my-app/shared";

/**
 * Resolve the bearer token to an active user.
 * -> { user } on success; { user: null, presented: false } when no token was
 *   sent; { user: null, presented: true, error } when one was sent and failed.
 */
async function resolveBearerUser(request) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, presented: false, error: ERROR_CODES.UNAUTHORIZED };
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verifyAccessToken(token);
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        status: users.status,
        role: users.role,
        approvalStatus: users.approvalStatus,
        seazonaClientId: users.seazonaClientId,
        seazonaAccountNumber: users.seazonaAccountNumber,
        authorizeNetCustomerProfileId: users.authorizeNetCustomerProfileId,
        defaultPaymentProfileId: users.defaultPaymentProfileId,
        emailVerifiedAt: users.emailVerifiedAt,
        mfaEnabled: users.mfaEnabled,
      })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!user || user.status !== "active") {
      return { user: null, presented: true, error: ERROR_CODES.UNAUTHORIZED };
    }
    return { user, presented: true };
  } catch {
    return { user: null, presented: true, error: ERROR_CODES.TOKEN_EXPIRED };
  }
}

export async function authenticate(request, reply) {
  const r = await resolveBearerUser(request);
  if (!r.user) return reply.code(401).send({ error: r.error });
  request.user = r.user;
}

/**
 * For public routes whose answer depends on who is asking (client pricing).
 * No token -> guest. A token that fails -> 401, so the client refreshes and
 * retries instead of being quietly priced as a guest.
 */
export async function optionalAuthenticate(request, reply) {
  const r = await resolveBearerUser(request);
  if (r.user) {
    request.user = r.user;
    return;
  }
  if (r.presented) return reply.code(401).send({ error: r.error });
}
