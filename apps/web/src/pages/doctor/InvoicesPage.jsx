import { useEffect, useState, useCallback } from "react";
import { CreditCard, CheckSquare, Square, Loader2, CheckCircle2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { PaymentModal } from "../../components/doctor/PaymentModal.jsx";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../hooks/usePagination.js";

export function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [showPayment, setShowPayment] = useState(false);
  const { addToast } = useToast();

  const fetchInvoices = useCallback(async () => {
    try {
      const { data } = await api.get("/invoices");
      setInvoices(data.data || []);
    } catch (err) {
      addToast({ message: "Failed to load invoices", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  // Invoices that can still be paid through the portal (not fully paid).
  const payableInvoices = invoices.filter((inv) => !inv.portalPaid);

  const toggleSelect = (id, isPaid) => {
    if (isPaid) return; // fully-paid invoices cannot be selected
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size > 0 && selected.size === payableInvoices.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(payableInvoices.map((inv) => inv.id || inv.invoiceId)));
    }
  };

  const selectedInvoices = invoices.filter((inv) => selected.has(inv.id || inv.invoiceId));
  // Use portalBalance so partial prior payments reduce what's shown as owed.
  const selectedTotal = selectedInvoices.reduce(
    (sum, inv) => sum + (inv.portalBalance != null ? inv.portalBalance : (parseFloat(inv.total) || 0)),
    0
  );

  const pagination = usePagination(invoices);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-gray-500">View and pay your Diamond Labs invoices</p>
        </div>
        {selected.size > 0 && (
          <Button onClick={() => setShowPayment(true)}>
            <CreditCard className="mr-2 h-4 w-4" />
            Pay Selected ({selected.size}) — ${selectedTotal.toFixed(2)}
          </Button>
        )}
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">No invoices found.</p>
        </div>
      ) : (
        <>
          <Pagination {...pagination} itemLabel="invoices" className="mb-4" />
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3 w-10">
                    <button onClick={toggleAll} className="text-gray-400 hover:text-gray-600">
                      {selected.size > 0 && selected.size === payableInvoices.length
                        ? <CheckSquare className="h-4 w-4" />
                        : <Square className="h-4 w-4" />}
                    </button>
                  </th>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Paid / Balance</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagination.paged.map((inv) => {
                  const id = inv.id || inv.invoiceId;
                  const isSelected = selected.has(id);
                  const isPaid = !!inv.portalPaid;
                  const hasPartialPayment = !isPaid && (inv.portalPaidAmount || 0) > 0;
                  return (
                    <tr
                      key={id}
                      className={`transition-colors ${
                        isPaid
                          ? "cursor-default bg-gray-50/50"
                          : isSelected
                            ? "cursor-pointer bg-brand-50"
                            : "cursor-pointer hover:bg-gray-50"
                      }`}
                      onClick={() => toggleSelect(id, isPaid)}
                    >
                      <td className="px-4 py-3">
                        {isPaid
                          ? <Square className="h-4 w-4 text-gray-200" />
                          : isSelected
                            ? <CheckSquare className="h-4 w-4 text-brand-600" />
                            : <Square className="h-4 w-4 text-gray-300" />}
                      </td>
                      <td className="px-4 py-3 font-medium">{inv.invoiceNumber || id}</td>
                      <td className="px-4 py-3 text-gray-500">{inv.due ? new Date(inv.due).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3 font-medium">${parseFloat(inv.total || 0).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        {isPaid ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Paid via portal
                          </span>
                        ) : hasPartialPayment ? (
                          <div>
                            <span className="font-medium">${(inv.portalBalance || 0).toFixed(2)}</span>
                            <p className="mt-0.5 text-xs text-green-600">
                              Paid via portal: ${(inv.portalPaidAmount || 0).toFixed(2)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {inv.status || "—"}
                        </span>
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
          invoices={selectedInvoices}
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
