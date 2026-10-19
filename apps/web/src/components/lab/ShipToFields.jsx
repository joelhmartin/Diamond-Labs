import { Info } from "lucide-react";
import { INPUT } from "./form-styles.js";


const FIELDS = [
  ["name", "Name (person)", "sm:col-span-1", 35],
  ["company", "Practice / company", "sm:col-span-1", 35],
  ["address1", "Street address", "sm:col-span-2", 35],
  ["address2", "Suite, unit (optional)", "sm:col-span-2", 35],
  ["city", "City", "sm:col-span-1", 30],
  ["phone", "Phone", "sm:col-span-1", 20],
];

/** Ship-to for THIS shipment only (the doctor's profile is not changed). Shows the profile's delivery hint. */
export function ShipToFields({ value, onChange, hint, disabled }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-navy/50">Ship to</legend>
      {hint && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
          <Info size={12} className="mt-0.5" /> {[hint.method, hint.notes].filter(Boolean).join(" — ")}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {FIELDS.map(([k, label, span, max]) => (
          <label key={k} className={`block ${span}`}>
            <span className="text-xs text-navy/50">{label}</span>
            <input className={INPUT} value={value[k]} maxLength={max} onChange={set(k)} disabled={disabled} />
          </label>
        ))}
        <label className="block">
          <span className="text-xs text-navy/50">State</span>
          <input className={INPUT} value={value.state} maxLength={2} onChange={set("state")} disabled={disabled} />
        </label>
        <label className="block">
          <span className="text-xs text-navy/50">ZIP</span>
          <input className={INPUT} value={value.postalCode} maxLength={10} onChange={set("postalCode")} disabled={disabled} />
        </label>
        <label className="flex items-center gap-2 text-sm text-navy sm:col-span-2">
          <input type="checkbox" checked={Boolean(value.residential)} onChange={(e) => onChange({ ...value, residential: e.target.checked })} disabled={disabled} />
          Residential address (carriers rate homes higher than offices)
        </label>
      </div>
    </fieldset>
  );
}
