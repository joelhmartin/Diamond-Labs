import { resolveLineItems } from "./device-seazona-map.js";

/**
 * Pure function: rxCase + { codeToId, userId } → { payload, warnings, unmapped }.
 *
 * @param {object} rxCase        — stored Rx case record
 * @param {object} opts
 * @param {Record<string,string>} opts.codeToId — Seazona product code → catalog id
 *                                               (built from listProducts() by the caller)
 * @param {string}  opts.userId  — lab-staff Seazona user id to attach to the order
 * @returns {{ payload: object, warnings: string[], unmapped: string[] }}
 */
export function buildSeazonaOrderPayload(rxCase, { codeToId = {}, userId } = {}) {
  const { items: lineItems, unmapped } = resolveLineItems(rxCase);

  const items = [];
  // Seed warnings from unmapped device/option selections that resolveLineItems already flagged.
  const warnings = unmapped.map((u) => `unmapped ${u}`);

  for (const li of lineItems) {
    const id = codeToId[li.code];
    if (!id) {
      warnings.push(`no catalog id for code ${li.code} (${li.name})`);
      continue;
    }
    items.push({ id, arch: normalizeArch(li.arch) });
  }

  return {
    payload: {
      clientId: rxCase.seazonaClientId,
      patientName: `${rxCase.patientFirst ?? ""} ${rxCase.patientLast ?? ""}`.trim(),
      due: rxCase.dueDate || null,
      items,
      notes: compileNotes(rxCase),
      userId,
    },
    warnings,
    unmapped,
  };
}

/**
 * Normalize wizard arch strings → Seazona numeric codes.
 *   "Upper" → 1, "Lower" → 2, anything else (incl. "Both", null, undefined) → null.
 * Also passes through numeric 1/2 unchanged (already normalized).
 */
function normalizeArch(arch) {
  if (arch === 1 || arch === 2) return arch;
  if (typeof arch === "string") {
    const a = arch.toLowerCase();
    if (a === "upper") return 1;
    if (a === "lower") return 2;
  }
  return null; // covers "Both", null, undefined, and any other string
}

/**
 * Compile structured deviceOptions + top-level case fields into a single notes string.
 * Seazona notes are limited to 2000 characters.
 */
function compileNotes(c) {
  const o = c.deviceOptions || {};
  const lines = [];

  if (o.occlusalContact)  lines.push(`Occlusal Contact: ${o.occlusalContact}`);
  if (o.designPreference) lines.push(`Design Preference: ${o.designPreference}`);
  if (o.baseMaterial)     lines.push(`Material: ${o.baseMaterial}`);
  if (o.variant)          lines.push(`Design: ${o.variant}`);
  if (Array.isArray(o.modifications) && o.modifications.length) {
    lines.push(`Modifications: ${o.modifications.join(", ")}`);
  }
  if (o.titration)        lines.push(`Titration: ${JSON.stringify(o.titration)}`);
  if (o.comments)         lines.push(`Device notes: ${o.comments}`);

  if (c.physicalBite)     lines.push(`Physical bite: ${c.physicalBite}`);
  if (c.recordsMethod)    lines.push(`Records: ${c.recordsMethod}`);
  if (c.firstDevice)      lines.push(`First device: ${c.firstDevice}`);
  if (c.rush)             lines.push(`RUSH (${c.rushTier || "?"})`);
  if (c.generalComments)  lines.push(`General: ${c.generalComments}`);

  return lines.join(" | ").slice(0, 2000);
}
