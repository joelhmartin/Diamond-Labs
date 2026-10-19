import { useState } from "react";
import { PARCEL_PRESETS } from "@my-app/shared";
import { INPUT } from "./form-styles.js";
import { applyPreset, splitWeight, weightOzFrom } from "../../lib/shipping.js";

/** The box: a preset (shared list) plus its weight; dimensions are editable. */
export function ParcelFields({ value, onChange, disabled }) {
  const { lb, oz } = splitWeight(value.weightOz);
  // What's typed in the weight boxes, so staff can clear one and retype; only a parsed number is committed.
  const [typed, setTyped] = useState(null);
  const shown = (k, n) => (typed && typed.weightOz === value.weightOz && typed[k] !== undefined ? typed[k] : n);
  const typeWeight = (k) => (e) => {
    const raw = e.target.value;
    const next = { lb: shown("lb", lb), oz: shown("oz", oz), [k]: raw };
    const weightOz = weightOzFrom(next.lb, next.oz);
    setTyped({ ...next, weightOz });
    onChange({ ...value, weightOz });
  };
  const dim = (k) => (e) => onChange({ ...value, preset: "custom", [k]: e.target.value === "" ? "" : Number(e.target.value) });
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-navy/50">Box</legend>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className="text-xs text-navy/50">Preset</span>
          <select className={INPUT} value={value.preset} onChange={(e) => onChange(applyPreset(value, e.target.value))} disabled={disabled}>
            {PARCEL_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-navy/50">Weight (lb)</span>
          <input type="number" min="0" className={INPUT} value={shown("lb", lb)} onChange={typeWeight("lb")} disabled={disabled} />
        </label>
        <label className="block">
          <span className="text-xs text-navy/50">+ oz</span>
          <input type="number" min="0" max="15" className={INPUT} value={shown("oz", oz)} onChange={typeWeight("oz")} disabled={disabled} />
        </label>
        {["lengthIn", "widthIn", "heightIn"].map((k) => (
          <label key={k} className="block">
            <span className="text-xs text-navy/50">{{ lengthIn: "Length", widthIn: "Width", heightIn: "Height" }[k]} (in)</span>
            <input type="number" min="0" step="0.5" className={INPUT} value={value[k] ?? ""} onChange={dim(k)} disabled={disabled} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
