import { and, asc, eq } from "drizzle-orm";
import { accounts, memberships } from "../db/schema/index.js";
import { InvoiceError } from "./billing/invoice-rules.js";

/**
 * THE definition of "a practice this login can create records for": ACTIVE, DIRECT
 * memberships in ACTIVE client accounts. An unawaited query (account ids), shared by
 * practiceForNewRecord and every picker (listPractices memberUserId), so the list a
 * person is offered and the list the validator accepts cannot drift.
 */
export function directPracticeIdsQuery(tx, userId) {
  return tx
    .select({ accountId: memberships.accountId })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(
      eq(memberships.userId, userId),
      eq(memberships.status, "active"),
      eq(accounts.status, "active"),
      eq(accounts.isClient, true),
    ));
}

/**
 * Which practice (client account) a NEW case, order or invoice belongs to.
 * THE one rule every create path uses (rx submit, staff order entry, shop
 * checkout), so a record is stamped the same way wherever it starts.
 *
 * The owner's candidates are their ACTIVE, DIRECT memberships in ACTIVE client
 * accounts (`accounts.is_client`). Group admins reach sibling practices through
 * their organization, but a record is only ever created for a practice the
 * owner works in directly, so organization grants are not candidates.
 *
 *  - requested and a candidate  -> it
 *  - requested and not          -> NOT_FOUND (never says whether the account exists)
 *  - none requested, exactly 1  -> it
 *  - none requested, 2 or more  -> PRACTICE_REQUIRED (422)
 *  - no candidates              -> null (a shopper, a guest, or a doctor not yet backfilled)
 *
 * @param {object} tx a transaction or the db: only select is used
 * @param {{ ownerUserId: string|null, requestedAccountId?: string|null, directOnly?: boolean }} input
 * @returns {Promise<string|null>} the account id
 */
export async function practiceForNewRecord(tx, { ownerUserId, requestedAccountId = null, directOnly = true }) {
  if (!directOnly) throw new Error("practiceForNewRecord: directOnly=false is not supported (scope-wide callers arrive with client-scope.js).");
  if (!ownerUserId) {
    if (requestedAccountId) throw new InvoiceError("NOT_FOUND", "Not found.");
    return null;
  }
  const rows = await directPracticeIdsQuery(tx, ownerUserId).orderBy(asc(memberships.accountId));
  const candidates = rows.map((r) => r.accountId);
  if (requestedAccountId) {
    if (!candidates.includes(requestedAccountId)) throw new InvoiceError("NOT_FOUND", "Not found.");
    return requestedAccountId;
  }
  if (candidates.length > 1) throw new InvoiceError("PRACTICE_REQUIRED", "Choose which practice this is for.");
  return candidates[0] ?? null;
}
