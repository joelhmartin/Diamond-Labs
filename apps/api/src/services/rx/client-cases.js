import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../config/database.js";
import { rxCases } from "../../db/schema/index.js";
import { canActForAccount, clientScopeOf, requestedAccounts } from "../client-scope.js";

/**
 * My Cases (spec "API routes": GET /rx/cases?account=, /:id, /:id/files/:fileId):
 * a client reads the cases of the practices in their scope, by the case's own
 * practice (rx_cases.account_id, stamped at submit). The owner no longer
 * matters: a practice's staff see every case of that practice, a group admin
 * every case of the group, and a case with no practice (a backfill gap) fails
 * closed to staff only, even for the doctor who sent it.
 */

/**
 * The raw rows (PHI still sealed), newest first, of the practices `account`
 * asks for: absent / "all" = the whole scope, an id in scope = that practice,
 * anything else 404 (requestedAccounts). An empty scope reads nothing.
 */
export async function listClientCases(user, account, { database = db } = {}) {
  const accountIds = requestedAccounts(clientScopeOf(user), account);
  if (!accountIds.length) return [];
  return database.select().from(rxCases).where(inArray(rxCases.accountId, accountIds)).orderBy(desc(rxCases.createdAt));
}

/** One case row when its practice is in the login's scope; null when missing or not theirs (the route answers 404 either way). */
export async function loadClientCase(user, id, { database = db } = {}) {
  if (typeof id !== "string" || !id) return null;
  const [row] = await database.select().from(rxCases).where(eq(rxCases.id, id));
  return row && canActForAccount(clientScopeOf(user), row.accountId) ? row : null;
}
