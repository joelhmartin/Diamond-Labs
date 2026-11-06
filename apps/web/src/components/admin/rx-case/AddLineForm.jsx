import { useState } from "react";
import { AlertCircle, X } from "lucide-react";
import api from "../../../config/api.js";
import { CatalogPicker } from "./CatalogPicker.jsx";
import { errMsg } from "./helpers.js";

export function AddLineForm({ caseId, onAdded, onClose }) {
  const [name, setName] = useState("");
  const [arch, setArch] = useState("");
  const [noteOnly, setNoteOnly] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/admin/rx-cases/${caseId}/lines`, {
        name: name.trim(),
        arch: arch || null,
        noteOnly,
        seazonaCode: noteOnly ? null : selected?.code || null,
        sourceLabel: name.trim(),
      });
      onAdded(res.data.data);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 rounded-2xl border border-dashed border-surface-300/70 bg-surface-50 space-y-3 mb-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono uppercase tracking-widest text-navy/50">Add a line the resolver missed</h3>
        <button type="button" onClick={onClose} className="text-navy/30 hover:text-navy">
          <X size={14} />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          type="text"
          className="px-3 py-2 rounded-lg border border-surface-300/60 bg-white text-sm text-navy focus:outline-none focus:border-brand-500"
          placeholder="Name (required)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <select
          className="px-3 py-2 rounded-lg border border-surface-300/60 bg-white text-sm text-navy focus:outline-none focus:border-brand-500"
          value={arch}
          onChange={(e) => setArch(e.target.value)}
          disabled={busy}
        >
          <option value="">Arch (optional)</option>
          <option value="Upper">Upper</option>
          <option value="Lower">Lower</option>
          <option value="Both">Both</option>
        </select>
      </div>

      <label className="flex items-center gap-2 text-xs text-navy/70 cursor-pointer">
        <input type="checkbox" checked={noteOnly} onChange={(e) => setNoteOnly(e.target.checked)} disabled={busy} />
        This is a build instruction, not a charged product (send as a note)
      </label>

      {!noteOnly && (
        <div>
          <CatalogPicker disabled={busy} onPick={(r) => setSelected(r)} />
          {selected && (
            <div className="mt-1.5 text-xs text-navy/70 bg-white rounded-lg border border-surface-300/50 px-2.5 py-1.5">
              Selected: <span className="font-mono text-navy/60">{selected.code}</span> — {selected.name}
              {" "}
              <button type="button" className="text-navy/30 hover:text-red-600 ml-1" onClick={() => setSelected(null)}>
                <X size={11} className="inline" />
              </button>
            </div>
          )}
          <p className="mt-1 text-[11px] text-navy/40">
            Leave this blank if you don't have a code yet — you can resolve it after adding.
          </p>
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="px-4 py-2 rounded-full text-xs font-semibold bg-navy text-white hover:bg-navy/90 transition-colors disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add line"}
      </button>
    </div>
  );
}
