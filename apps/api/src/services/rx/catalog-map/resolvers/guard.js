/**
 * Nightguard resolver. The guard section is a matrix, not a single choice:
 * each row is an appliance, each row carries its own arch cells and a Base
 * Material cell, and one submission may order several rows at once.
 *
 * TWO doctor-facing controls feed this resolver and BOTH must be honoured:
 *   - `standardGuards` — the 7-row Standard Guards/Splints matrix (qid 169)
 *   - `variant`        — the "Select Device:" image picker (qid 453,
 *                        `nightguardDevice`), plus the older wizard's own
 *                        device/base-material choice
 * A selection that this resolver cannot map must land in `unmapped`. It must
 * never vanish: a dropped doctor selection is the defect this module exists
 * to prevent.
 *
 * Codes and statuses below are checked against 15,808 JotForm prescriptions
 * matched to the Seazona orders the lab built from them (2025–26).
 */

/** Option key for "the doctor gave no material" — only some rows have one. */
const NO_MATERIAL = "(no material)";

// row label → { material literal → code }, or { "*": code } when the appliance
// exists in exactly one form regardless of material.
const GUARD_MATRIX = {
  "Nightguard - Full Occlusion": {
    "PMT (Diamoform)": { code: "2164", name: "Nightguard-Single Arch PMT",    status: "confirmed" },
    "BIOMED (Printed)": { code: "2165", name: "Nightguard-Single Arch Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2166", name: "Nightguard-Single Arch Nylon",  status: "confirmed" },
    "Dual-Laminate":    { code: "2167", name: "Nightguard Dual Laminate",      status: "confirmed" },
    // 3/3 real orders billed PMT 2164 — never the All-Acrylic 2428.
    "Acrylic w/clasps": { code: "2164", name: "Nightguard-Single Arch PMT",    status: "confirmed" },
  },
  "Occlusal Guard - NTI Type": {
    "BIOMED (Printed)": { code: "2175", name: "NTI Slider-Type (Dual Arch) Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2176", name: "NTI Slider-Type (Dual Arch) Nylon",  status: "confirmed" },
  },
  // Real orders: Nylon → 2176 (95%, n=43), BIOMED → 2175 (4/4). The lab builds
  // this row as NTI Slider-Type, never FLATPLANE.
  "Occlusal Guard - Slider Type": {
    "BIOMED (Printed)": { code: "2175", name: "NTI Slider-Type (Dual Arch) Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2176", name: "NTI Slider-Type (Dual Arch) Nylon",  status: "confirmed" },
  },
  "Michigan Splint - Anterior Guidance": {
    "BIOMED (Printed)": { code: "2169", name: "Michigan Splint Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2170", name: "Michigan Splint Nylon",  status: "confirmed" },
  },
  "Essix Tray":          { "*": { code: "2161", name: "Essix Tray Non Printed (per arch)", status: "confirmed" } },
  "Bleaching Trays":     { "*": { code: "2155", name: "Bleaching Tray (per arch)",         status: "confirmed" } },
  "Neurosensory Stent":  { "*": { code: "2597", name: "Neurostent BioFlex",                status: "proposed"  } },

  // ── Device-picker-only rows (qid 453 `nightguardDevice`). These are NOT rows
  // of the standardGuards matrix, so they only ever arrive as `variant`.
  // The picker captures no material; real picker-only orders billed FLATPLANE
  // Nylon 2163 77% (n=43) and NTI Slider Nylon 2176 84% (n=73).
  "Dual Arch - FLATPLANE": {
    "BIOMED (Printed)": { code: "2162", name: "FLATPLANE (Dual Arch) Biomed",  status: "confirmed" },
    "Nylon (Printed)":  { code: "2163", name: "FLATPLANE (Dual Arch) Nylon",   status: "confirmed" },
    "BioFlex":          { code: "2531", name: "FLATPLANE (Dual Arch) BioFlex", status: "confirmed" },
    [NO_MATERIAL]:      { code: "2163", name: "FLATPLANE (Dual Arch) Nylon",   status: "proposed"  },
  },
  "Dual Arch - SLIDER": {
    [NO_MATERIAL]:      { code: "2176", name: "NTI Slider-Type (Dual Arch) Nylon", status: "proposed" },
  },
  "Single Arch - NIGHTGUARD": {},
};

/**
 * One appliance covering BOTH arches. Real orders carry exactly one line for
 * these (2176: 70/70 orders, 2163: 35/35, 2162: 6/6, 2175: 5/5), so ticking
 * UPPER and LOWER must not bill the appliance twice.
 */
const DUAL_ARCH_ROWS = new Set([
  "Occlusal Guard - NTI Type",
  "Occlusal Guard - Slider Type",
  "Dual Arch - FLATPLANE",
  "Dual Arch - SLIDER",
]);

