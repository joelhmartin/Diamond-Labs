import { useEffect, useState, useCallback } from "react";
import { CreditCard, CheckSquare, Square, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { PaymentModal } from "../../components/doctor/PaymentModal.jsx";

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

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === invoices.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(invoices.map((inv) => inv.id || inv.invoiceId)));
    }
  };

  const selectedInvoices = invoices.filter((inv) => selected.has(inv.id || inv.invoiceId));
  const selectedTotal = selectedInvoices.reduce((sum, inv) => sum + (parseFloat(inv.amount) || 0), 0);

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
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3 w-10">
                  <button onClick={toggleAll} className="text-gray-400 hover:text-gray-600">
                    {selected.size === invoices.length ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </button>
                </th>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => {
                const id = inv.id || inv.invoiceId;
                const isSelected = selected.has(id);
                return (
                  <tr
                    key={id}
                    className={`cursor-pointer transition-colors ${isSelected ? "bg-brand-50" : "hover:bg-gray-50"}`}
                    onClick={() => toggleSelect(id)}
                  >
                    <td className="px-4 py-3">
                      {isSelected ? <CheckSquare className="h-4 w-4 text-brand-600" /> : <Square className="h-4 w-4 text-gray-300" />}
                    </td>
                    <td className="px-4 py-3 font-medium">{inv.invoiceNumber || id}</td>
                    <td className="px-4 py-3 text-gray-500">{inv.date || inv.createdDate || "—"}</td>
                    <td className="px-4 py-3 font-medium">${parseFloat(inv.amount || 0).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        inv.status === "paid" ? "bg-green-100 text-green-700"
                        : inv.status === "overdue" ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-600"
                      }`}>
                        {inv.status || "open"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showPayment && (
        <PaymentModal
          invoices={selectedInvoices}
          total={selectedTotal}
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
