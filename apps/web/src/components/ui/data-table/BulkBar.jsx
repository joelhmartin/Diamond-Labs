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
 * An action may carry a typed value: `input: { label, placeholder?, step? }` draws a number
 * input beside the button; `run(rows, value)`, `disabled(rows, value)`, `label`, `confirmLabel`
 * (string or function) and `hint(rows, value)` (small preview text) all receive it. The button
 * stays disabled until the input holds a finite number.
 */
export function BulkBar({ table, columns, bulkActions = [], exportable, exportFileName }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(null);
  const [inputs, setInputs] = useState({});
  const { count, selectedRows, clear } = table.selection;

  const run = async (action) => {
    setBusy(action.id);
    try {
      const result = await action.run(selectedRows, valueOf(action));
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

  const valueOf = (action) => {
    if (!action.input) return undefined;
    const raw = inputs[action.id];
    return raw === undefined || raw === "" || !Number.isFinite(Number(raw)) ? undefined : Number(raw);
  };

  return (
    <div className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-2xl bg-navy px-4 py-1.5 text-white">
      <span className="mr-2 font-mono text-xs tabular-nums">{count} selected</span>
      {bulkActions.map((action) => {
        const value = valueOf(action);
        const disabled = Boolean(busy) || (action.input && value === undefined) || Boolean(action.disabled?.(selectedRows, value));
        const cls = TONE[action.tone ?? "default"] ?? TONE.default;
        const body = (
          <>
            {action.icon}
            {typeof action.label === "function" ? action.label(selectedRows, value) : action.label}
          </>
        );
        const confirmLabel = typeof action.confirmLabel === "function" ? action.confirmLabel(selectedRows, value) : action.confirmLabel;
        const button = confirmLabel ? (
          <ConfirmButton key={action.id} onConfirm={() => run(action)} confirmLabel={confirmLabel} disabled={disabled} className={cls}>
            {body}
          </ConfirmButton>
        ) : (
          <button key={action.id} type="button" onClick={() => run(action)} disabled={disabled} className={cls}>
            {body}
          </button>
        );
        if (!action.input) return button;
        const hint = value === undefined ? null : action.hint?.(selectedRows, value);
        return (
          <span key={action.id} className="inline-flex items-center gap-1.5">
            <input
              type="number"
              step={action.input.step ?? "any"}
              aria-label={action.input.label}
              placeholder={action.input.placeholder}
              value={inputs[action.id] ?? ""}
              onChange={(e) => setInputs((cur) => ({ ...cur, [action.id]: e.target.value }))}
              className="h-8 w-20 rounded-lg bg-white/10 px-2 text-xs text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/40"
            />
            {button}
            {hint && <span className="font-mono text-[11px] text-white/60">{hint}</span>}
          </span>
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
