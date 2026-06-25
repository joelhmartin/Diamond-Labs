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
 * Fire-and-forget audit write that NEVER throws — audit logging must not break
 * the action it records (e.g. a charge already hit the card). On failure it logs
 * an alertable line and swallows. Prefer this from payment / money paths.
 */
export async function logSafe(entry) {
  try {
    await log(entry);
  } catch (err) {
    console.error(`[AUDIT] write failed for action="${entry?.action}":`, String(err?.message || err));
  }
}
