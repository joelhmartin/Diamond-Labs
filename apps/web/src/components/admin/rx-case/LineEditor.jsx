import { useState } from "react";
import { AlertCircle } from "lucide-react";
import api from "../../../config/api.js";
import { ConfirmButton } from "../../ui/ConfirmButton.jsx";
import { CatalogPicker } from "./CatalogPicker.jsx";
import { errMsg } from "./helpers.js";

const ALWAYS_CONFIRM = "Click again — changes ALL future prescriptions";

// A plain button for a once-off save; a two-click ConfirmButton for a permanent one.
function SaveButton({ scope, onClick, children, ...rest }) {
  if (scope === "always") {
    return (
      <ConfirmButton onConfirm={onClick} confirmLabel={ALWAYS_CONFIRM} {...rest}>
        {children}
      </ConfirmButton>
    );
  }
  return (
    <button type="button" onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

export function LineEditor({ caseId, line, onSaved, onCancel }) {
  const [selected, setSelected] = useState(null); // { code, name }
  const [scope, setScope] = useState("once");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // scope: "always" writes a PERMANENT mapping override — every future
  // prescription with this same selection resolves this way. That is
  // deliberate and far-reaching, so the save buttons turn into two-click
  // ConfirmButtons while it is selected (an ordinary once-off fix stays one click).
  const save = async (body) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.put(`/admin/rx-cases/${caseId}/lines/${line.id}`, body);
      onSaved(res.data.data);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const assign = () => {
    if (!selected) return;
    save({ seazonaCode: selected.code, name: selected.name, noteOnly: false, scope });
  };

  const markNoteOnly = () => {
    save({ noteOnly: true, scope });
  };

  return (
    <div className="mt-2 p-3 rounded-xl border border-surface-300/60 bg-surface-50 space-y-2.5">
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <CatalogPicker disabled={busy} onPick={(r) => setSelected(r)} />

      {selected && (
        <div className="text-xs text-navy/70 bg-white rounded-lg border border-surface-300/50 px-2.5 py-1.5">
          Selected: <span className="font-mono text-navy/60">{selected.code}</span> — {selected.name}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-navy/70">
        <span className="font-mono uppercase tracking-widest text-[10px] text-navy/40">Scope</span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name={`scope-${line.id}`} checked={scope === "once"} onChange={() => setScope("once")} disabled={busy} />
          This case only
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name={`scope-${line.id}`} checked={scope === "always"} onChange={() => setScope("always")} disabled={busy} />
          <span className="text-amber-700 font-semibold">Always (future cases too)</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <SaveButton
          key={`assign-${scope}-${selected?.code}`}
          scope={scope}
          disabled={busy || !selected}
          onClick={assign}
          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Saving…" : "Assign"}
        </SaveButton>
        <SaveButton
          key={`note-${scope}-${selected?.code}`}
          scope={scope}
          disabled={busy}
          onClick={markNoteOnly}
          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-surface-300/60 text-navy/70 hover:text-navy hover:border-navy/30 transition-colors disabled:opacity-40"
        >
          Not a line item — send as a note
        </SaveButton>
        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3 py-1.5 rounded-full text-xs font-semibold text-navy/40 hover:text-navy transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
