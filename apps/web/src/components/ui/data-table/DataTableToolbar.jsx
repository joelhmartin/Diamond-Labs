import { Search, X } from "lucide-react";
import { isEmptyFilterValue } from "../../../lib/data-table/table-state.js";
import { FilterControl, CONTROL } from "./FilterControl.jsx";

/** Search on the left, filters beside it, `toolbarRight` at the right. */
export function DataTableToolbar({ table, searchable, searchPlaceholder, toolbarRight }) {
  const { filterDefs, filters, setFilter, q, setQ, resetFilters } = table;
  const active = Boolean(q.trim()) || filterDefs.some((d) => !isEmptyFilterValue(filters[d.id]));
  if (!searchable && filterDefs.length === 0 && !toolbarRight) return null;

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
      {toolbarRight && <div className="ml-auto flex items-center gap-2">{toolbarRight}</div>}
    </div>
  );
}
