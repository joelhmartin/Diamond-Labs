import { useEffect, useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { LAB_MATERIALS_MAX, LAB_MATERIAL_NAME_MAX, LAB_MATERIAL_LOT_MAX } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { errorText } from "../../lib/requests.js";
import { INPUT_BASE } from "./form-styles.js";

const toDraft = (materials = []) => materials.map((m) => ({ material: m.material, lot: m.lotNumber ?? "" }));

/**
 * One line's materials and lot numbers (the expandable sub-row under it in LinesEditor).
 * Material names autocomplete from what the lab used in the last year. Saving replaces the
 * line's whole list; it is allowed on a shipped order (traceability is often recorded late)
 * and refused by the server on a cancelled one. `onChanged` reloads the order.
 */
export function MaterialsRow({ order, line, onChanged }) {
  const { addToast } = useToast();
  const listId = useId();
  const [rows, setRows] = useState(() => toDraft(line.materials));
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const locked = order.status === "cancelled";

  useEffect(() => {
    let live = true;
    api.get("/lab/materials/suggestions").then((res) => { if (live) setSuggestions(res.data.data.suggestions ?? []); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/lab/orders/${order.id}/lines/${line.id}/materials`, { materials: rows.filter((r) => r.material.trim()) });
      addToast({ message: "Materials saved.", type: "success" });
      await onChanged?.();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" aria-label={`Materials for ${line.name}`}>
      <p className="text-xs font-semibold text-navy/60">Material name / lot</p>
      <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      {rows.length === 0 && <p className="text-xs text-navy/40">No materials recorded.</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input
            list={listId}
            aria-label={`Material ${i + 1}`}
            className={`${INPUT_BASE} min-w-[12rem] flex-1`}
            maxLength={LAB_MATERIAL_NAME_MAX}
            placeholder="Material name"
            disabled={busy || locked}
            value={r.material}
            onChange={(e) => setRow(i, { material: e.target.value })}
          />
          <input
            aria-label={`Lot number ${i + 1}`}
            className={`${INPUT_BASE} w-40`}
            maxLength={LAB_MATERIAL_LOT_MAX}
            placeholder="Lot"
            disabled={busy || locked}
            value={r.lot}
            onChange={(e) => setRow(i, { lot: e.target.value })}
          />
          <button type="button" aria-label={`Remove material ${i + 1}`} disabled={busy || locked} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="rounded-md p-1 text-navy/40 hover:bg-surface-200 hover:text-navy">
            <X size={14} />
          </button>
        </div>
      ))}
      {!locked && (
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy || rows.length >= LAB_MATERIALS_MAX} onClick={() => setRows((rs) => [...rs, { material: "", lot: "" }])} className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy hover:bg-surface-200 disabled:opacity-40">
            <Plus size={12} /> Add material
          </button>
          <button type="button" disabled={busy} onClick={save} className="rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/90 disabled:opacity-40">
            Save materials
          </button>
        </div>
      )}
    </div>
  );
}
