/**
 * Report params on the web are the raw query strings the server parses, so the
 * URL (`p.<name>`), the run request and the CSV request all carry the same
 * values:
 *   dateRange  preset name ("last30") or "YYYY-MM-DD..YYYY-MM-DD"
 *   multiselect  comma-joined values; toggle "true"/"false"; others String(v).
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

/** "a..b" -> { from: "a", to: "b" }; a preset name -> null. */
export function splitRange(raw) {
  if (typeof raw !== "string" || !raw.includes("..")) return null;
  const [from, to] = raw.split("..");
  return { from, to };
}

/** Option specs may be strings or { value, label }. */
export const optionsOf = (spec) =>
  (spec.options || []).map((o) => (typeof o === "object" ? { value: String(o.value), label: o.label ?? String(o.value) } : { value: String(o), label: String(o) }));

/** Defaults, overlaid with any `p.<name>` in the URL. Unset params are left out. */
export function readParams(specs = [], searchParams) {
  const out = {};
  for (const spec of specs) {
    const fromUrl = searchParams.get(URL_PREFIX + spec.name);
    const raw = fromUrl ?? encodeParam(spec, spec.default);
    if (raw !== "") out[spec.name] = raw;
  }
  return out;
}

/** A copy of `searchParams` with every `p.*` replaced by `params` (blank values dropped). */
export function writeParams(searchParams, params) {
  const next = new URLSearchParams(searchParams);
  for (const k of [...next.keys()]) if (k.startsWith(URL_PREFIX)) next.delete(k);
  for (const [name, raw] of Object.entries(params)) if (raw !== "" && raw != null) next.set(URL_PREFIX + name, raw);
  return next;
}

/** Stable identity for a params object (effect deps). */
export const paramsKey = (params) => JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
