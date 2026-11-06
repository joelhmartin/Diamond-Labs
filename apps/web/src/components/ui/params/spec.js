/**
 * Helpers over a param spec (`{ name, type, label?, options?, required?, default? }`,
 * types from the shared PARAM_TYPES). Values are the raw query strings the
 * server parses: a dateRange is a preset name or "from..to", a multiselect is
 * comma-joined, a toggle is "true"/"false", everything else String(v).
 */

/** "a..b" -> { from: "a", to: "b" }; a preset name -> null. */
export function splitRange(raw) {
  if (typeof raw !== "string" || !raw.includes("..")) return null;
  const [from, to] = raw.split("..");
  return { from, to };
}

/** Option specs may be strings or { value, label }. */
export const optionsOf = (spec) =>
  (spec.options || []).map((o) => (typeof o === "object" ? { value: String(o.value), label: o.label ?? String(o.value) } : { value: String(o), label: String(o) }));

/** A dateRange value that is a custom range missing one end ("2026-10-01.."). */
export const isPartialRange = (raw) => {
  const r = splitRange(raw);
  return Boolean(r) && (!r.from || !r.to);
};

/** True when every `required` param has a value and no date range is half filled. */
export const paramsReady = (specs, values) =>
  specs.every((s) => {
    const v = values[s.name];
    if (s.type === "dateRange" && isPartialRange(v)) return false;
    return !s.required || (v != null && v !== "");
  });

/** Raw values as a query: blank values are left out. */
export const paramsToQuery = (specs, values) =>
  Object.fromEntries(specs.map((s) => [s.name, values[s.name]]).filter(([, v]) => v != null && v !== ""));