/**
 * How each picker render relates to the matrix, so a doctor who answers BOTH
 * controls for one appliance gets one line, not two:
 *   - `covers`: the matrix row IS this appliance, and the row (which carries
 *     material + arches) wins; the picker adds nothing.
 *   - `materialFrom`: the picker names the appliance and the matrix row only
 *     supplies its material. FLATPLANE has no matrix row of its own, and real
 *     orders show doctors who pick it fill in the Full Occlusion row — that
 *     row's Nylon answers billed FLATPLANE 2163 half the time, and FLATPLANE
 *     and a single-arch nightguard appear on the same order once in 3,600.
 */
const PICKERS = {
  "Single Arch - NIGHTGUARD": { covers: ["Nightguard - Full Occlusion"] },
  "Dual Arch - SLIDER": { covers: ["Occlusal Guard - Slider Type", "Occlusal Guard - NTI Type"] },
  "Dual Arch - FLATPLANE": { materialFrom: ["Nightguard - Full Occlusion"] },
};

// Per-row explanation for rows with no catalog mapping, shown to the lab in the
// generated sign-off document. Falls back to the generic ambiguity sentence.
const OPEN_REASONS = {
  "Single Arch - NIGHTGUARD":
    "The device picker does not capture a base material, and real orders from it split Nylon 2166 (40%), PMT 2164 (24%) and Michigan Splint 2170 (14%). Which one should a picker-only selection mean? (When the doctor also fills the Nightguard - Full Occlusion row, that row decides.)",
};
const DEFAULT_OPEN_REASON =
  "Ambiguous — the catalog has more than one product for this appliance and the form does not say which.";

/** The matrix columns that are not arches or material — build detail for the notes. */
const DETAIL_COLUMNS = ["Increase for clearance", "Only Cover teeth #'s:", "Color:", "Other:"];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Every appliance row this resolver knows about — exported for coverage tests. */
export const GUARD_ROW_LABELS = Object.keys(GUARD_MATRIX);

const materialKey = (material) => (material === "*" ? "any" : slug(material));

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
    mapKey: `guard:${slug(rowLabel)}:${materialKey(material)}`,
    device: "guard",
    match: [material === "*" ? rowLabel : `${rowLabel} — ${material}`],
    code: v.code,
    name: v.name,
    status: v.status,
  }));
});

// Every material literal the matrix keys on, for canonicalMaterial.
const KNOWN_MATERIALS = [...new Set(
  Object.values(GUARD_MATRIX).flatMap((o) => Object.keys(o)).filter((m) => m !== "*" && m !== NO_MATERIAL)
)];

/**
 * The live form's matrix cells are free text, so "nylon" must find
 * "Nylon (Printed)". Exact match ignoring case, with or without the
 * parenthetical — never a fuzzy guess. Anything else comes back as typed and
 * is flagged by resolveRow.
 */
function canonicalMaterial(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const t = raw.trim().toLowerCase();
  return (
    KNOWN_MATERIALS.find((m) => m.toLowerCase() === t || m.replace(/\s*\(.*\)$/, "").toLowerCase() === t) ||
    raw.trim()
  );
}

/** Is a matrix cell answered? Text cells hold whatever the doctor typed. */
function filled(v) {
  if (v === true) return true;
  return typeof v === "string" && v.trim() !== "";
}

/** An arch cell counts as ticked unless it plainly says no. */
const ticked = (v) => filled(v) && !/^(no|n|0|false|-)$/i.test(String(v).trim());

/**
 * Normalise a standardGuards answer to `{ [row]: { [column]: value } }`.
 *
 * The live form's MatrixField stores cells FLAT, as `"<row>__<column>": text`
 * (see apps/web/src/components/rx/fields.jsx); earlier producers and the tests
 * nest them per row. Both shapes are accepted — reading only the nested one
 * silently dropped every matrix row a doctor ordered on the live form.
 */
export function nestGuardMatrix(answer) {
  const out = {};
  if (!answer || typeof answer !== "object") return out;
  for (const [key, value] of Object.entries(answer)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = { ...(out[key] || {}), ...value };
      continue;
    }
    const at = key.indexOf("__");
    if (at < 0) continue;
    const row = key.slice(0, at);
    (out[row] ||= {})[key.slice(at + 2)] = value;
  }
  return out;
}

const archesOf = (cells) => [
  ...(ticked(cells["UPPER ARCH"]) ? ["upper"] : []),
  ...(ticked(cells["LOWER ARCH"]) ? ["lower"] : []),
];

/**
 * Build detail the matrix carries that no product code represents — clearance,
 * which teeth to cover, colour, free text. Note fragments, one per answered
 * row, so they reach the lab instead of dying in formData (follow-up 1).
 */
