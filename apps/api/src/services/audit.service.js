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
