import { useEffect, useId, useState } from "react";
import { DATE_PRESETS } from "@my-app/shared";
import { LookupField } from "./LookupField.jsx";
import { optionsOf, splitRange } from "./spec.js";

const PRESET_LABELS = {
  today: "Today", yesterday: "Yesterday", last7: "Last 7 days", last30: "Last 30 days",
  mtd: "Month to date", lastMonth: "Last month", qtd: "Quarter to date", ytd: "Year to date",
  lastYear: "Last year", last12m: "Last 12 months",
};
const CUSTOM = "custom";
const INPUT = "h-9 rounded-xl border border-surface-300/60 bg-white px-3 text-sm text-navy focus:border-brand-500 focus:outline-none";
const LABEL = "mb-1 block text-xs font-medium text-navy/60";

/**
 * One labelled control per param spec: the app's one way to draw typed
 * parameters (the reports form and the export screen both use it). `values`
 * are raw query strings (see spec.js). `onChange(name, raw, { apply })`:
 * `apply` is true for a pick (select, preset, date, toggle, lookup, chip) and
 * false for typing (a number, one end of a custom range), so a form can hold
 * typed edits until it is submitted. `lookup` is `{ search, labelFor? }` for
 * `lookup` params (see LookupField).
 */
export function ParamFields({ specs = [], values, onChange, lookup }) {
  return specs.map((spec) => (
    <ParamField key={spec.name} spec={spec} raw={values[spec.name] ?? ""} onChange={onChange} lookup={lookup} />
  ));
}

function ParamField({ spec, raw, onChange, lookup }) {
  const id = useId();
  const label = spec.label ?? spec.name;
  const set = (v, apply) => onChange(spec.name, v, { apply });
  const field = (control) => (
    <div className="min-w-[10rem]">
      <label htmlFor={id} className={LABEL}>{label}</label>
      {control}
    </div>
  );

  switch (spec.type) {
    case "dateRange":
      return <DateRangeControl id={id} label={label} raw={raw} onPick={set} />;
    case "date":
      return field(<input id={id} type="date" value={raw} onChange={(e) => set(e.target.value, true)} className={INPUT} />);
    case "number":
      return field(
        <input
          id={id} type="number" inputMode="decimal" value={raw} min={spec.min} max={spec.max}
          onChange={(e) => set(e.target.value, false)} className={`${INPUT} w-32`}
        />,
      );
    case "select":
      return field(
        <select id={id} value={raw} onChange={(e) => set(e.target.value, true)} className={INPUT}>
          {spec.default === undefined && <option value="">{spec.required ? "Choose…" : "Any"}</option>}
          {optionsOf(spec).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>,
      );
    case "multiselect":
      return <MultiControl spec={spec} label={label} raw={raw} onPick={(v) => set(v, true)} />;
    case "toggle":
      return (
        <label className="inline-flex h-9 items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={raw === "true"} onChange={(e) => set(e.target.checked ? "true" : "false", true)} className="accent-brand-500" />
          {label}
        </label>
      );
    case "lookup":
      return (
        <div className="min-w-[14rem]">
          <LookupField
            id={id} label={label} source={spec.source} value={raw} onChange={(v) => set(v, true)}
            search={lookup?.search} labelFor={lookup?.labelFor}
          />
        </div>
      );
    default:
      return field(<input id={id} value={raw} onChange={(e) => set(e.target.value, false)} className={INPUT} />);
  }
}

/** Preset select, plus From/To inputs for a custom range ("from..to"); a custom range is typed, not picked. */
function DateRangeControl({ id, label, raw, onPick }) {
  const custom = splitRange(raw);
  const [mode, setMode] = useState(custom ? CUSTOM : raw);
  useEffect(() => setMode(splitRange(raw) ? CUSTOM : raw), [raw]);
  const range = custom ?? { from: "", to: "" };

  // Choosing "Custom range…" starts an empty "from..to" draft, which holds a submit until both ends are set.
  const pickPreset = (v) => {
    setMode(v);
    if (v !== CUSTOM) onPick(v, true);
    else if (!custom) onPick("..", false);
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor={id} className={LABEL}>{label}</label>
        <select id={id} value={mode} onChange={(e) => pickPreset(e.target.value)} className={INPUT}>
          {DATE_PRESETS.map((p) => <option key={p} value={p}>{PRESET_LABELS[p] ?? p}</option>)}
          <option value={CUSTOM}>Custom range…</option>
        </select>
      </div>
      {mode === CUSTOM && (
        <>
          <div>
            <label htmlFor={`${id}-from`} className={LABEL}>From</label>
            <input id={`${id}-from`} type="date" value={range.from} onChange={(e) => onPick(`${e.target.value}..${range.to}`, false)} className={INPUT} />
          </div>
          <div>
            <label htmlFor={`${id}-to`} className={LABEL}>To</label>
            <input id={`${id}-to`} type="date" value={range.to} onChange={(e) => onPick(`${range.from}..${e.target.value}`, false)} className={INPUT} />
          </div>
        </>
      )}
    </div>
  );
}

/** Toggle chips; the value is the comma-joined picks. */
function MultiControl({ spec, label, raw, onPick }) {
  const picked = new Set(raw ? raw.split(",") : []);
  const toggle = (v) => {
    const next = new Set(picked);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onPick([...next].join(","));
  };
  return (
    <fieldset>
      <legend className={LABEL}>{label}</legend>
      <div className="flex flex-wrap gap-1">
        {optionsOf(spec).map((o) => (
          <button
            key={o.value} type="button" aria-pressed={picked.has(o.value)} onClick={() => toggle(o.value)}
            className={`h-9 rounded-full px-3 text-xs font-medium ${picked.has(o.value) ? "bg-navy text-white" : "bg-surface-100 text-navy hover:bg-surface-200"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
