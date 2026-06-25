import { useState } from "react";
import { X, AlertCircle, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25 disabled:bg-surface-100 disabled:text-navy/60";

function formatUSD(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Admin refund/void modal.
 *
 * @param {object}   props
 * @param {function} props.onClose
 * @param {string}  [props.presetTransactionId] — prefill + lock the txn field
 *   (launched from a specific payment row).
 * @param {object}  [props.payment] — the payment row ({ invoices: [{seazonaInvoiceId,
 *   invoiceNumber, amount}] }). When present, the admin can refund specific
 *   invoice slices (partial, settled charges only). Reverting to all invoices at
 *   full amounts sends a full reversal.
 * @param {function}[props.onDone] — called after a successful reversal.
 */
export function RefundPaymentModal({ onClose, presetTransactionId = "", payment = null, onDone }) {
  const [transactionId, setTransactionId] = useState(presetTransactionId);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  const { addToast } = useToast();

  const invoices = payment?.invoices || [];
  const hasBreakdown = invoices.length > 0;

  // Editable per-invoice refund lines (default: all included at full amount).
  const [lines, setLines] = useState(() =>
    invoices.map((inv) => ({
      invoiceId: inv.seazonaInvoiceId,
      label: inv.invoiceNumber || inv.seazonaInvoiceId,
      max: round2(inv.amount),
      include: true,
      amountStr: round2(inv.amount).toFixed(2),
    }))
  );

  const setLine = (i, patch) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const parsed = lines.map((l) => {
    const raw = parseFloat(l.amountStr);
    // Validate the rounded cents value — the same value submit() sends — so a
    // sub-cent entry (0.004 → 0.00, or 10.005 → 10.01) can't pass here and then
    // change on the wire.
    const amt = Number.isNaN(raw) ? NaN : round2(raw);
    const valid = !l.include || (!Number.isNaN(amt) && amt > 0 && amt <= l.max + 0.005);
    return { ...l, amt, valid };
  });
  const anySelected = parsed.some((l) => l.include);
  const allValid = parsed.every((l) => l.valid);
  const selectedTotal = round2(parsed.filter((l) => l.include).reduce((s, l) => s + (l.amt || 0), 0));
  // Full reversal when every invoice is included at its full charged amount.
  const isFull =
    hasBreakdown && parsed.every((l) => l.include && Math.abs((l.amt || 0) - l.max) <= 0.005);

  const trimmedTxn = transactionId.trim();
  const locked = Boolean(presetTransactionId);
  const valid =
    trimmedTxn.length > 0 && !submitting && (!hasBreakdown || (anySelected && allValid));

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setErr(null);
    try {
      const body = { transactionId: trimmedTxn };
      // Send allocations only for a genuine partial; a full selection reverses
      // the whole charge via the default path.
      if (hasBreakdown && !isFull) {
        body.allocations = parsed
          .filter((l) => l.include)
          .map((l) => ({ invoiceId: l.invoiceId, amount: round2(l.amt) }));
      }
      const res = await api.post("/admin/payments/refund", body);
      const d = res.data?.data || {};
      const verb = d.action === "void" ? "Void" : "Refund";
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
      setErr(e.response?.data?.error?.message || e.message || "Failed to refund the payment.");
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
          Voids an unsettled charge or refunds a settled one at the gateway, then
          un-pays the affected invoices in the portal.
          {hasBreakdown && " Adjust the amounts below to refund only part of the charge (settled charges only)."}
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

        {hasBreakdown && (
          <div className="mt-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-navy/40">
              Invoices to refund
            </p>
            <div className="mt-2 space-y-2">
              {parsed.map((l, i) => (
                <div key={l.invoiceId} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={l.include}
                    onChange={() => setLine(i, { include: !l.include })}
                    disabled={submitting}
                    className="accent-brand-600"
                    aria-label={`Include invoice ${l.label}`}
                  />
                  <span className="w-24 shrink-0 truncate text-sm text-navy/70">#{l.label}</span>
                  <span className="text-navy/40">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.amountStr}
                    onChange={(e) => setLine(i, { amountStr: e.target.value })}
                    disabled={submitting || !l.include}
                    aria-label={`Refund amount for invoice ${l.label}`}
                    className={`${INPUT} flex-1 ${!l.valid ? "border-red-400" : ""}`}
                  />
                  <span className="whitespace-nowrap text-xs text-navy/40">/ {formatUSD(l.max)}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs font-medium text-navy/70">
              {isFull ? "Full refund" : `Partial refund · ${formatUSD(selectedTotal)}`}
            </p>
          </div>
        )}

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
