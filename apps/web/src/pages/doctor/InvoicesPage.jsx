import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { CreditCard, CheckSquare, Square, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { PaymentModal } from "../../components/doctor/PaymentModal.jsx";
import { StatementDownload } from "../../components/billing/StatementDownload.jsx";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../hooks/usePagination.js";
import { formatCents } from "../../lib/money.js";
import { STATUS_TONES, statusOf, isPayable, labToday, dateText, instantText } from "../../lib/invoices.js";
import { doctorInvoicePath } from "../../config/routes.js";

/** The doctor's invoices (issued and void; drafts are never shown), with pay-selected and statements. */
export function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [showPayment, setShowPayment] = useState(false);
  const { addToast } = useToast();

  const fetchInvoices = useCallback(async () => {
    try {
      const { data } = await api.get("/invoices");
      setInvoices(data.data || []);
      setLoadFailed(false);
    } catch {
      // Don't leave pre-refresh balances on screen (and payable) after a failed refresh.
      setInvoices([]);
      setSelected(new Set());
      setLoadFailed(true);
      addToast({ message: "Failed to load invoices", type: "error" });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const today = labToday();
  const payable = invoices.filter(isPayable);
  const toggle = (inv) => {
    if (!isPayable(inv)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(inv.id)) next.delete(inv.id);
      else next.add(inv.id);
      return next;
    });
  };
  const allSelected = selected.size > 0 && selected.size === payable.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(payable.map((i) => i.id)));
  const selectedInvoices = invoices.filter((inv) => selected.has(inv.id));
  const selectedTotal = selectedInvoices.reduce((s, inv) => s + inv.balanceCents, 0);
  const pagination = usePagination(invoices);

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-gray-500">Your Diamond Labs invoices. Open one for its lines and PDF.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatementDownload path="/invoices/statement.pdf" />
          {selected.size > 0 && (
            <Button onClick={() => setShowPayment(true)}>
              <CreditCard className="mr-2 h-4 w-4" />
              Pay selected ({selected.size}) — {formatCents(selectedTotal)}
            </Button>
          )}
        </div>
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">{loadFailed ? "Couldn't load your invoices. Please refresh to try again." : "No invoices yet."}</p>
        </div>
      ) : (
        <>
          <Pagination {...pagination} itemLabel="invoices" className="mb-4" />
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="w-10 px-4 py-3">
                    <button onClick={toggleAll} disabled={payable.length === 0} aria-label="Select all payable invoices"
                      className="text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40">
                      {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                  </th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Lab order</th>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Issued</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagination.paged.map((inv) => {
                  const canPay = isPayable(inv);
                  const isSelected = selected.has(inv.id);
                  const status = statusOf(inv, today);
                  return (
                    <tr key={inv.id} onClick={() => toggle(inv)}
                      className={canPay ? (isSelected ? "cursor-pointer bg-brand-50" : "cursor-pointer hover:bg-gray-50") : "bg-gray-50/50"}>
                      <td className="px-4 py-3">
                        <button type="button" onClick={(e) => { e.stopPropagation(); toggle(inv); }} disabled={!canPay}
                          aria-pressed={canPay && isSelected} aria-label={`Select invoice ${inv.invoiceNumber} for payment`}
                          className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed">
                          {canPay && isSelected ? <CheckSquare className="h-4 w-4 text-brand-600" /> : <Square className={`h-4 w-4 ${canPay ? "text-gray-300" : "text-gray-200"}`} />}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <Link to={doctorInvoicePath(inv.id)} onClick={(e) => e.stopPropagation()} className="text-brand-700 hover:underline">
                          #{inv.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{inv.labOrderNumber ? `#${inv.labOrderNumber}` : "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{inv.patientInitials ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{inv.issuedAt ? instantText(inv.issuedAt) : "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{dateText(inv.dueDate)}</td>
                      <td className="px-4 py-3 text-right">{formatCents(inv.totalCents)}</td>
                      <td className="px-4 py-3 text-right font-medium">{inv.status === "void" ? "—" : formatCents(Math.max(0, inv.balanceCents))}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[status]}`}>{status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination {...pagination} itemLabel="invoices" className="mt-6" />
        </>
      )}

      {showPayment && (
        <PaymentModal
          invoices={selectedInvoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, balanceCents: i.balanceCents, dueDate: i.dueDate }))}
          onClose={() => setShowPayment(false)}
          onSuccess={() => {
            setShowPayment(false);
            setSelected(new Set());
            fetchInvoices();
            addToast({ message: "Payment successful!", type: "success" });
          }}
        />
      )}
    </div>
  );
}
