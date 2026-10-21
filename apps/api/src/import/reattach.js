import { and, inArray, isNull, sql } from "drizzle-orm";
import { auditImport } from "./audit.js";

const BATCH = 500;

/**
 * THE guarded owner-attach for any imported table (legacy invoices, legacy
 * lab orders): only rows still unowned change, each changed batch bumps
 * `version` and writes one audit entry (owner id, planned and changed counts,
 * Seazona ids; no PHI). `plan` is owner user id → legacy keys.
 *
 * cfg: { table, ownerCol, keyCol, versionCol, updatedCol, scope (a where
 * condition: e.g. kind = legacy), action, targetType, metadataKey, guard? }.
 * Returns how many rows were attached.
 */
export async function reattachOwners(db, plan, cfg) {
  let attached = 0;
  for (const [owner, ids] of plan) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      cfg.guard?.();
      await db.transaction(async (tx) => {
        const rows = await tx.update(cfg.table)
          .set({ [cfg.ownerField]: owner, version: sql`${cfg.versionCol} + 1`, updatedAt: new Date() })
          .where(and(cfg.scope, isNull(cfg.ownerCol), inArray(cfg.keyCol, batch)))
          .returning({ id: cfg.table.id });
        attached += rows.length;
        if (rows.length) {
          await auditImport(tx, {
            action: cfg.action, targetType: cfg.targetType,
            metadata: { ownerUserId: owner, planned: batch.length, changed: rows.length, [cfg.metadataKey]: batch },
          });
        }
      });
    }
  }
  return attached;
}

/** Add `key` under `owner` in a reattach plan (owner → keys). */
export function planAttach(out, owner, key) {
  out.set(owner, [...(out.get(owner) ?? []), key]);
}

