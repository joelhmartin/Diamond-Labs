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
 * Fire-and-forget audit write that NEVER throws and NEVER blocks the caller.
 * Audit logging must not break OR delay the action it records (e.g. a charge
 * already hit the card; a slow/stuck audit insert shouldn't hold the response).
 * The write is detached — callers may `await logSafe(...)` and resolve
 * immediately — and failures are swallowed with an alertable log line.
 *
 * Durability note: the authoritative records for money events live elsewhere
 * (the `invoice_payments` ledger + structured `[PAYMENT]…` console lines in
 * Cloud Logging); this `audit_log` row powers the admin history *view*. So if a
 * detached write is dropped (e.g. Cloud Run throttling CPU post-response), no
 * source-of-truth data is lost.
 */
export function logSafe(entry) {
  Promise.resolve()
    .then(() => log(entry))
    .catch((err) => {
      console.error(`[AUDIT] write failed for action="${entry?.action}":`, String(err?.message || err));
    });
}
