import { useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { ParamFields, isPartialRange } from "../../components/ui/params/index.js";
import { normalizeParams, paramsKey } from "./params.js";
import { searchLookup, lookupLabel } from "./api.js";

const LOOKUP = { search: searchLookup, labelFor: lookupLabel };

/**
 * The params form: the shared param controls (`ParamFields`) plus Run. Picks
 * (selects, presets, toggles, lookups) apply at once, carrying any typed edits
 * with them; typed values (numbers, custom dates) apply on Run. A half-filled
 * custom range holds everything until both ends are set. `params` are raw
 * query values (see params.js).
 *
 * Run with changed values only writes them (the change runs the report); Run
 * with nothing changed reruns. Either way, one fetch.
 */
export function ReportParamsForm({ specs = [], params, onChange, onRun, running }) {
  const [draft, setDraft] = useState(params);
  useEffect(() => setDraft(params), [params]);
  const incomplete = specs.some((s) => s.type === "dateRange" && isPartialRange(draft[s.name]));

  const set = (name, raw, { apply = false } = {}) => {
    const next = { ...draft, [name]: raw };
    setDraft(next);
    const held = specs.some((s) => s.type === "dateRange" && isPartialRange(next[s.name]));
    if (apply && !held) onChange(next);
  };
  const submit = (e) => {
    e.preventDefault();
    if (incomplete) return;
    const changed = paramsKey(normalizeParams(specs, draft)) !== paramsKey(normalizeParams(specs, params));
    if (changed) onChange(draft);
    else onRun();
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-2xl border border-surface-300/50 bg-white p-4">
      <ParamFields specs={specs} values={draft} onChange={set} lookup={LOOKUP} />
      <button
        type="submit"
        disabled={running || incomplete}
        title={incomplete ? "Set both ends of the date range" : undefined}
        className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-navy px-4 text-sm font-semibold text-white transition-transform hover:scale-[1.03] disabled:opacity-60"
      >
        {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        Run
      </button>
    </form>
  );
}
