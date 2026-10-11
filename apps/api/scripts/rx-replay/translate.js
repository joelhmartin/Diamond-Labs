/**
 * JotForm answers → the portal Rx form's answers. TEST/REPLAY TOOLING ONLY —
 * nothing in the app imports this. It exists so real JotForm prescriptions
 * (Rx 2025 form 220598308432154, Orthodontic form 213545611846154) can be
 * replayed through the portal's own mapping (buildFormDevices → linesForDevices)
 * and compared with the orders the lab actually built. See run.mjs.
 *
 * Option literals are canonicalised against the portal forms themselves
 * (apps/web/src/data/forms), so a JotForm label that only differs by HTML,
 * spacing, case or punctuation ("POSITIONER <br><b> ON-P </b> <br> (Anterior
 * Occlusion)") lands on the portal value ("POSITIONER (ON-P) - Anterior
 * Occlusion"). A literal that matches no portal option is passed through
 * cleaned, and reported through `onWarning` — never guessed.
 */

import { digitalRxForm } from "@my-app/shared/rx/forms/digital-rx.form.js";
import { orthoRxForm } from "@my-app/shared/rx/forms/ortho-rx.form.js";

// ── Text cleanup ────────────────────────────────────────────────────────────

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s) {
  return String(s).replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);
}

