import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Search, RefreshCw, Undo2, Loader2, AlertCircle, History, ChevronDown } from "lucide-react";
import api from "../../config/api.js";
import { RefundPaymentModal } from "../../components/admin/RefundPaymentModal.jsx";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

function formatUSD(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const AUDIT_ACTION_LABEL = {
  "payment.charge": "Charged",
  "payment.refund": "Reversed",
  "payment.offline_recorded": "Offline payment recorded",
  "payment.card.set_default": "Set default card",
  "payment.card.delete": "Deleted card",
};

function auditLabel(e) {
  if (e.action === "payment.refund") {
    return e.metadata?.kind === "void" ? "Voided" : "Refunded";
  }
  return AUDIT_ACTION_LABEL[e.action] || e.action;
}

const STATUS_PILL = {
  paid: "bg-emerald-500/10 text-emerald-700",
  partially_refunded: "bg-amber-500/10 text-amber-700",
  refunded: "bg-gray-200 text-gray-600",
  refund_pending: "bg-blue-500/10 text-blue-700",
};
const STATUS_LABEL = {
  paid: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  refund_pending: "Refund pending",
};

// How the payment was initiated. AutoPay is the one nobody clicked, so the lab
// needs to see it distinctly when reconciling — otherwise a scheduled charge is
// indistinguishable from one a doctor or an admin made by hand. Rows written
// before the `source` column existed carry null; render nothing rather than guess.
const SOURCE_LABEL = {
  autopay: "AutoPay",
  doctor_card: "Doctor — card",
  doctor_hosted: "Doctor — card",
  admin_card: "Admin — card",
  admin_offline: "Offline",
  refund: "Refund",
};

function StatusPill({ status }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
        STATUS_PILL[status] || "bg-gray-200 text-gray-700"
      }`}
    >
      {STATUS_LABEL[status] || status}
    </span>
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

      <form onSubmit={onSearch} className="mt-6 flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
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
              {payments.map((p) => {
                const audit = auditByTxn[p.transactionId];
                const open = expandedTxn === p.transactionId;
                return (
                  <Fragment key={p.transactionId}>
                    <tr className="border-t border-surface-300/30 hover:bg-surface-50/50">
                      <td className="px-4 py-3 text-navy/70 whitespace-nowrap">{formatDate(p.createdAt)}</td>
                      <td className="px-4 py-3 text-navy/80">
                        <div className="font-medium">{p.doctorName || "—"}</div>
                        {p.doctorEmail && <div className="text-xs text-navy/40">{p.doctorEmail}</div>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-navy/60">{p.transactionId}</td>
                      <td className="px-4 py-3 text-navy/70 text-xs">
                        {p.invoices.map((inv) => inv.invoiceNumber || inv.seazonaInvoiceId).join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {p.source === "autopay" ? (
                          <span className="inline-block rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                            AutoPay
                          </span>
                        ) : (
                          <span className="text-xs text-navy/50">{SOURCE_LABEL[p.source] || "—"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-navy/80 whitespace-nowrap">{formatUSD(p.gross)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-navy/60">
                        {p.refunded > 0 ? `-${formatUSD(p.refunded)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-navy whitespace-nowrap">{formatUSD(p.net)}</td>
                      <td className="px-4 py-3"><StatusPill status={p.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => toggleHistory(p.transactionId)}
                            aria-expanded={open}
                            title={open ? "Hide payment history" : "Payment history"}
                            aria-label={open ? "Hide payment action history" : "Show payment action history"}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-all ${
                              open ? "bg-surface-100 text-navy" : "text-navy/50 hover:text-navy hover:bg-surface-100"
                            }`}
                          >
                            <History size={12} />
                            <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                          </button>
                          {p.refundable ? (
                            <button
                              type="button"
                              onClick={() => setRefundPayment(p)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all"
                            >
                              <Undo2 size={12} /> Refund
                            </button>
                          ) : p.offline ? (
                            <span className="text-xs text-navy/40">Offline</span>
                          ) : (
                            <span className="text-xs text-navy/30">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-surface-50/40">
                        <td colSpan={10} className="px-4 py-3">
                          {!audit || audit.loading ? (
                            <div className="flex items-center gap-2 text-xs text-navy/40">
                              <Loader2 size={12} className="animate-spin" /> Loading history…
                            </div>
                          ) : audit.failed ? (
                            <div className="text-xs text-red-600">Failed to load history.</div>
                          ) : audit.entries.length === 0 ? (
                            <div className="text-xs text-navy/40">No recorded actions for this transaction.</div>
                          ) : (
                            <ol className="space-y-1.5">
                              {audit.entries.map((e) => (
                                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                                  <span className="font-mono text-navy/40 whitespace-nowrap">{formatDateTime(e.createdAt)}</span>
                                  <span className="font-semibold text-navy">{auditLabel(e)}</span>
                                  {e.metadata?.amount != null && (
                                    <span className="text-navy/70">{formatUSD(e.metadata.amount)}</span>
                                  )}
                                  <span className="text-navy/50">
                                    by {e.actorName || e.actorEmail || (e.actorId ? "user " + e.actorId.slice(0, 8) : "system")}
                                  </span>
                                  {e.metadata?.ledgerWriteFailed && (
                                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                      ledger needs reconcile
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ol>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
