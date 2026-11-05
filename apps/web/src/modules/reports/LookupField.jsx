import { useEffect, useId, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { errorText } from "../../lib/requests.js";
import { searchLookup } from "./api.js";

/**
 * Debounced typeahead over `/reports/lookups/:source`. `value` is the picked
 * value (a string; "" for none) and `onChange(value, option)` fires on pick and
 * on clear. Self-contained: the one tie to reports is the `search(source, q,
 * { signal })` prop's default, so it can move into components/ui as a general
 * picker later.
 *
 *   <LookupField source="client" value={v} onChange={setV} label="Client" />
 */
export function LookupField({ source, value, onChange, label, id, placeholder = "Type to search…", search = searchLookup }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-options`;
  const [picked, setPicked] = useState(null); // { value, label } of the last pick, for display
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [active, setActive] = useState(0);
  const [state, setState] = useState({ loading: false, error: null });
  const q = useDebouncedValue(text, 250);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setState({ loading: true, error: null });
    search(source, q, { signal: controller.signal })
      .then((found) => { setOptions(found || []); setActive(0); setState({ loading: false, error: null }); })
      .catch((err) => { if (!controller.signal.aborted) setState({ loading: false, error: errorText(err) }); });
    return () => controller.abort();
  }, [open, source, q, search]);

  useEffect(() => {
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (opt) => {
    setPicked(opt);
    setText("");
    setOpen(false);
    onChange?.(opt ? String(opt.value) : "", opt);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && open && options[active]) { e.preventDefault(); choose(options[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  // Without a pick in this session (e.g. a shared link), show the raw value.
  const shown = value ? (picked && String(picked.value) === String(value) ? picked.label : String(value)) : "";

  return (
    <div ref={box} className="relative">
      {label && <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-navy/60">{label}</label>}
      <div className="relative">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={open ? text : shown}
          placeholder={shown || placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          className="h-9 w-full rounded-xl border border-surface-300/60 bg-white pl-3 pr-8 text-sm text-navy focus:border-brand-500 focus:outline-none"
        />
        {value && (
          <button
            type="button"
            aria-label={`Clear ${label ?? "selection"}`}
            onClick={() => choose(null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-navy/40 hover:text-navy"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-surface-300/60 bg-white py-1 shadow-lg">
          {state.loading && <li className="flex items-center gap-2 px-3 py-2 text-xs text-navy/40"><Loader2 size={12} className="animate-spin" /> Searching…</li>}
          {!state.loading && state.error && <li className="px-3 py-2 text-xs text-red-700">{state.error}</li>}
          {!state.loading && !state.error && options.length === 0 && <li className="px-3 py-2 text-xs text-navy/40">No matches.</li>}
          {!state.loading && !state.error && options.map((opt, i) => (
            <li
              key={String(opt.value)}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(opt); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-brand-500/10 text-navy" : "text-navy/80"}`}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
