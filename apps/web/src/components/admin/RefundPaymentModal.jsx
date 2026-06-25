import { useState } from "react";
import { X, AlertCircle, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25 disabled:bg-surface-100 disabled:text-navy/60";

function formatUSD(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Admin refund/void modal. FULL reversal only.
 *
 * @param {object}   props
 * @param {function} props.onClose
 * @param {string}  [props.presetTransactionId] — when provided, the field is
 *   prefilled and locked (launched from a specific payment row).
 * @param {function}[props.onDone] — called after a successful reversal so the
 *   caller can refresh its list.
 */
export function RefundPaymentModal({ onClose, presetTransactionId = "", onDone }) {
  const [transactionId, setTransactionId] = useState(presetTransactionId);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  const { addToast } = useToast();

  const locked = Boolean(presetTransactionId);
  const trimmedTxn = transactionId.trim();
  const valid = trimmedTxn.length > 0 && !submitting;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setErr(null);
    try {
      // Full refund/void only (partial-by-invoice is a planned follow-up).
      const res = await api.post("/admin/payments/refund", { transactionId: trimmedTxn });
      const d = res.data?.data || {};
      const verb = d.action === "void" ? "Void" : "Refund";
      // The gateway reversal can succeed while the local ledger reversal fails —
      // surface that as a warning (manual reconcile) rather than a clean success.
      addToast(
        d.ledgerWriteFailed
          ? {
              message: `${verb} of ${formatUSD(d.amount)} succeeded at the gateway, but the portal ledger needs manual reconciliation (txn ${trimmedTxn}).`,
              type: "warning",
            }
          : {
              message: `${d.action === "void" ? "Voided" : "Refunded"} ${formatUSD(d.amount)} (txn ${trimmedTxn}).`,
              type: "success",
            }
      );
      onDone?.();
      onClose();
    } catch (e) {
      setErr(
        e.response?.data?.error?.message || e.message || "Failed to refund the payment."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-navy/30 hover:text-navy"
        >
          <X size={18} />
        </button>

        <h3 className="font-heading font-bold text-lg text-navy">Refund a payment</h3>
        <p className="mt-1 text-xs text-navy/50">
          Voids an unsettled charge or refunds a settled one at the gateway (full
          amount), then un-pays the affected invoices in the portal.
        </p>

        <label className="mt-4 block text-[10px] font-mono uppercase tracking-widest text-navy/40">
          Transaction ID
        </label>
        <input
          type="text"
          value={transactionId}
          onChange={(e) => setTransactionId(e.target.value)}
          disabled={submitting || locked}
          className={`${INPUT} mt-1.5`}
          placeholder="Authorize.net transaction id"
          autoFocus={!locked}
        />

        {err && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-all disabled:opacity-50"
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            Issue refund
          </button>
        </div>
      </div>
    </div>
  );
}
