import { useState } from "react";
import { AlertCircle, Plus, RotateCcw } from "lucide-react";
import api from "../../../config/api.js";
import { useToast } from "../../ui/Toast.jsx";
import { ConfirmButton } from "../../ui/ConfirmButton.jsx";
import { AddLineForm } from "./AddLineForm.jsx";
import { LineRow } from "./LineRow.jsx";
import { errMsg } from "./helpers.js";

/** The order-lines list with re-resolve, add-line, and per-line edit/delete. */
export function OrderLinesCard({ caseId, lines, setLines, readOnly }) {
  const { addToast } = useToast();
  const [addingLine, setAddingLine] = useState(false);
  const [reResolving, setReResolving] = useState(false);
  const [reResolveError, setReResolveError] = useState(null);

  const handleLineSaved = (updated) => setLines((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
  const handleLineDeleted = (lineId) => setLines((prev) => prev.filter((l) => l.id !== lineId));
  const handleLineAdded = (created) => setLines((prev) => [...prev, created]);

  const doReResolve = async () => {
    setReResolving(true);
    setReResolveError(null);
    try {
      const res = await api.post(`/admin/rx-cases/${caseId}/re-resolve`);
      setLines(res.data.data.lines || []);
      addToast({
        message: `Re-resolved: ${res.data.data.replaced} replaced, ${res.data.data.kept} kept.`,
        type: "info",
      });
    } catch (err) {
      setReResolveError(errMsg(err));
    } finally {
      setReResolving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-surface-300/40">
        <h2 className="font-heading font-bold text-sm text-navy">
          Order lines <span className="text-navy/30 font-normal">({lines.length})</span>
        </h2>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <ConfirmButton
              disabled={reResolving}
              onConfirm={doReResolve}
              confirmLabel="Click again to re-resolve"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all disabled:opacity-50"
            >
              <RotateCcw size={12} className={reResolving ? "animate-spin" : ""} /> Re-resolve
            </ConfirmButton>
            <button
              type="button"
              onClick={() => setAddingLine((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all"
            >
              <Plus size={12} /> Add line
            </button>
          </div>
        )}
      </div>

      {!readOnly && (
        <p className="px-5 pt-3 text-xs text-navy/50">
          Re-resolve recomputes lines from the prescription. Staff-edited lines are kept; only untouched auto lines are replaced.
        </p>
      )}

      {reResolveError && (
        <div className="mx-5 mt-4 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span>{reResolveError}</span>
        </div>
      )}

      {addingLine && !readOnly && (
        <div className="p-4">
          <AddLineForm caseId={caseId} onAdded={handleLineAdded} onClose={() => setAddingLine(false)} />
        </div>
      )}

      {lines.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-navy/40">No lines on this case yet.</p>
      ) : (
        <div>
          {lines.map((line) => (
            <LineRow
              key={line.id}
              caseId={caseId}
              line={line}
              locked={readOnly}
              onSaved={handleLineSaved}
              onDeleted={handleLineDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}
