import { eq, and, asc } from "drizzle-orm";
import { db } from "../../config/database.js";
import { rxCaseLines } from "../../db/schema/index.js";
import { resolveLineItems } from "./catalog-map/index.js";
import { createId } from "../../lib/id.js";

/**
 * Pure: devices -> line drafts. No database, so the interesting part is
 * testable on its own.
 *
 * An unmapped selection becomes a line with status "open" and a null code —
 * never a guess. It keeps its mapKey so staff can resolve it, and so an
 * "always" resolution can be written to rx_code_overrides under that key.
 */
export function linesForDevices(devices = [], { overrides = {} } = {}) {
  const out = [];
  for (const d of devices) {
    const { items, unmapped } = resolveLineItems(
      { deviceKey: d.deviceKey, deviceOptions: d.deviceOptions || {} },
      { overrides }
    );
    for (const it of items) {
      out.push({
        seazonaCode: it.code,
        seazonaProductId: it.seazonaProductId ?? null,
        name: it.name,
        arch: it.arch ?? null,
        mapKey: it.mapKey ?? null,
        status: it.status ?? "confirmed",
        origin: "auto",
        // A noteOnly override resolves to a line item carrying noteOnly:
        // true (see catalog-map/index.js's itemFromOverride) — that ruling
        // has to survive into the persisted line, not get flattened back to
        // false, or every future case hits the same open question again.
        noteOnly: it.noteOnly ?? false,
        sourceLabel: null,
      });
    }
    for (const key of unmapped) {
      out.push({
        seazonaCode: null,
        seazonaProductId: null,
        name: null,
        arch: null,
        mapKey: key,
        status: "open",
        origin: "auto",
        noteOnly: false,
        sourceLabel: key,
      });
    }
  }
  return out.map((l, i) => ({ ...l, position: i }));
}

/** Insert the seeded lines for a case. Call inside the submit transaction. */
export async function seedLines(caseId, devices, { overrides = {}, tx = db } = {}) {
  const drafts = linesForDevices(devices, { overrides });
  if (drafts.length === 0) return;
  await tx.insert(rxCaseLines).values(
    drafts.map((l) => ({ ...l, id: createId(), caseId }))
  );
}

/**
 * Recompute the "auto" lines, leaving "manual" ones untouched.
 *
 * Explicit, never automatic: a case someone has already corrected must not
 * change under them because a mapping was answered elsewhere.
 *
 * Re-resolve renumbers: kept manual lines take 0..n-1 in their existing
 * relative order, then the regenerated auto lines follow. A manual line's
 * old position relative to auto lines is meaningless once the auto set has
 * changed, so a stable total order beats preserving a stale relationship.
 */
export async function reResolveLines(caseId, devices, { overrides = {}, tx = db } = {}) {
  const existing = await tx
    .select()
    .from(rxCaseLines)
    .where(eq(rxCaseLines.caseId, caseId))
    .orderBy(asc(rxCaseLines.position));
  const kept = existing.filter((l) => l.origin === "manual");

  await tx.delete(rxCaseLines).where(
    and(eq(rxCaseLines.caseId, caseId), eq(rxCaseLines.origin, "auto"))
  );

  // Renumber kept rows deterministically rather than assuming they already
  // occupy 0..kept.length-1 — nothing establishes that, and with no unique
  // constraint on (caseId, position) a wrong assumption here silently
  // collides with the regenerated auto lines instead of erroring.
  for (let i = 0; i < kept.length; i++) {
    if (kept[i].position !== i) {
      await tx.update(rxCaseLines).set({ position: i }).where(eq(rxCaseLines.id, kept[i].id));
    }
  }

  const drafts = linesForDevices(devices, { overrides });
  if (drafts.length > 0) {
    await tx.insert(rxCaseLines).values(
      drafts.map((l, i) => ({ ...l, id: createId(), caseId, position: kept.length + i }))
    );
  }
  return { replaced: drafts.length, kept: kept.length };
}
