/**
 * Nightguard resolver. The guard section is a matrix, not a single choice:
 * each row is an appliance, each row carries its own arch checkboxes and a
 * Base Material dropdown, and one submission may order several rows at once.
 *
 * TWO doctor-facing controls feed this resolver and BOTH must be honoured:
 *   - `standardGuards` — the 7-row Standard Guards/Splints matrix (qid 169)
 *   - `variant`        — the "Select Device:" image picker (qid 453,
 *                        `nightguardDevice`), plus the older wizard's own
 *                        device/base-material choice
 * A selection that this resolver cannot map must land in `unmapped`. It must
 * never vanish: a dropped doctor selection is the defect this module exists
 * to prevent.
 */

// row label → { material literal → code }, or { "*": code } when the appliance
// exists in exactly one form regardless of material.
const GUARD_MATRIX = {
  "Nightguard - Full Occlusion": {
    "PMT (Diamoform)": { code: "2164", name: "Nightguard-Single Arch PMT",    status: "confirmed" },
    "BIOMED (Printed)": { code: "2165", name: "Nightguard-Single Arch Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2166", name: "Nightguard-Single Arch Nylon",  status: "confirmed" },
    "Dual-Laminate":    { code: "2167", name: "Nightguard Dual Laminate",      status: "confirmed" },
    "Acrylic w/clasps": { code: "2428", name: "Nightguard (All-Acrylic)",      status: "proposed"  },
  },
  "Occlusal Guard - NTI Type": {
    "BIOMED (Printed)": { code: "2175", name: "NTI Slider-Type (Dual Arch) Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2176", name: "NTI Slider-Type (Dual Arch) Nylon",  status: "confirmed" },
  },
  "Michigan Splint - Anterior Guidance": {
    "BIOMED (Printed)": { code: "2169", name: "Michigan Splint Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2170", name: "Michigan Splint Nylon",  status: "confirmed" },
  },
  "Dual Arch - FLATPLANE": {
    "BIOMED (Printed)": { code: "2162", name: "FLATPLANE (Dual Arch) Biomed",  status: "confirmed" },
    "Nylon (Printed)":  { code: "2163", name: "FLATPLANE (Dual Arch) Nylon",   status: "confirmed" },
    "BioFlex":          { code: "2531", name: "FLATPLANE (Dual Arch) BioFlex", status: "confirmed" },
  },
  "Essix Tray":          { "*": { code: "2161", name: "Essix Tray Non Printed (per arch)", status: "confirmed" } },
  "Bleaching Trays":     { "*": { code: "2155", name: "Bleaching Tray (per arch)",         status: "confirmed" } },
  "Neurosensory Stent":  { "*": { code: "2597", name: "Neurostent BioFlex",                status: "proposed"  } },
  // Ambiguous: the catalog has both NTI Slider-Type (2175/2176) and FLATPLANE
  // (2162/2163/2531). Never guess — the lab must disambiguate.
  "Occlusal Guard - Slider Type": {},

  // ── Device-picker-only rows (qid 453 `nightguardDevice`). These are NOT rows
  // of the standardGuards matrix, so they only ever arrive as `variant`.
  // "Dual Arch - FLATPLANE" above is the third picker option and IS mapped.
  "Dual Arch - SLIDER": {},
  "Single Arch - NIGHTGUARD": {},
};

// Per-row explanation for rows with no catalog mapping, shown to the lab in the
// generated sign-off document. Falls back to the generic ambiguity sentence.
const OPEN_REASONS = {
  "Dual Arch - SLIDER":
    "The device picker offers this alongside FLATPLANE, but the catalog's only slider product is NTI Slider-Type (2175/2176). Are these the same appliance, and in which materials?",
  "Single Arch - NIGHTGUARD":
    "The device picker does not capture a base material, and single-arch nightguards exist in five (2164/2165/2166/2167/2428). Which one should a picker-only selection mean?",
};
const DEFAULT_OPEN_REASON =
  "Ambiguous — the catalog has more than one product for this appliance and the form does not say which.";

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Every appliance row this resolver knows about — exported for coverage tests. */
export const GUARD_ROW_LABELS = Object.keys(GUARD_MATRIX);

