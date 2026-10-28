import { useState } from "react";
import { Download, X } from "lucide-react";
import { ConfirmButton } from "../ConfirmButton.jsx";
import { useToast } from "../Toast.jsx";
import { errorText } from "../../../lib/requests.js";
import { toCsv, downloadCsv } from "../../../lib/data-table/csv.js";

const BTN = "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-all disabled:opacity-50";
const TONE = {
  default: `${BTN} bg-white/10 text-white hover:bg-white/20`,
  danger: `${BTN} bg-red-500/90 text-white hover:bg-red-500`,
};

/** "12 done, 1 failed: #100231 changed since you loaded it" (first three failures named). */
export function summarizeResult({ ok = 0, failed = [] }) {
  if (failed.length === 0) return `${ok} done`;
  const named = failed.slice(0, 3).map((f) => `${f.id} ${f.message}`).join("; ");
  const more = failed.length > 3 ? `; and ${failed.length - 3} more` : "";
  return `${ok} done, ${failed.length} failed: ${named}${more}`;
}

/**
 * Replaces the toolbar while rows are selected: count, actions, Export CSV, Clear.
 * A bulk action is `{ id, label, run(rows), icon?, tone?, confirmLabel?, disabled?(rows) }`;
 * `label` may be a string or `(selectedRows) => string` (e.g. a selected total).
 * `run` may return `{ ok, failed }` (see eachRow) to have the outcome toasted.
 */
export function BulkBar({ table, columns, bulkActions = [], exportable, exportFileName }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(null);
  const { count, selectedRows, clear } = table.selection;

  const run = async (action) => {
    setBusy(action.id);
    try {
      const result = await action.run(selectedRows);
      if (result && typeof result === "object") {
        const failedCount = result.failed?.length ?? 0;
        addToast({
          message: summarizeResult(result),
          type: failedCount === 0 ? "success" : result.ok ? "warning" : "error",
          duration: failedCount ? 8000 : 4000,
        });
      }
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-2xl bg-navy px-4 py-1.5 text-white">
      <span className="mr-2 font-mono text-xs tabular-nums">{count} selected</span>
      {bulkActions.map((action) => {
        const disabled = Boolean(busy) || Boolean(action.disabled?.(selectedRows));
        const cls = TONE[action.tone ?? "default"] ?? TONE.default;
        const body = (
          <>
            {action.icon}
            {typeof action.label === "function" ? action.label(selectedRows) : action.label}
          </>
        );
        return action.confirmLabel ? (
          <ConfirmButton key={action.id} onConfirm={() => run(action)} confirmLabel={action.confirmLabel} disabled={disabled} className={cls}>
            {body}
          </ConfirmButton>
        ) : (
          <button key={action.id} type="button" onClick={() => run(action)} disabled={disabled} className={cls}>
            {body}
          </button>
        );
      })}
      {exportable && (
        <button
          type="button"
          onClick={() => downloadCsv(exportFileName, toCsv(selectedRows, columns))}
          className={TONE.default}
        >
          <Download size={12} /> Export CSV
        </button>
      )}
      <button type="button" onClick={clear} className={`${BTN} ml-auto text-white/70 hover:text-white`}>
        <X size={12} /> Clear
      </button>
    </div>
  );
}
