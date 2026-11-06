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

/**
 * A practice select, shown ONLY when the client belongs to more than one practice.
 * Controlled: `value` is an account id, `onChange(id)`. `practices` comes from usePracticeAccounts.
 */
export function PracticeAccountSelect({ practices, value, onChange, disabled = false }) {
  if (!practices || practices.length < 2) return null;
  return (
    <label className="block text-sm">
      <span className="text-xs text-navy/50">Bill to</span>
      <select aria-label="Bill to" className={INPUT} disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose which practice this is for</option>
        {practices.map((p) => <option key={p.id} value={p.id}>{p.name}{p.accountNumber ? ` (${p.accountNumber})` : ""}</option>)}
      </select>
    </label>
  );
}
