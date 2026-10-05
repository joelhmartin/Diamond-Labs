import { eq, and, asc } from "drizzle-orm";
import { db } from "../../config/database.js";
import { rxCaseLines } from "../../db/schema/index.js";
import { resolveLineItems, resolveCaseServices, isDeviceLine } from "./catalog-map/index.js";
import { createId } from "../../lib/id.js";

// Re-exported so existing importers keep working; the pure implementation
// lives in case-devices.js so the push path can use it without the database.
export { devicesForCase } from "./case-devices.js";

/** A resolved line item -> a line draft. */
const draftFromItem = (it) => ({
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

/** An unresolved selection -> an open line draft that blocks the push. */
const openDraft = (mapKey, sourceLabel = mapKey) => ({
  seazonaCode: null,
  seazonaProductId: null,
  name: null,
  arch: null,
  mapKey,
  status: "open",
  origin: "auto",
  noteOnly: false,
  sourceLabel,
});

/**
 * Pure: devices (+ the case's raw form answers) -> line drafts. No database,
 * so the interesting part is testable on its own.
 *
 * An unmapped selection becomes a line with status "open" and a null code —
 * never a guess. It keeps its mapKey so staff can resolve it, and so an
 * "always" resolution can be written to rx_code_overrides under that key.
 *
 * `formData` adds the case-level lab-service lines (model fabrication,
 * duplication, …; see catalog-map/lab-services.js). Seed and re-resolve both
 * pass it, so the two always agree. A case without formData (the retired
 * wizard) gets device lines only.
 *
 * A device that resolved to no appliance line at all — and flagged nothing —
 * gets an open line naming it. Without one, a case whose only lines are lab
 * services or modifications would pass the push gate as an order with no
 * appliance on it.
 */
export function linesForDevices(devices = [], { overrides = {}, formData } = {}) {
  const out = [];
  for (const d of devices) {
    const { items, unmapped } = resolveLineItems(
      { deviceKey: d.deviceKey, deviceOptions: d.deviceOptions || {} },
      { overrides }
    );
    for (const it of items) out.push(draftFromItem(it));
    for (const key of unmapped) out.push(openDraft(key));
    if (unmapped.length === 0 && !items.some((it) => isDeviceLine(it.mapKey))) {
      out.push(openDraft(null, `no device line resolved for ${d.label || d.deviceKey || "a device"}`));
    }
  }
  if (formData) {
    const { items, unmapped } = resolveCaseServices(formData, devices, { overrides });
    for (const it of items) out.push(draftFromItem(it));
    for (const key of unmapped) out.push(openDraft(key));
  }
  return out.map((l, i) => ({ ...l, position: i }));
}

/** Insert the seeded lines for a case. Call inside the submit transaction. */
export async function seedLines(caseId, devices, { overrides = {}, formData, tx = db } = {}) {
  const drafts = linesForDevices(devices, { overrides, formData });
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
export async function reResolveLines(caseId, devices, { overrides = {}, formData, tx = db } = {}) {
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

  const drafts = linesForDevices(devices, { overrides, formData });
  if (drafts.length > 0) {
    await tx.insert(rxCaseLines).values(
      drafts.map((l, i) => ({ ...l, id: createId(), caseId, position: kept.length + i }))
    );
  }
  return { replaced: drafts.length, kept: kept.length };
}