/** GUARD_MATRIX flattened to table-shaped rows, for the mapping report. */
export const GUARD_ROWS = Object.entries(GUARD_MATRIX).flatMap(([rowLabel, options]) => {
  const entries = Object.entries(options);
  if (entries.length === 0)
    return [{
      mapKey: `guard:${slug(rowLabel)}`,
      device: "guard",
      match: [rowLabel],
      code: null,
      name: rowLabel,
      status: "open",
      reason: OPEN_REASONS[rowLabel] || DEFAULT_OPEN_REASON,
    }];
  return entries.map(([material, v]) => ({
    mapKey: `guard:${slug(rowLabel)}:${material === "*" ? "any" : slug(material)}`,
    device: "guard",
    match: [material === "*" ? rowLabel : `${rowLabel} — ${material}`],
    code: v.code,
    name: v.name,
    status: v.status,
  }));
});

/**
 * Resolve ONE appliance row into line items (or one bare unmapped mapKey).
 * Shared by the matrix path and the device-picker path so the star-row `any`
 * rule and the material-keyed rule can never diverge between them.
 *
 * @param {string} rowLabel — a GUARD_MATRIX key, or any unrecognised literal
 * @param {string|undefined} material — the Base Material literal, if captured
 * @param {Array<string|null>} arches — one entry per line to emit
 * @param {{items: Array, unmapped: string[]}} out
 */
function resolveRow(rowLabel, material, arches, out) {
  const options = GUARD_MATRIX[rowLabel];
  if (!options || Object.keys(options).length === 0) {
    out.unmapped.push(`guard:${slug(rowLabel)}`);
    return;
  }

  const starRow = Boolean(options["*"]);
  const chosen = options["*"] || (material ? options[material] : undefined);
  if (!chosen) {
    out.unmapped.push(`guard:${slug(rowLabel)}:${slug(material || "no-material")}`);
    return;
  }

  const materialKey = starRow ? "any" : slug(material);
  for (const arch of arches)
    out.items.push({
      mapKey: `guard:${slug(rowLabel)}:${materialKey}`,
      code: chosen.code,
      name: chosen.name,
      arch,
      status: chosen.status,
    });
}

export function resolveGuard(deviceOptions = {}) {
  const out = { items: [], unmapped: [] };
  const matrix = deviceOptions.standardGuards || {};
  const handled = new Set();

  for (const [rowLabel, cells] of Object.entries(matrix)) {
    if (!cells) continue;
    const arches = [];
    if (cells["UPPER ARCH"]) arches.push("upper");
    if (cells["LOWER ARCH"]) arches.push("lower");
    if (arches.length === 0) continue; // row not ordered

    handled.add(rowLabel);
    resolveRow(rowLabel, cells["Base Material"], arches, out);
  }

  // The "Select Device:" picker (and the older wizard's device choice) arrives
  // as `variant`; the wizard may instead send only `baseMaterial`. Either way it
  // is a doctor selection, so it resolves like a matrix row or it gets flagged —
  // it is never dropped. A picker choice that duplicates a matrix row already
  // ordered above is skipped so one appliance never becomes two lines.
  const variants = Array.isArray(deviceOptions.variant)
    ? deviceOptions.variant
    : deviceOptions.variant
      ? [deviceOptions.variant]
      : [];
  const labels = variants.length ? variants : (deviceOptions.baseMaterial ? [deviceOptions.baseMaterial] : []);
  // When the label came from `variant`, `baseMaterial` is the material for it;
  // when baseMaterial IS the label there is no separate material to key on.
  const material = variants.length ? deviceOptions.baseMaterial : undefined;

  for (const label of labels) {
    if (!label || handled.has(label)) continue;
    handled.add(label);
    resolveRow(label, material, [deviceOptions.arch ?? null], out);
  }

  return out;
}