export function guardMatrixNotes(standardGuards) {
  const lines = [];
  for (const [row, cells] of Object.entries(nestGuardMatrix(standardGuards))) {
    const detail = DETAIL_COLUMNS.filter((c) => filled(cells[c])).map((c) => `${c.replace(/:$/, "")}: ${String(cells[c]).trim()}`);
    if (detail.length) lines.push(`${row}: ${detail.join("; ")}`);
  }
  return lines;
}

/**
 * Resolve ONE appliance row into line items (or one bare unmapped mapKey).
 * Shared by the matrix path and the device-picker path so the star-row `any`
 * rule and the material-keyed rule can never diverge between them.
 *
 * @param {string} rowLabel — a GUARD_MATRIX key, or any unrecognised literal
 * @param {string|undefined} rawMaterial — the Base Material answer, if captured
 * @param {Array<string|null>} arches — one entry per line to emit
 * @param {{items: Array, unmapped: string[]}} out
 */
function resolveRow(rowLabel, rawMaterial, arches, out) {
  const options = GUARD_MATRIX[rowLabel];
  if (!options || Object.keys(options).length === 0) {
    out.unmapped.push(`guard:${slug(rowLabel)}`);
    return;
  }

  const material = canonicalMaterial(rawMaterial);
  const key = options["*"] ? "*" : material ?? NO_MATERIAL;
  const chosen = options[key];
  if (!chosen) {
    out.unmapped.push(`guard:${slug(rowLabel)}:${slug(material || "no-material")}`);
    return;
  }

  // A dual-arch appliance is one line whatever arches were ticked.
  const lines = DUAL_ARCH_ROWS.has(rowLabel) ? [null] : arches.length ? arches : [null];
  for (const arch of lines)
    out.items.push({
      mapKey: `guard:${slug(rowLabel)}:${materialKey(key)}`,
      code: chosen.code,
      name: chosen.name,
      arch,
      status: chosen.status,
    });
}

export function resolveGuard(deviceOptions = {}) {
  const out = { items: [], unmapped: [] };
  const matrix = nestGuardMatrix(deviceOptions.standardGuards);
  // A row is answered if ANY cell is filled — on free-text cells a doctor who
  // typed a material but left the arch cells blank still asked for something.
  const answeredRows = Object.keys(matrix).filter((row) => Object.values(matrix[row]).some(filled));
  const handled = new Set();
  const consumed = new Set();

  // The "Select Device:" picker (and the older wizard's device choice) arrives
  // as `variant`; the wizard may instead send only `baseMaterial`. Either way it
  // is a doctor selection, so it resolves like a matrix row or it gets flagged —
  // it is never dropped.
  const variants = Array.isArray(deviceOptions.variant)
    ? deviceOptions.variant
    : deviceOptions.variant
      ? [deviceOptions.variant]
      : [];
  const labels = variants.length ? variants : (deviceOptions.baseMaterial ? [deviceOptions.baseMaterial] : []);
  // When the label came from `variant`, `baseMaterial` is the material for it;
  // when baseMaterial IS the label there is no separate material to key on.
  const material = variants.length ? deviceOptions.baseMaterial : undefined;

  // 1. A picker appliance that takes its material from a matrix row: that row
  //    is the same appliance, so it is consumed here and not billed again.
  for (const label of labels) {
    const from = PICKERS[label]?.materialFrom?.find((r) => answeredRows.includes(r) && !consumed.has(r));
    if (!from || handled.has(label)) continue;
    consumed.add(from);
    handled.add(label);
    resolveRow(label, matrix[from]["Base Material"], archesOf(matrix[from]), out);
  }

  // 2. The matrix rows.
  for (const row of answeredRows) {
    if (consumed.has(row)) continue;
    handled.add(row);
    const arches = archesOf(matrix[row]);
    // A per-arch appliance with no arch answered cannot be built — hold it
    // for staff rather than guess an arch or drop the row.
    if (arches.length === 0 && GUARD_MATRIX[row] && !DUAL_ARCH_ROWS.has(row)) {
      out.unmapped.push(`guard:${slug(row)}:no-arch`);
      continue;
    }
    resolveRow(row, matrix[row]["Base Material"], arches, out);
  }

  // 3. The remaining picker choices. One that duplicates (or is covered by) a
  //    matrix row already ordered above is skipped so one appliance never
  //    becomes two lines.
  for (const label of labels) {
    if (!label || handled.has(label)) continue;
    handled.add(label);
    if (PICKERS[label]?.covers?.some((r) => handled.has(r))) continue;
    resolveRow(label, material, [deviceOptions.arch ?? null], out);
  }

  return out;
}
