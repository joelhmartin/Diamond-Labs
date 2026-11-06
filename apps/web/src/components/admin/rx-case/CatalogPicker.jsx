import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import api from "../../../config/api.js";

// Catalog search shared by the line editor and the add-line form.
export function CatalogPicker({ onPick, disabled }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);

  const doSearch = useCallback((q) => {
    clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get("/admin/rx-mapping/catalog", { params: { q } });
        setResults(res.data.data || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="relative">
      <div className="relative">
        <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy/30 pointer-events-none" />
        <input
          type="text"
          className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-surface-300/60 bg-white text-xs text-navy focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/10 placeholder:text-navy/25 disabled:opacity-50"
          placeholder="Search catalog by code or name…"
          disabled={disabled}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            doSearch(e.target.value);
          }}
        />
        {searching && (
          <Loader2 size={10} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-navy/40" />
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-surface-300/60 bg-white shadow-md divide-y divide-surface-200/60 max-h-40 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.code}
              type="button"
              disabled={disabled}
              onClick={() => {
                onPick(r);
                setQuery("");
                setResults([]);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-surface-50 transition-colors"
            >
              <span className="font-mono text-navy/60 mr-1.5">{r.code}</span>
              <span className="text-navy/80">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
