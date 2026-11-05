import { useEffect, useMemo, useState } from "react";
import api from "../../../config/api.js";
import { errorText } from "../../../lib/requests.js";
import { INPUT } from "../form-styles.js";

/**
 * Chooses the practice (an active doctor user) an order is for. Reads the existing
 * admin user list once and filters it here; a search box narrows the list by name or email.
 * Controlled: `value` is a user id, `onChange(id)`.
 */
export function PracticePicker({ value, onChange, disabled = false }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let live = true;
    api.get("/admin/users")
      .then((res) => { if (live) setUsers(res.data.data.users.filter((u) => u.role === "doctor" && u.status === "active")); })
      .catch((err) => { if (live) { setUsers([]); setError(errorText(err)); } });
    return () => { live = false; };
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = users ?? [];
    const hits = needle ? list.filter((u) => `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(needle)) : list;
    // The chosen practice stays selectable while the search narrows past it.
    const chosen = list.find((u) => u.id === value);
    return chosen && !hits.includes(chosen) ? [chosen, ...hits] : hits;
  }, [users, q, value]);

  return (
    <div className="space-y-2">
      <input
        aria-label="Search practices"
        className={INPUT}
        placeholder="Search practices by name or email"
        value={q}
        disabled={disabled || users === null}
        onChange={(e) => setQ(e.target.value)}
      />
      <select aria-label="Practice" className={INPUT} disabled={disabled || users === null} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{users === null ? "Loading practices…" : "Choose a practice"}</option>
        {shown.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}{u.name && u.email ? ` (${u.email})` : ""}</option>)}
      </select>
      {error && <p role="alert" className="text-xs text-red-600">Couldn't load practices: {error}</p>}
    </div>
  );
}
