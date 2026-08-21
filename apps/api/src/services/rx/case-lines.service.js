import { eq, and } from "drizzle-orm";
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
        seazonaProductId: null,
        name: it.name,
        arch: it.arch ?? null,
        mapKey: it.mapKey ?? null,
        status: it.status ?? "confirmed",
        origin: "auto",
        noteOnly: false,
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
 */
export async function reResolveLines(caseId, devices, { overrides = {}, tx = db } = {}) {
  const existing = await tx.select().from(rxCaseLines).where(eq(rxCaseLines.caseId, caseId));
  const kept = existing.filter((l) => l.origin === "manual");

  await tx.delete(rxCaseLines).where(
    and(eq(rxCaseLines.caseId, caseId), eq(rxCaseLines.origin, "auto"))
  );

  const drafts = linesForDevices(devices, { overrides });
  if (drafts.length > 0) {
    await tx.insert(rxCaseLines).values(
      drafts.map((l, i) => ({ ...l, id: createId(), caseId, position: kept.length + i }))
    );
  }
  return { replaced: drafts.length, kept: kept.length };
}
