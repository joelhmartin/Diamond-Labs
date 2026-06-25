import { db } from "../config/database.js";
import { auditLog } from "../db/schema/index.js";
import { createId } from "../lib/id.js";

export async function log({ userId, accountId, action, targetType, targetId, metadata, ipAddress }) {
  await db.insert(auditLog).values({
    id: createId(),
    userId: userId || null,
    accountId: accountId || null,
    action,
    targetType: targetType || null,
    targetId: targetId || null,
    metadata: metadata || {},
    ipAddress: ipAddress || null,
  });
}

/**
 * Audit write that NEVER throws — audit logging must not break the action it
 * records (e.g. a charge already hit the card). On failure it logs an alertable
 * line and swallows. Prefer this from payment / money paths.
 *
 * We intentionally AWAIT the insert rather than detaching it (fire-and-forget):
 *   • it's a single indexed insert (sub-millisecond, negligible next to the
 *     Authorize.net call it follows), and
 *   • this API runs on Cloud Run, which throttles CPU after the response is
 *     sent — a detached write could be dropped mid-flight, which is unacceptable
 *     for a compliance audit trail. Durability wins over shaving ~1ms.
 */
export async function logSafe(entry) {
  try {
    await log(entry);
  } catch (err) {
    console.error(`[AUDIT] write failed for action="${entry?.action}":`, String(err?.message || err));
  }
}