/** Decode entities, drop tags, collapse whitespace. */
export function cleanLabel(s) {
  return decodeEntities(s)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comparison key: letters and digits only, lowercased. */
const keyOf = (s) => cleanLabel(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// ── Portal form vocabulary ──────────────────────────────────────────────────

function fieldsOf(form) {
  const out = new Map();
  for (const section of form.sections) for (const f of section.fields || []) if (f.key) out.set(f.key, f);
  return out;
}
const DIGITAL_FIELDS = fieldsOf(digitalRxForm);
const ORTHO_FIELDS = fieldsOf(orthoRxForm);

const optionValues = (field) => (field?.options || []).map((o) => (typeof o === "string" ? o : o.value));

// Every option value either form offers — the fallback vocabulary when the
// target field's own options do not contain a literal (e.g. a JotForm "ON Loop"
// on the Night device, which the portal's ON field does not offer).
const ALL_OPTIONS = [...DIGITAL_FIELDS.values(), ...ORTHO_FIELDS.values()].flatMap(optionValues);

// JotForm literals whose wording differs from the portal's beyond punctuation.
const ALIASES = {
  verticalshimstitration: "Vertical Shims",
};

/**
 * One JotForm literal → the portal option value for `field`.
 * Field options first, then any portal option, then the alias table; otherwise
 * the cleaned literal is returned as typed and a warning is raised.
 */
function canon(raw, field, warn) {
  const k = keyOf(raw);
  if (!k) return undefined;
  const own = optionValues(field).find((o) => keyOf(o) === k);
  if (own) return own;
  const any = ALL_OPTIONS.find((o) => keyOf(o) === k);
  if (any) return any;
  if (ALIASES[k]) return ALIASES[k];
  warn(`${field?.key ?? "?"}: no portal option for "${cleanLabel(raw)}"`);
  return cleanLabel(raw);
}

// ── JotForm value shapes ────────────────────────────────────────────────────

/**
 * Any JotForm answer → a flat list of selected literals:
 *   - widget image pickers: { widget_metadata: { value: [{ name }] } }
 *   - checkboxes: an array, or an index-keyed object { "0": "..." }; `{}` is empty
 *   - radios: a string
 */
export function literals(v) {
  if (v == null) return [];
  if (typeof v === "string") return v.trim() ? [v] : [];
  if (Array.isArray(v)) return v.flatMap(literals);
  if (typeof v === "object") {
    if (v.widget_metadata) return literals((v.widget_metadata.value || []).map((x) => x?.name));
    return Object.values(v).flatMap(literals);
  }
  return [];
}

/**
 * A JotForm matrix ({ rowLabel: [cell, …] }, or a dynamic matrix as an array of
 * row arrays) → the portal's flat `{ "row__column": value }`, rows matched to
 * the portal field's rows by label (index as a fallback), columns by position —
 * both forms declare the columns in the same order.
 */
export function matrixAnswer(v, field, warn) {
  const out = {};
  if (!v || typeof v !== "object" || !field) return out;
  const rows = field.rows || [];
  const cols = field.columns || [];
  const entries = Array.isArray(v) ? v.map((cells, i) => [rows[i], cells]) : Object.entries(v);
  entries.forEach(([rowLabel, cells], i) => {
    if (!Array.isArray(cells)) return;
    const row = rows.find((r) => keyOf(r) === keyOf(rowLabel ?? "")) ?? rows[i];
    if (!row) {
      if (cells.some((c) => String(c ?? "").trim())) warn(`${field.key}: no portal row for "${cleanLabel(rowLabel ?? "")}"`);
      return;
    }
    cells.forEach((cell, c) => {
      const val = cleanLabel(cell ?? "");
      if (!val) return;
      if (!cols[c]) {
        warn(`${field.key}: no portal column ${c} on row "${row}"`);
        return;
      }
      out[`${row}__${cols[c]}`] = val;
    });
  });
  return out;
}

// ── Answer builders ─────────────────────────────────────────────────────────

/** Build a setter bound to one form's fields: radio → string, checkbox → array. */
function writer(fields, src, out, warn) {
  const one = (jfKey, key) => {
    const field = fields.get(key);
    const vals = literals(src[jfKey]).map((l) => canon(l, field, warn)).filter(Boolean);
    if (!vals.length) return;
    if (field?.type === "checkbox") out[key] = [...new Set([...(out[key] || []), ...vals])];
    else out[key] = vals[0];
  };
  const many = (jfKeys, key) => jfKeys.forEach((k) => one(k, key));
  const grid = (jfKey, key) => {
    const m = matrixAnswer(src[jfKey], fields.get(key), warn);
    if (Object.keys(m).length) out[key] = m;
  };
  return { one, many, grid };
}

/** Rush widgets: "#1 NYLON DEVICES: Max Rush (200)\n\n…" → "Max Rush". */
function rushTier(v) {
  const m = typeof v === "string" && v.match(/:\s*([^()\n]+?)\s*\(/);
  return m ? m[1].trim() : undefined;
}

/** Shared case header, records block and submit footer (rx-common.sections.js). */
function commonAnswers(src, fields, out, warn) {
  const w = writer(fields, src, out, warn);
  w.one("isThis309", "firstDevice");
  w.one("physicalAndor", "records");
  // The ortho JotForm misspells "recieved"; the canonical match ignores that
  // only if the words agree, so pick the portal option by its leading answer.
  const bite = literals(src.willYou)[0];
  if (bite) {
    const opts = optionValues(fields.get("physicalBite"));
    out.physicalBite = opts.find((o) => o.split(" ")[0] === bite.split(" ")[0]) ?? cleanLabel(bite);
  }
  const nylon = rushTier(src.rushCase);
  const biomed = rushTier(src.rushCase337);
  if (nylon) out.rushChargeNylon = nylon;
  if (biomed) out.rushChargeBiomed = biomed;
  if ([nylon, biomed].some((t) => t && t !== "No Rush")) out.rushCase = ["Yes"];
}

const answeredMatrix = (v) =>
  v && typeof v === "object" && Object.values(v).some((cells) => Array.isArray(cells) && cells.some((c) => String(c ?? "").trim()));

function digitalAnswers(src, warn) {
  const out = {};
  const fields = DIGITAL_FIELDS;
  commonAnswers(src, fields, out, warn);
  const w = writer(fields, src, out, warn);
  const has = (k) => literals(src[k]).length > 0;
  const gate = [];

  // OLMOS — Day material, Night design + material + modifications.
  w.one("odOlmos390", "odMaterial");
  w.one("onOlmos", "onDesign");
  w.one("selectBase270", "onMaterial");
  w.many(["selectModifications414", "selectModifications"], "onModifications");
  w.one("opposingTrutaine", "opposingTrutaine");
  if (["odOlmos390", "onOlmos", "selectBase270", "selectModifications414", "selectModifications"].some(has)) gate.push("olmos");

  // MISTRY — the MORA / ARA single-item pickers mean "order this".
  if (has("odOlmos")) out.mora = optionValues(fields.get("mora"));
  if (has("ara")) out.ara = optionValues(fields.get("ara"));
  if (has("odOlmos") || has("ara")) gate.push("mistry");

  // DDSO — the device picker (qid 219) is the gate; material etc. follow it.
  if (has("pleaseSelect219")) {
    gate.push("ddso");
    w.one("pleaseSelect389", "ddsoMaterial");
    w.one("pleaseSelect466", "ddsoOcclusalContact");
    w.one("designPreference467", "ddsoDesignPreference");
    w.many(["selectModifications468", "selectModifications469"], "ddsoModifications");
    w.one("placeVertical", "ddsoTitrationPlacement");
    w.one("name378", "ddsoAdditionalOptions");
  }

  // CAD/CAM D-Pro / Manta (qid 454).
  if (has("pleaseSelect454")) {
    gate.push("dpro");
    w.one("pleaseSelect454", "dproDevice");
    w.one("pleaseSelect485", "dproOcclusalContact");
    w.one("designPreference486", "dproDesignPreference");
    w.one("selectModifications487", "dproModifications");
    w.one("placeVertical488", "dproTitrationPlacement");
    w.one("additionalOptions", "dproAdditionalOptions");
  }

  // Shirazi Hybrid (qid 455).
  if (has("pleaseSelect455")) {
    gate.push("shirazi");
    w.one("pleaseSelect131", "occlusalContact");
    w.one("designPreference", "designPreference");
    w.one("selectModifications224", "modificationsA");
    w.one("selectModifications419", "modificationsB");
  }

  // Nightguards — the device picker (qid 453) and/or the guard matrix (qid 169).
  w.one("selectDevice", "nightguardDevice");
  if (answeredMatrix(src.standardGuardssplints)) w.grid("standardGuardssplints", "standardGuards");
  w.one("name273", "attachmentsModifications");
  if (out.nightguardDevice || out.standardGuards) gate.push("nightguards");

  // Sport-guards — tier picker (qid 235) and/or the specs matrix (qid 338).
  w.one("diamondEnhanced", "sportGuardDevice");
  if (answeredMatrix(src.sportsguardSpecifications)) w.grid("sportsguardSpecifications", "sportGuardSpecs");
  if (out.sportGuardDevice || out.sportGuardSpecs) gate.push("sportguards");

  // SnoreHook (qid 408).
  if (has("pleaseSelect408")) gate.push("snorehook");

  // Vertical-dimension / articulation tables — build notes, not products.
  w.grid("verticalDimensionschanges", "odVertical");
  w.grid("verticalDimensionschanges221", "onVertical");
  w.grid("verticalDimensionschanges483", "ddsoVertical");
  w.grid("verticalDimensionschanges484", "dproVertical");
  w.grid("specificChanges415", "shiraziArticulation");

  // The portal gates every device section on devicesToOrder; JotForm had no
  // such question, so it is inferred from which device sections were answered.
  if (gate.length) out.devicesToOrder = gate;
  return out;
}

function orthoAnswers(src, warn) {
  const out = {};
  const fields = ORTHO_FIELDS;
  commonAnswers(src, fields, out, warn);
  const w = writer(fields, src, out, warn);
  w.one("selectDevice", "selectDevice");
  w.one("typeA489", "upperArchRetention");
  w.one("upperExpansion", "upperExpansionType");
  w.one("lowerArch", "lowerArchRetention");
  w.one("lowerExpansion", "lowerExpansionType");
  w.one("typeA487", "fixedMandibularExpansion");
  w.one("removableMandibular", "removableMandibularExpansion");
  // Add-on checkboxes: qid 478 / 509 are the dual-arch section's "Add to
  // Maxillary / Mandibular"; qid 463 / 465 the arch-only sections' "Add:".
  w.one("addTo", "addToMaxillary");
  w.one("addTo509", "addToMandibular");
  w.one("add", "maxillaryAdd");
  w.one("add465", "mandibularAdd");
  w.grid("requiredSelection", "requiredSelection");
  w.grid("occlusalOptions", "occlusalOptionsTandem");
  w.grid("FunctionalExpansionSelection", "upperExpansionSelection");
  w.grid("lowerrFunctional", "lowerExpansionSelection");
  w.grid("nuveloDigital", "nuveloDigitalSetup");
  w.one("digitalstudy", "digitalStudyModels");
  return out;
}

/**
 * @param {"rx"|"ortho"} form — which JotForm the answers came from
 * @param {object} answers — JotForm structured answers, keyed by field name
 * @param {{ onWarning?: (msg: string) => void }} [opts]
 * @returns {object} answers keyed as the portal form (digital-rx / ortho-rx) keys them
 */
export function jotformToPortalAnswers(form, answers = {}, { onWarning = () => {} } = {}) {
  if (form === "ortho") return orthoAnswers(answers, onWarning);
  if (form === "rx") return digitalAnswers(answers, onWarning);
  throw new Error(`unknown JotForm form "${form}" (expected "rx" or "ortho")`);
}

/** The portal formType a JotForm form replays as (rx_cases.form_type). */
export const portalFormType = (form) => (form === "ortho" ? "ortho" : "digital");
