import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, Receipt } from "lucide-react";
import api from "../../config/api.js";

function formatUSD(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const STATUS_PILL = {
  paid: "bg-brand-50 text-brand-700",
  partially_refunded: "bg-amber-50 text-amber-700",
  refunded: "bg-gray-100 text-gray-600",
  refund_pending: "bg-blue-50 text-blue-700",
};
const STATUS_LABEL = {
  paid: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  refund_pending: "Refund pending",
};

// How the payment was made. AutoPay is the one a doctor did not personally
// initiate, so it is the one worth naming — seeing an unexplained charge and
// not knowing it was their own scheduled payment is how support tickets start.
// Legacy rows predate the column and carry null; show nothing rather than guess.
const SOURCE_LABEL = {
  autopay: "AutoPay",
  doctor_card: "Card",
  doctor_hosted: "Card",
  admin_card: "By lab",
  admin_offline: "Recorded by lab",
  refund: "Refund",
};

export function PaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/payments/history");
        setPayments(data.data?.payments || []);
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Payment history</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every payment you've made through the portal, including any refunds.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : failed ? (
          <div className="flex items-center justify-center gap-2 py-16 text-red-600">
            <AlertTriangle size={16} /> Couldn't load your payment history.
          </div>
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-gray-400">
            <Receipt size={24} />
            <span className="text-sm">No payments yet.</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Invoices</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium text-right">Refunded</th>
                <th className="px-4 py-3 font-medium text-right">Net</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.transactionId} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(p.createdAt)}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {p.invoices.map((inv) => inv.invoiceNumber || inv.seazonaInvoiceId).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {p.source === "autopay" ? (
                      <span className="inline-block rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                        AutoPay
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">{SOURCE_LABEL[p.source] || "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-800 whitespace-nowrap">{formatUSD(p.gross)}</td>
                  <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                    {p.refunded > 0 ? `-${formatUSD(p.refunded)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">{formatUSD(p.net)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                        STATUS_PILL[p.status] || "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {STATUS_LABEL[p.status] || p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
