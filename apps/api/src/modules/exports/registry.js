import { COLUMN_TYPES } from "@my-app/shared";

/**
 * The report param types an export source may declare: the ones the export path
 * handles end to end today (the screen sends their raw value; the source's own
 * zod validates it). Not `dateRange` (a preset needs resolving in the app's
 * timezone, which exports do not have) nor `lookup` (no lookup endpoint); add a
 * type here only with that support and a test.
 */
export const EXPORT_PARAM_TYPES = Object.freeze(["date", "select", "multiselect"]);

/**
 * Registry of export sources (what can be exported) and formats (how it is
 * written). Stateless: each app builds its own with createExportRegistry().
 */
export function createExportRegistry() {
  const sources = new Map();
  const formats = new Map();

  function define(map, kind, def) {
    if (!def?.key) throw new Error(`An export ${kind} needs a key.`);
    if (map.has(def.key)) throw new Error(`Export ${kind} "${def.key}" is already defined.`);
    map.set(def.key, def);
    return def;
  }

  // Fields and params use the shared report vocabulary: a field type is a column type (so a cell is
  // written the way a report column's is) and a param is a report param spec (so one form draws both).
  function checkSource(def) {
    const where = `Export source "${def?.key}"`;
    if (!Array.isArray(def?.fields) || def.fields.length === 0) throw new Error(`${where} needs fields.`);
    for (const f of def.fields) {
      if (!COLUMN_TYPES.includes(f.type)) throw new Error(`${where}: field "${f.key}" has unknown type "${f.type}".`);
    }
    for (const p of def.params ?? []) {
      if (!p.name) throw new Error(`${where}: every param needs a name.`);
      if (!EXPORT_PARAM_TYPES.includes(p.type)) {
        throw new Error(`${where}: param "${p.name}" has type "${p.type}"; exports support ${EXPORT_PARAM_TYPES.join(", ")}.`);
      }
    }
  }

  return {
    defineSource: (def) => {
      checkSource(def);
      return define(sources, "source", def);
    },
    defineFormat: (def) => define(formats, "format", def),
    source: (key) => sources.get(key),
    format: (key) => formats.get(key),
    /** Every source with the formats that accept it, as { key, label, extension }. */
    list: () =>
      [...sources.values()].map((s) => ({
        key: s.key,
        label: s.label,
        params: s.params ?? [],
        fields: s.fields,
        formats: [...formats.values()].filter((f) => f.supports(s)).map((f) => ({ key: f.key, label: f.label, extension: f.extension })),
      })),
  };
}
