import { useState } from "react";
import { AlertCircle, Loader2, Pencil, Trash2 } from "lucide-react";
import api from "../../../config/api.js";
import { ConfirmButton } from "../../ui/ConfirmButton.jsx";
import { LineEditor } from "./LineEditor.jsx";
import { LineStatusBadge } from "./parts.jsx";
import { errMsg } from "./helpers.js";

export function LineRow({ caseId, line, locked, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(line.status === "open" && !line.noteOnly);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const del = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/admin/rx-cases/${caseId}/lines/${line.id}`);
      onDeleted(line.id);
    } catch (err) {
      setError(errMsg(err));
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 border-b border-surface-300/30 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-navy">{line.name || line.sourceLabel || "Unnamed line"}</span>
            <LineStatusBadge line={line} />
            {line.origin === "manual" && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-700">
                Edited
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-navy/50">
            {line.seazonaCode && <span className="font-mono">Code {line.seazonaCode}</span>}
            {line.arch && <span>{line.arch}</span>}
            {line.sourceLabel && line.sourceLabel !== line.name && (
              <span>From: {line.sourceLabel}</span>
            )}
          </div>
        </div>

        {!locked && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {!(line.status === "open" && !line.noteOnly) && (
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-navy/30 hover:text-navy hover:bg-surface-100 transition-all"
                title="Edit this line"
              >
                <Pencil size={13} />
              </button>
            )}
            <ConfirmButton
              disabled={deleting}
              onConfirm={del}
              confirmLabel="Click again to remove"
              title={`Delete ${line.name || line.sourceLabel || "this line"}`}
              className="h-7 min-w-7 px-1.5 whitespace-nowrap text-[11px] font-semibold rounded-full flex items-center justify-center text-navy/30 hover:text-red-600 hover:bg-red-50 transition-all disabled:opacity-40"
            >
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </ConfirmButton>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!locked && editing && (
        <LineEditor
          caseId={caseId}
          line={line}
          onSaved={(updated) => {
            onSaved(updated);
            setEditing(updated.status === "open" && !updated.noteOnly);
          }}
          onCancel={line.status !== "open" || line.noteOnly ? () => setEditing(false) : undefined}
        />
      )}
    </div>
  );
}
