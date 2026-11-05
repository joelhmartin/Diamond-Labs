import { FilterControl } from "../../components/ui/data-table/FilterControl.jsx";

/** True when every `required` param has a value. */
export function paramsReady(params, values) {
  return params.every((p) => {
    if (!p.required) return true;
    const v = values[p.id];
    return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
  });
}

/** Form values as a query object: lists become comma lists, empty values are dropped. */
export function paramsToQuery(params, values) {
  const out = {};
  for (const p of params) {
    const v = values[p.id];
    if (Array.isArray(v) ? v.length === 0 : v == null || v === "") continue;
    out[p.id] = Array.isArray(v) ? v.join(",") : v;
  }
  return out;
}

/** One control per param a source declares (date, select, multiselect), drawn with the DataTable filter controls. */
export function ParamsForm({ params, values, onChange }) {
  if (!params.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {params.map((p) => (
        <FilterControl
          key={p.id}
          def={{ ...p, placeholder: p.type === "select" ? "Choose…" : undefined }}
          value={values[p.id]}
          onChange={(v) => onChange(p.id, v)}
        />
      ))}
    </div>
  );
}
