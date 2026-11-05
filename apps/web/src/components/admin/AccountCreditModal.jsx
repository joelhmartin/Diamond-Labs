import { useEffect, useRef, useState } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { ConfirmButton } from "../ui/ConfirmButton.jsx";
import { DataTable } from "../ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { formatCents } from "../../lib/money.js";
import { errorText } from "../../lib/requests.js";
import { dateText, typedCents } from "../../lib/invoices.js";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 disabled:bg-surface-100";
const getRowId = (r) => r.id;

function pickerColumns(chosen, setAmount) {
  return [
    { id: "number", header: "Invoice", sortValue: (r) => r.invoiceNumber, cell: (r) => <span className="font-mono text-xs font-medium">#{r.invoiceNumber}</span> },
    { id: "due", header: "Due", sortValue: (r) => r.dueDate ?? "", cell: (r) => <span className="text-xs text-navy/60">{dateText(r.dueDate)}</span> },
    { id: "balance", header: "Owed", align: "right", sortValue: (r) => r.balanceCents, cell: (r) => <span className="text-xs">{formatCents(r.balanceCents)}</span> },
    {
      id: "credit", header: "Credit", align: "right",
      cell: (r) => (
        <input
          type="number" min="0" max={r.balanceCents / 100} step="0.01" placeholder="0.00"
          value={chosen[r.id] ?? ""} onChange={(e) => setAmount(r.id, e.target.value)}
          aria-label={`Credit for invoice ${r.invoiceNumber}`}
          className="w-24 rounded-lg border border-surface-300/60 px-2 py-1 text-right text-sm focus:border-brand-500 focus:outline-none"
        />
      ),
    },
  ];
}

/**
 * "Account credit…" for a client: one write-off spread over the practice's open invoices,
 * oldest due first or onto the invoices staff choose. The reason is required and stored
 * encrypted; no email goes out. Committed with a two-step ConfirmButton.
 */
export function AccountCreditModal({ clientUserId, clientName, onClose, onRecorded }) {
  const { addToast } = useToast();
  const [invoices, setInvoices] = useState(null);
  const [amountStr, setAmountStr] = useState("");
  const [reason, setReason] = useState("");
  const [choose, setChoose] = useState(false);
  const [chosen, setChosen] = useState({}); // invoiceId → typed dollars
  const [err, setErr] = useState(null);
  const inFlight = useRef(false);

  const close = () => { if (!inFlight.current) onClose(); };
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

  // The server's own list of what a credit can be applied to, oldest due first.
  useEffect(() => {
    api.get(`/admin/clients/${clientUserId}/invoices`, { params: { open: "true" } })
      .then((res) => setInvoices(res.data.data || []))
      .catch((e) => { setInvoices([]); setErr(errorText(e)); });
  }, [clientUserId]);

  const table = useDataTable({ mode: "client", rows: invoices ?? [], getRowId, initialPageSize: 50, loading: invoices === null });

  const amountCents = typedCents(amountStr);
  const openCents = (invoices || []).reduce((s, i) => s + i.balanceCents, 0);
  const allocations = Object.entries(chosen)
    .map(([invoiceId, str]) => ({ invoiceId, amountCents: typedCents(str) }))
    .filter((a) => a.amountCents > 0);
  const chosenCents = allocations.reduce((s, a) => s + a.amountCents, 0);
  const valid = amountCents > 0 && amountCents <= openCents && reason.trim().length > 0 && (!choose || chosenCents === amountCents);

  const submit = async () => {
    if (!valid || inFlight.current) return;
    inFlight.current = true;
    setErr(null);
    try {
      await api.post(`/admin/clients/${clientUserId}/account-credit`, {
        amountCents, reason: reason.trim(), ...(choose ? { allocations } : {}),
      });
      addToast({ message: `Credited ${formatCents(amountCents)} to ${clientName || "this client"}.`, type: "success" });
      onRecorded?.();
      onClose();
    } catch (e) {
      setErr(errorText(e));
      addToast({ message: errorText(e), type: "error" });
    } finally {
      inFlight.current = false;
    }
  };

  const columns = pickerColumns(chosen, (id, val) => setChosen((prev) => ({ ...prev, [id]: val })));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={(e) => { e.stopPropagation(); close(); }}>
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={close} className="absolute right-4 top-4 text-navy/30 hover:text-navy" aria-label="Close"><X size={18} /></button>
        <h3 className="font-heading text-lg font-bold text-navy">Account credit</h3>
        <p className="mt-1 text-xs text-navy/50">
          {clientName ? `${clientName} · ` : ""}practice open balance {invoices ? formatCents(openCents) : "…"}. No card is charged and no email is sent.
        </p>

        {invoices === null ? (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-navy/30" /></div>
        ) : invoices.length === 0 ? (
          <p className="py-6 text-sm text-navy/50">No open invoices to credit.</p>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-xs text-navy/60">Amount
              <input className={`${INPUT} mt-1`} inputMode="decimal" placeholder="0.00" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
            </label>
            <label className="block text-xs text-navy/60">Reason (stored encrypted)
              <textarea className={`${INPUT} mt-1`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm text-navy/70">
              <input type="checkbox" className="accent-brand-600" checked={choose} onChange={(e) => setChoose(e.target.checked)} />
              Choose invoices (otherwise oldest due first)
            </label>
            {choose && (
              <div className="rounded-xl border border-surface-300/50 p-1">
                <DataTable table={table} columns={columns} selectable={false} searchable={false} exportable={false} dense itemLabel="invoices" emptyText="No open invoices." />
                <p className={`px-2 pb-2 text-xs ${chosenCents === amountCents ? "text-navy/50" : "text-amber-700"}`}>
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
          <ConfirmButton
            onConfirm={submit}
            disabled={!valid}
            confirmLabel={`Click again: credit ${formatCents(amountCents)}`}
            className="rounded-full bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-brand-600"
          >
            Credit {amountCents ? formatCents(amountCents) : "account"}
          </ConfirmButton>
        </div>
      </div>
    </div>
  );
}
