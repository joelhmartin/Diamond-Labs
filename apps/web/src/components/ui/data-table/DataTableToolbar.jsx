import { useState } from "react";
import { Download, Loader2, Search, X } from "lucide-react";
import { useToast } from "../Toast.jsx";
import { errorText } from "../../../lib/requests.js";
import { isEmptyFilterValue } from "../../../lib/data-table/table-state.js";
import { FilterControl, CONTROL } from "./FilterControl.jsx";

/** Search on the left, filters beside it, `toolbarRight` (and "Export CSV" when `exportAll` is set) at the right. */
export function DataTableToolbar({ table, searchable, searchPlaceholder, toolbarRight, exportAll }) {
  const { filterDefs, filters, setFilter, q, setQ, resetFilters } = table;
  const active = Boolean(q.trim()) || filterDefs.some((d) => !isEmptyFilterValue(filters[d.id]));
  if (!searchable && filterDefs.length === 0 && !toolbarRight && !exportAll) return null;

  return (
    <div className="flex min-h-[44px] flex-wrap items-center gap-2">
      {searchable && (
        <div className="relative w-full sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder ?? "Search…"}
            aria-label={searchPlaceholder ?? "Search"}
            className={`${CONTROL} w-full pl-9 text-sm`}
          />
        </div>
      )}
      {filterDefs.map((def) => (
        <FilterControl key={def.id} def={def} value={filters[def.id]} onChange={(v) => setFilter(def.id, v)} />
      ))}
      {active && (
        <button
          type="button"
          onClick={resetFilters}
          className="inline-flex h-9 items-center gap-1 rounded-xl px-2 text-xs text-navy/50 hover:text-navy"
        >
          <X size={12} /> Reset
        </button>
      )}
      {(toolbarRight || exportAll) && (
        <div className="ml-auto flex items-center gap-2">
          {toolbarRight}
          {exportAll && <ExportAllButton exportAll={exportAll} />}
        </div>
      )}
    </div>
  );
}

/** Whole-result export: busy while it runs, a failure is toasted. */
function ExportAllButton({ exportAll }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await exportAll();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-surface-300/60 bg-white px-3 text-xs font-medium text-navy hover:bg-surface-50 disabled:opacity-50"
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      {busy ? "Exporting…" : "Export CSV"}
    </button>
  );
}
