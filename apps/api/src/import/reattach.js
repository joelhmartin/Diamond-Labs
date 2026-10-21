import { and, inArray, isNull, sql } from "drizzle-orm";
import { auditImport } from "./audit.js";

const BATCH = 500;

/**
 * THE guarded owner-attach for any imported table (legacy invoices, legacy
 * lab orders): only rows still unowned change, each changed batch bumps
 * `version` and writes one audit entry (owner id, planned and changed counts,
 * Seazona ids; no PHI). `plan` is owner user id → legacy keys.
 *
 * cfg: { table, ownerField (the owner column's property name), ownerCol,
 * keyCol, versionCol, scope (a where condition: e.g. kind = legacy), action,
 * targetType, metadataKey, guard? }. `version` and `updatedAt` are set by
 * property name (every target table has both). Returns how many rows were attached.
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


/**
 * Clients whose already-loaded records are STILL unowned after this run's
 * reattach plan (so a re-run's report doesn't go quiet while records wait on a
 * link fix). rows: [{ clientUserId, clientId }] of loaded records; `ownerByClient`
 * is the resolved byClient map. Returns { records, clients: [client ids] }.
 */
export function stillUnowned(rows, ownerByClient) {
  const clients = new Set();
  let records = 0;
  for (const r of rows) {
    if (r.clientUserId || !r.clientId || ownerByClient.has(r.clientId)) continue;
    records += 1;
    clients.add(r.clientId);
  }
  return { records, clients: [...clients] };
}
