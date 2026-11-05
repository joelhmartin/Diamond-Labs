import { useEffect, useMemo, useState } from "react";
import api from "../../../config/api.js";
import { errorText } from "../../../lib/requests.js";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue.js";
import { INPUT } from "../form-styles.js";

/**
 * Chooses the practice (an active doctor user) an order is for. Searches the
 * staff practice lookup (server-side, debounced) by name or email.
 * Controlled: `value` is a user id, `onChange(id)`.
 */
export function PracticePicker({ value, onChange, disabled = false }) {
  const [practices, setPractices] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const term = useDebouncedValue(q, 300);

  useEffect(() => {
    let live = true;
    api.get("/lab/practices", { params: { q: term.trim() || undefined } })
      .then((res) => { if (live) { setPractices(res.data.data.practices); setError(""); } })
      .catch((err) => { if (live) { setPractices((cur) => cur ?? []); setError(errorText(err)); } });
    return () => { live = false; };
  }, [term]);

  const pick = (id) => {
    setChosen((practices ?? []).find((u) => u.id === id) ?? null);
    onChange(id);
  };
  // The chosen practice stays selectable while the search narrows past it.
  const shown = useMemo(() => {
    const list = practices ?? [];
    return chosen && value === chosen.id && !list.some((u) => u.id === chosen.id) ? [chosen, ...list] : list;
  }, [practices, chosen, value]);

  return (
    <div className="space-y-2">
      <input
        aria-label="Search practices"
        className={INPUT}
        placeholder="Search practices by name or email"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
      />
      <select aria-label="Practice" className={INPUT} disabled={disabled || practices === null} value={value ?? ""} onChange={(e) => pick(e.target.value)}>
        <option value="">{practices === null ? "Loading practices…" : "Choose a practice"}</option>
        {shown.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}{u.name && u.email ? ` (${u.email})` : ""}</option>)}
      </select>
      {error && <p role="alert" className="text-xs text-red-600">Couldn't load practices: {error}</p>}
    </div>
  );
}
