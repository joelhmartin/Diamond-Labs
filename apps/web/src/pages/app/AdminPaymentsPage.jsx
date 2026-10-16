import { useCallback, useEffect, useRef, useState } from "react";
import { Search, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import api from "../../config/api.js";
import { PaymentRow } from "../../components/admin/PaymentRow.jsx";
import { RefundPaymentModal } from "../../components/admin/RefundPaymentModal.jsx";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

/** The transaction / doctor / invoice search box. */
function SearchBar({ q, onChange, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="mt-6 flex items-center gap-2">
      <div className="relative flex-1 max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
        <input
          type="text"
          value={q}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT} pl-9`}
          placeholder="Search by transaction id, doctor, client, or invoice #"
        />
      </div>
      <button
        type="submit"
        className="px-4 py-2.5 rounded-full text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-all"
      >
        Search
      </button>
    </form>
  );
}

export function AdminPaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [refundPayment, setRefundPayment] = useState(null);
  const [expandedTxn, setExpandedTxn] = useState(null);   // transactionId with history open
  const [auditByTxn, setAuditByTxn] = useState({});        // { [txn]: { loading, entries, failed } }
  // Bumped on every list reload; an in-flight audit fetch whose generation is
  // stale on return is discarded so it can't repopulate the just-cleared cache.
  const loadGen = useRef(0);

  const toggleHistory = async (txn) => {
    if (expandedTxn === txn) {
      setExpandedTxn(null);
      return;
    }
    setExpandedTxn(txn);
    if (auditByTxn[txn]) return; // cached
    const gen = loadGen.current;
    setAuditByTxn((prev) => ({ ...prev, [txn]: { loading: true, entries: [], failed: false } }));
    try {
      const { data } = await api.get("/admin/payments/audit", { params: { transactionId: txn } });
      if (gen !== loadGen.current) return; // a reload happened mid-flight — drop stale result
      setAuditByTxn((prev) => ({ ...prev, [txn]: { loading: false, entries: data.data?.entries || [], failed: false } }));
    } catch {
      if (gen !== loadGen.current) return;
      setAuditByTxn((prev) => ({ ...prev, [txn]: { loading: false, entries: [], failed: true } }));
    }
  };

  const load = useCallback(async (query) => {
    setRefreshing(true);
    // Invalidate cached audit history + collapse open rows so a reload (incl.
    // after a refund via onDone, or a manual Refresh) re-fetches fresh trails
    // rather than serving a stale cache that misses the just-recorded action.
    // Bump the generation so any in-flight audit fetch is discarded on return.
    loadGen.current += 1;
    setAuditByTxn({});
    setExpandedTxn(null);
    try {
      const { data } = await api.get("/admin/payments", {
        params: query ? { q: query } : undefined,
      });
      setPayments(data.data?.payments || []);
      setTruncated(Boolean(data.data?.truncated));
      setTotal(data.data?.total || 0);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onSearch = (e) => {
    e.preventDefault();
    load(q.trim());
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading font-bold text-3xl text-navy tracking-tight">Payments</h1>
          <p className="mt-1 text-sm text-navy/50">
            Every portal charge, with refunds/voids netted out. Reverse a payment from its row.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(q.trim())}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <SearchBar q={q} onChange={setQ} onSubmit={onSearch} />

      {truncated && (
        <p className="mt-3 text-xs text-amber-700">
          Showing the first {payments.length} of {total} payments — narrow the search to see the rest.
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl border border-surface-300/40 bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-navy/40">
            <Loader2 size={16} className="animate-spin" /> Loading payments…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 py-16 text-red-600">
            <AlertCircle size={16} /> Failed to load payments.
          </div>
        ) : payments.length === 0 ? (
          <div className="py-16 text-center text-sm text-navy/40">No payments found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-mono uppercase tracking-widest text-navy/40">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Doctor</th>
                <th className="px-4 py-3 font-medium">Transaction</th>
                <th className="px-4 py-3 font-medium">Invoices</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium text-right">Gross</th>
                <th className="px-4 py-3 font-medium text-right">Refunded</th>
                <th className="px-4 py-3 font-medium text-right">Net</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <PaymentRow
                  key={p.transactionId}
                  payment={p}
                  open={expandedTxn === p.transactionId}
                  audit={auditByTxn[p.transactionId]}
                  onToggleHistory={toggleHistory}
                  onRefund={setRefundPayment}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {refundPayment && (
        <RefundPaymentModal
          presetTransactionId={refundPayment.transactionId}
          payment={refundPayment}
          onClose={() => setRefundPayment(null)}
          onDone={() => load(q.trim())}
        />
      )}
    </div>
  );
}
