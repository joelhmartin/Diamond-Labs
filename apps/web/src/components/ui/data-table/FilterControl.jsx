import { ChevronDown } from "lucide-react";
import { Dropdown } from "../Dropdown.jsx";

export const CONTROL =
  "h-9 rounded-xl border border-surface-300/60 bg-white px-3 text-xs text-navy focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all";

/** One filter in the DataTable toolbar, drawn from its FilterDef `type`. */
export function FilterControl({ def, value, onChange }) {
  if (def.type === "toggle") {
    const on = value === true;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(!on)}
        className={`${CONTROL} font-medium ${on ? "border-brand-500 bg-brand-500/10 text-brand-700" : "text-navy/60 hover:text-navy"}`}
      >
        {def.label}
      </button>
    );
  }

  if (def.type === "date") {
    return (
      <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-navy/40">
        {def.label}
        <input
          type="date"
          aria-label={def.label}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={CONTROL}
        />
      </label>
    );
  }

  if (def.type === "multiselect") return <MultiSelect def={def} value={value} onChange={onChange} />;

  return (
    <select
      aria-label={def.label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={CONTROL}
    >
      <option value="">{def.placeholder ?? `All ${def.label.toLowerCase()}`}</option>
      {(def.options ?? []).map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function MultiSelect({ def, value, onChange }) {
  const picked = Array.isArray(value) ? value : [];
  const flip = (v) => onChange(picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v]);
  return (
    <Dropdown
      closeOnClick={false}
      className="rounded-xl border-surface-300/60 p-1"
      trigger={
        <button
          type="button"
          aria-label={def.label}
          className={`${CONTROL} inline-flex items-center gap-1.5 ${picked.length ? "border-brand-500 text-navy" : "text-navy/60"}`}
        >
          {def.label}
          {picked.length > 0 && <span className="font-mono tabular-nums text-brand-600">{picked.length}</span>}
          <ChevronDown size={12} />
        </button>
      }
    >
      {(def.options ?? []).map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-navy hover:bg-surface-50">
          <input type="checkbox" checked={picked.includes(o.value)} onChange={() => flip(o.value)} className="accent-brand-500" />
          {o.label}
        </label>
      ))}
    </Dropdown>
  );
}
