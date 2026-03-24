import { verifyAccessToken } from "../lib/tokens.js";
import { db } from "../config/database.js";
import { users } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { ERROR_CODES } from "@my-app/shared";

export async function authenticate(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.code(401).send({
      error: ERROR_CODES.UNAUTHORIZED,
    });
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
        emailVerifiedAt: users.emailVerifiedAt,
        mfaEnabled: users.mfaEnabled,
      })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user || user.status !== "active") {
      return reply.code(401).send({
        error: ERROR_CODES.UNAUTHORIZED,
      });
    }

    request.user = user;
  } catch {
    return reply.code(401).send({
      error: ERROR_CODES.TOKEN_EXPIRED,
    });
  }
}
