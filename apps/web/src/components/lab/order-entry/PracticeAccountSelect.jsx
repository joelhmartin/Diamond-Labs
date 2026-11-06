import { useEffect, useState } from "react";
import api from "../../../config/api.js";
import { INPUT } from "../form-styles.js";

/**
 * The practices (client accounts) a client login belongs to, for choosing which one a new
 * order bills to. `null` while loading or when there is no client; a failed lookup reads as
 * "none to choose" (the server still decides: it answers 422 "Choose which practice this is for."
 * when the client has several and none was sent).
 */
export function usePracticeAccounts(clientUserId) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    setRows(null);
    if (!clientUserId) return undefined;
    let live = true;
    api.get(`/lab/clients/${encodeURIComponent(clientUserId)}/practices`)
      .then((res) => { if (live) setRows(res.data.data.practices ?? []); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [clientUserId]);
  return rows;
}

/** Does this client have to choose a practice (more than one)? The one rule the select and its form share. */
export const needsPracticeChoice = (practices) => Boolean(practices && practices.length > 1);

/**
 * A practice select, shown ONLY when the client belongs to more than one practice.
 * Controlled: `value` is an account id, `onChange(id)`. `practices` comes from usePracticeAccounts.
 * `label` names what is chosen ("Bill to" for an order, "Practice" for a pickup); `error` shows under it.
 */
export function PracticeAccountSelect({ practices, value, onChange, disabled = false, label = "Bill to", error = null }) {
  if (!needsPracticeChoice(practices)) return null;
  return (
    <label className="block text-sm">
      <span className="text-xs text-navy/50">{label}</span>
      <select aria-label={label} className={INPUT} disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose which practice this is for</option>
        {practices.map((p) => <option key={p.id} value={p.id}>{p.name}{p.accountNumber ? ` (${p.accountNumber})` : ""}</option>)}
      </select>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </label>
  );
}
