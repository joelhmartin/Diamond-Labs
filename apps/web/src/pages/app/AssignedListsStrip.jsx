import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import api from "../../config/api.js";
import { CONTROL } from "../../components/ui/data-table/FilterControl.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { errorText } from "../../lib/requests.js";

/**
 * A client's assigned price lists in precedence order (first wins), with add,
 * remove and move up/down. Each change replaces the whole assignment. Archived
 * lists stay in place, struck through, because they no longer apply.
 */
export function AssignedListsStrip({ userId, assigned, allLists, onChanged }) {
  const { addToast } = useToast();
  const [adding, setAdding] = useState("");
  const ids = assigned.map((l) => l.listId);

  async function put(listIds) {
    try {
      await api.put(`/admin/clients/${userId}/price-lists`, { listIds });
      setAdding("");
      await onChanged();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  }

  const move = (i, by) => {
    const next = [...ids];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    return put(next);
  };
  const available = allLists.filter((l) => !ids.includes(l.id));

  return (
    <section aria-label="Assigned lists" className="rounded-2xl border border-surface-300/50 bg-white p-4">
      <div className="mb-2 text-[10px] font-mono uppercase tracking-widest text-navy/40">Assigned lists, highest precedence first</div>
      <div className="flex flex-wrap items-center gap-2">
        {assigned.length === 0 && <span className="text-sm text-navy/40">No lists assigned.</span>}
        {assigned.map((l, i) => (
          <span key={l.listId} className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 py-1 pl-3 pr-1 text-xs font-semibold text-brand-700">
            <span className="font-mono text-[10px] text-brand-700/60">{i + 1}</span>
            <span className={l.archivedAt ? "line-through opacity-60" : ""} title={l.archivedAt ? "Archived: its prices no longer apply" : undefined}>{l.name}</span>
            <button type="button" aria-label={`Move ${l.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded-full p-0.5 hover:bg-brand-500/20 disabled:opacity-30"><ArrowUp size={12} /></button>
            <button type="button" aria-label={`Move ${l.name} down`} disabled={i === assigned.length - 1} onClick={() => move(i, 1)} className="rounded-full p-0.5 hover:bg-brand-500/20 disabled:opacity-30"><ArrowDown size={12} /></button>
            <button type="button" aria-label={`Remove ${l.name}`} onClick={() => put(ids.filter((x) => x !== l.listId))} className="rounded-full p-0.5 hover:bg-brand-500/20"><X size={12} /></button>
          </span>
        ))}
        {available.some((l) => !l.archivedAt) && (
          <select aria-label="Add a price list" value={adding} onChange={(e) => e.target.value && put([...ids, e.target.value])} className={CONTROL}>
            <option value="">Add a list…</option>
            {available.filter((l) => !l.archivedAt).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </div>
    </section>
  );
}
