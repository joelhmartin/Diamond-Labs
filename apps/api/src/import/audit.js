import { auditLog } from "../db/schema/index.js";
import { createId } from "../lib/id.js";

/**
 * An audit row for an import step that changes existing records, written in
 * the caller's transaction. The app's audit.service.js imports config/database.js,
 * which import tools must not load (plumbing-load.test.js), so this is the
 * import-side writer. Pass ids and counts only: never a name, address or line text.
 */
export function auditImport(tx, { action, targetType, metadata }) {
  return tx.insert(auditLog).values({
    id: createId(), userId: null, accountId: null, action, targetType: targetType ?? null, targetId: null, metadata: metadata ?? {}, ipAddress: null,
  });
}
