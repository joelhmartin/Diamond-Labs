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

  return {
    defineSource: (def) => define(sources, "source", def),
    defineFormat: (def) => define(formats, "format", def),
    source: (key) => sources.get(key),
    format: (key) => formats.get(key),
    /** Every source with the keys of the formats that accept it. */
    list: () =>
      [...sources.values()].map((s) => ({
        key: s.key,
        label: s.label,
        params: s.params ?? [],
        fields: s.fields,
        formats: [...formats.values()].filter((f) => f.supports(s)).map((f) => f.key),
      })),
  };
}
