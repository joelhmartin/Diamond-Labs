import { db } from "../config/database.js";
import { memberships, accounts } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
import { ERROR_CODES } from "@my-app/shared";

/**
 * Resolves accountId from route params or x-account-id header,
 * then loads the user's membership for that account.
 */
export async function requireAccount(request, reply) {
  const accountId = request.params.accountId || request.headers["x-account-id"];
  if (!accountId) {
    return reply.code(400).send({
      error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Account ID is required." },
    });
  }

  // Verify account exists and is active
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.status, "active")))
    .limit(1);

  if (!account) {
    return reply.code(404).send({ error: ERROR_CODES.ACCOUNT_NOT_FOUND });
  }

  // Load membership
  const [membership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, request.user.id),
        eq(memberships.accountId, accountId),
      )
    )
    .limit(1);

  if (!membership) {
    return reply.code(403).send({ error: ERROR_CODES.NOT_ACCOUNT_MEMBER });
  }

  request.account = account;
  request.membership = membership;
}
