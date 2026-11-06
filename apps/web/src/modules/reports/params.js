/**
 * Report params on the web are the raw query strings the server parses, so the
 * URL (`p.<name>`), the run request and the CSV request all carry the same
 * values:
 *   dateRange  preset name ("last30") or "YYYY-MM-DD..YYYY-MM-DD"
 *   multiselect  comma-joined values; toggle "true"/"false"; others String(v).
 * The spec helpers (optionsOf, splitRange, isPartialRange) live with the shared
 * param controls in components/ui/params.
 */
export const URL_PREFIX = "p.";

/** A spec default or form value -> its query string ("" means unset). */
export function encodeParam(spec, value) {
  if (value === undefined || value === null) return "";
  if (spec.type === "dateRange" && typeof value === "object") return `${value.from ?? ""}..${value.to ?? ""}`;
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * A param the person can clear even though it has a default: clearing must stick
 * (kept as `p.<name>=` in the URL and sent blank, which the server reads as
 * "unset"), not snap back to the default. Required params always have a value.
 */
const clearable = (spec) => spec.default !== undefined && !spec.required;

/** Defaults, overlaid with any `p.<name>` in the URL. Unset params are left out; a cleared clearable one is "". */
export function readParams(specs = [], searchParams) {
  const out = {};
  for (const spec of specs) {
    const fromUrl = searchParams.get(URL_PREFIX + spec.name);
    const raw = fromUrl ?? encodeParam(spec, spec.default);
    if (raw !== "") out[spec.name] = raw;
    else if (fromUrl === "" && clearable(spec)) out[spec.name] = "";
  }
  return out;
}

/**
 * A copy of `searchParams` with every `p.*` replaced by `params`. Blank values
 * are dropped, except a clearable param (given `specs`), which is kept as `p.<name>=`.
 */
export function writeParams(searchParams, params, specs = []) {
  const keepBlank = new Set(specs.filter(clearable).map((s) => s.name));
  const next = new URLSearchParams(searchParams);
  for (const k of [...next.keys()]) if (k.startsWith(URL_PREFIX)) next.delete(k);
  for (const [name, raw] of Object.entries(params)) {
    if (raw !== "" && raw != null) next.set(URL_PREFIX + name, raw);
    else if (keepBlank.has(name)) next.set(URL_PREFIX + name, "");
  }
  return next;
}

/** `params` as they will read back after a round trip through the URL (for "did anything change?"). */
export const normalizeParams = (specs, params) => readParams(specs, writeParams(new URLSearchParams(), params, specs));

/** Stable identity for a params object (effect deps). */
export const paramsKey = (params) => JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
