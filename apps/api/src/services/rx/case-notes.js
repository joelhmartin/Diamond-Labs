// Design intent with no product code — occlusal contact, design preference,
// guard clearance, VDO/titration, ortho build answers, rush — rendered as
// text. Line items are never derived from these. Printed as "Build notes"
// on the lab order page and the work ticket; the Rx mapping preview shows
// the same text. (Formerly the Seazona order-notes builder.)
import { guardMatrixNotes } from "./catalog-map/resolvers/guard.js";
import { orthoBuildNotes } from "./catalog-map/resolvers/ortho.js";

/**
 * Format a single device's structured options into readable note fragments.
 * Shared by compileNotes (single device) and compileNotesMulti (per device).
 *
 * Matches how the lab actually builds orders in Seazona (verified against live
 * orders, e.g. inv 10601): device + material/variant and each modification are
 * PRODUCT LINE ITEMS (resolved by catalog-map/index.js), NOT notes. So material,
 * variant, and modifications are deliberately excluded here. Notes carry only
 * free-text clinical detail that has no product code — occlusal contact, design
 * preference (the lab never bills their $0 catalog items; see
 * attributes.table.js), VDO/titration, the guard matrix's clearance / teeth /
 * colour cells, and device-specific instructions.
 */
function deviceOptionLines(o = {}) {
  const lines = [];
  if (o.occlusalContact)  lines.push(`Occlusal Contact: ${o.occlusalContact}`);
  if (o.designPreference) lines.push(`Design Preference: ${o.designPreference}`);
  // The retired wizard's DDSO `design` and guard `thickness` — both required
  // there, and stored on its cases with no other channel (follow-up 1).
  if (o.design)           lines.push(`Design: ${o.design}`);
  if (o.thickness)        lines.push(`Thickness: ${o.thickness}`);
  lines.push(...guardMatrixNotes(o.standardGuards));
  lines.push(...orthoBuildNotes(o));
  if (o.titration)        lines.push(`VDO/Titration: ${JSON.stringify(o.titration)}`);
  if (o.titrationPlacement?.length) lines.push(`Place vertical titration on: ${[].concat(o.titrationPlacement).join(", ")}`);
  // Build instructions the lab never bills (e.g. "Wrap distal of last molars").
  if (o.instructions?.length) lines.push(`Instructions: ${[].concat(o.instructions).join("; ")}`);
  if (o.comments)         lines.push(`Device notes: ${o.comments}`);
  return lines;
}

/**
 * Order-level (shared) note fragments — emitted ONCE per order. Records method,
 * physical bite, and first-device are NOT noted on real orders (records are
 * conveyed via the uploaded scan files). Rush is the only operational flag with
 * no other home in the notes, so it stays.
 */
function sharedNoteLines(c = {}) {
  const lines = [];
  if (c.rush) lines.push(`RUSH (${c.rushTier || "?"})`);
  return lines;
}

/**
 * Compile structured deviceOptions + top-level case fields into a single notes string.
 */
export function compileNotes(c) {
  const lines = [...deviceOptionLines(c.deviceOptions || {}), ...sharedNoteLines(c)];
  if (c.generalComments) lines.push(`General: ${c.generalComments}`);
  return lines.join(" | ");
}

/**
 * Multi-device notes: one "[<label>] <opts>" fragment per device, then the
 * shared order fields ONCE. Never dumps arbitrary fields.
 *
 * @param {object} shared  — order-level fields (physicalBite/recordsMethod/firstDevice/rush/rushTier)
 * @param {Array<{label?:string, deviceKey?:string, deviceOptions?:object}>} devices
 */
export function compileNotesMulti(shared = {}, devices = []) {
  const lines = [];
  for (const d of devices) {
    const opts = deviceOptionLines(d.deviceOptions || {}).join(", ");
    const label = d.label || d.deviceKey || "device";
    lines.push(opts ? `[${label}] ${opts}` : `[${label}]`);
  }
  lines.push(...sharedNoteLines(shared));
  return lines.join(" | ");
}
