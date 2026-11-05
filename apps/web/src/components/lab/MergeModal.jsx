import { useEffect, useState } from "react";
import { LAB_MERGE_MIN, LAB_MERGE_MAX } from "@my-app/shared";
import api from "../../config/api.js";
import { Modal } from "../ui/Modal.jsx";
import { ConfirmButton } from "../ui/ConfirmButton.jsx";
import { useToast } from "../ui/Toast.jsx";
import { errorText, isStale } from "../../lib/requests.js";

/**
 * The bulk "Merge…" action for a lab-order DataTable: enabled for 2–5
 * selected orders, it hands them to `open(rows)` (the page shows MergeModal).
 */
export function mergeBulkAction(open) {
  return {
    id: "merge",
    label: "Merge…",
    disabled: (rows) => rows.length < LAB_MERGE_MIN || rows.length > LAB_MERGE_MAX,
    run: (rows) => { open(rows); },
  };
}

/**
 * Merge the selected orders into the one staff pick as primary (POST
 * /lab/orders/merge, with the version of every order as listed). Nothing is
 * pre-picked, and the merge asks for a second click. The server refuses
 * other practices or patients, labelled, shipped or invoiced orders, and says why.
 * `onMerged()` runs after a merge, or after a STALE refusal (the list is out of date).
 */
export function MergeModal({ rows, onClose, onMerged, post = (path, body) => api.post(path, body) }) {
  const { addToast } = useToast();
  const [primaryId, setPrimaryId] = useState(null);
  useEffect(() => { setPrimaryId(null); }, [rows]);

  const list = rows ?? [];
  const primary = list.find((r) => r.id === primaryId) ?? null;
  const n = list.length;

  const merge = async () => {
    try {
      const res = await post("/lab/orders/merge", {
        primaryId: primary.id,
        otherIds: list.filter((r) => r.id !== primary.id).map((r) => r.id),
        versions: Object.fromEntries(list.map((r) => [r.id, r.version])),
      });
      addToast({ message: `Merged ${n} orders into #${res.data.data.primary.orderNumber}`, type: "success" });
      onMerged?.();
    } catch (err) {
      addToast({ message: errorText(err), type: "error", duration: 8000 });
      if (isStale(err)) onMerged?.();
    }
  };

  return (
    <Modal open={Boolean(rows)} onClose={onClose} title={`Merge ${n} orders`}>
      <p className="mb-3 text-sm text-navy/70">
        Pick the order to keep. The others' lines move onto it and they are cancelled, marked “Merged into” it.
        Their draft invoices are voided, so any edits there (price overrides, manual lines, discounts) are dropped,
        and the moved lines are re-priced on the kept order's draft.
      </p>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-semibold text-navy/60">Keep</legend>
        {list.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-surface-50">
            <input type="radio" name="merge-primary" className="mt-1" checked={primaryId === r.id} onChange={() => setPrimaryId(r.id)} />
            <span>
              <span className="font-mono font-bold text-navy">#{r.orderNumber}</span>
              <span className="text-navy/60"> · {r.practice ?? "—"} · {r.deviceSummary ?? "—"}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-full bg-surface-100 px-4 py-2 text-sm font-semibold text-navy hover:bg-surface-200">
          Never mind
        </button>
        <ConfirmButton
          onConfirm={merge}
          disabled={!primary}
          confirmLabel={primary ? `Click again to merge ${n} orders into #${primary.orderNumber}` : undefined}
          className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90"
        >
          {`Merge ${n} orders`}
        </ConfirmButton>
      </div>
    </Modal>
  );
}
