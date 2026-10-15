import { useEffect, useRef, useState } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import { MANUAL_PAYMENT_METHODS, MANUAL_PAYMENT_LABELS } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { AllocationRows } from "../billing/AllocationRows.jsx";
import { formatCents } from "../../lib/money.js";
import { errorText } from "../../lib/requests.js";
import { labToday, typedCents } from "../../lib/invoices.js";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 disabled:bg-surface-100";

/**
 * "Record payment" for a client: a check, cash, ACH or other payment the lab
 * received. No card is charged. Applied oldest-first, or to the invoices staff
 * choose; the server refuses more than is owed and a date before an invoice
 * was issued. Manual payments carry no idempotency key, so the submit button
 * stays disabled while the request is in flight.
 */
export function RecordPaymentModal({ clientUserId, clientName, onClose, onRecorded }) {
  const { addToast } = useToast();
  const [invoices, setInvoices] = useState(null);
  const [method, setMethod] = useState("check");
  const [reference, setReference] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [paidOn, setPaidOn] = useState(labToday());
  const [choose, setChoose] = useState(false);
  const [chosen, setChosen] = useState({}); // invoiceId → amount typed
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const [err, setErr] = useState(null);

  const close = () => {
    if (!inFlight.current) onClose();
  };
  // Escape closes this modal only (never while a submit is in flight). Registered
  // on window in the capture phase and stopped there, so the drawer's own
  // document-level Escape handler underneath never sees it.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // The server's own list: the practice's open invoices, oldest due first. It is exactly
  // what a payment with no chosen invoices is spread over, so what staff see is what is applied.
  useEffect(() => {
    api.get(`/admin/clients/${clientUserId}/invoices`, { params: { open: "true" } })
      .then((res) => setInvoices(res.data.data || []))
      .catch((e) => { setInvoices([]); setErr(errorText(e)); });
  }, [clientUserId]);

  const amountCents = typedCents(amountStr);
  const openCents = (invoices || []).reduce((s, i) => s + i.balanceCents, 0);
  const allocations = Object.entries(chosen)
    .map(([invoiceId, str]) => ({ invoiceId, amountCents: typedCents(str) }))
    .filter((a) => a.amountCents > 0);
  const chosenCents = allocations.reduce((s, a) => s + a.amountCents, 0);
  const valid = amountCents > 0 && amountCents <= openCents && Boolean(paidOn) && (!choose || chosenCents === amountCents) && !submitting;

  const submit = async () => {
    if (!valid || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setErr(null);
    try {
      await api.post(`/admin/clients/${clientUserId}/payments`, {
        method, reference: reference.trim() || undefined, amountCents, paidOn, ...(choose ? { allocations } : {}),
      });
      addToast({ message: `Recorded ${formatCents(amountCents)} (${MANUAL_PAYMENT_LABELS[method]}) for ${clientName || "this client"}.`, type: "success" });
      onRecorded?.();
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={(e) => { e.stopPropagation(); close(); }}>
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={close} className="absolute right-4 top-4 text-navy/30 hover:text-navy" aria-label="Close"><X size={18} /></button>
        <h3 className="font-heading text-lg font-bold text-navy">Record a payment</h3>
        <p className="mt-1 text-xs text-navy/50">
          {clientName ? `${clientName} · ` : ""}practice open balance {invoices ? formatCents(openCents) : "…"}. No card is charged.
        </p>

        {invoices === null ? (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-navy/30" /></div>
        ) : invoices.length === 0 ? (
          <p className="py-6 text-sm text-navy/50">No open invoices to apply a payment to.</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-navy/60">Method
                <select className={`${INPUT} mt-1`} value={method} onChange={(e) => setMethod(e.target.value)}>
                  {MANUAL_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{MANUAL_PAYMENT_LABELS[m]}</option>)}
                </select>
              </label>
              <label className="text-xs text-navy/60">Reference (check #)
                <input className={`${INPUT} mt-1`} value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
              </label>
              <label className="text-xs text-navy/60">Amount
                <input className={`${INPUT} mt-1`} inputMode="decimal" placeholder="0.00" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
              </label>
              <label className="text-xs text-navy/60">Received on
                <input className={`${INPUT} mt-1`} type="date" max={labToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-navy/70">
              <input type="checkbox" className="accent-brand-600" checked={choose} onChange={(e) => setChoose(e.target.checked)} />
              Apply to specific invoices (otherwise oldest due first, across the practice)
            </label>

            {choose && (
              <div className="rounded-xl border border-surface-300/50 p-3">
                <AllocationRows
                  rows={invoices}
                  showDue
                  showOwner
                  className="max-h-48"
                  valueOf={(inv) => chosen[inv.id] ?? ""}
                  onChange={(inv, val) => setChosen((prev) => ({ ...prev, [inv.id]: val }))}
                />
                <p className={`pt-2 text-xs ${chosenCents === amountCents ? "text-navy/50" : "text-amber-700"}`}>
                  Applied {formatCents(chosenCents)} of {formatCents(amountCents)}
                </p>
              </div>
            )}
            {amountCents > openCents && <p className="text-xs text-red-600">More than the open balance. The lab doesn't hold unapplied credit.</p>}
          </div>
        )}

        {err && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" /><span>{err}</span>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded-full px-4 py-2.5 text-xs font-semibold text-navy/60 hover:bg-surface-100">Cancel</button>
          <button type="button" onClick={submit} disabled={!valid}
            className="flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            {submitting && <Loader2 size={12} className="animate-spin" />} Record {amountCents ? formatCents(amountCents) : "payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
