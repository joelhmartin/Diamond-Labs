import { useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
  AlertCircle,
  Loader2,
  Mail,
  Phone,
  User,
  Building2,
  MapPin,
  Banknote,
  Undo2,
  X,
} from "lucide-react";
import api from "../../config/api.js";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { usePagination } from "../../hooks/usePagination.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { RefundPaymentModal } from "../../components/admin/RefundPaymentModal.jsx";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

// Seazona's workflow statuses we've seen. Unknown values fall back to gray.
const STATUS_COLORS = {
  Shipped:        "bg-emerald-500/10 text-emerald-700",
  Hold:           "bg-amber-500/10 text-amber-700",
  "In Production":"bg-blue-500/10 text-blue-700",
  "In Prod":      "bg-blue-500/10 text-blue-700",
  Pending:        "bg-navy/10 text-navy/60",
  Cancelled:      "bg-red-500/10 text-red-600",
  Void:           "bg-red-500/10 text-red-600",
};

function statusColor(s) {
  return STATUS_COLORS[s] || "bg-gray-200 text-gray-700";
}

function formatUSD(n) {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function clientLabel(inv, client) {
  // Prefer the richer client record when we have it; fall back to inline fields.
  if (client?.company && client?.fullName) {
    return client.fullName !== client.company
      ? `${client.fullName} · ${client.company}`
      : client.company;
  }
  return client?.company || client?.fullName || inv.clientName || `Client #${inv.clientId}`;
}

function Stat({ label, value, tint = "text-navy" }) {
  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 p-4">
      <div className={`font-heading font-bold text-2xl tracking-tight ${tint}`}>
        {value}
      </div>
      <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest mt-0.5">
        {label}
      </div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th
      className={`text-left px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal ${className}`}
    >
      {children}
    </th>
  );
}

// Remaining balance we can record against. In the admin list normalizeInvoice
// runs without per-user ledger context, so portalBalance === total here; the
// backend re-caps against the real ledger and 422s if we exceed it.
function remainingOf(inv) {
  return Number(inv.portalBalance != null ? inv.portalBalance : inv.total || 0);
}

// Modal for recording a payment that staff already took directly in Seazona,
// reflecting it in the portal's invoice_payments ledger so the doctor's balance
// is accurate. No Seazona write is made (the payment already exists there).
// Exported so DoctorPaymentDrawer.jsx (admin per-doctor payment parity panel)
// can reuse the identical flow instead of duplicating it.
export function OfflinePaymentModal({ invoice, onClose, onRecorded }) {
  const remaining = remainingOf(invoice);
  const [amountStr, setAmountStr] = useState(String(remaining.toFixed(2)));
  const [recordInSeazona, setRecordInSeazona] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  const { addToast } = useToast();

  const amount = parseFloat(amountStr);
  const valid = !Number.isNaN(amount) && amount > 0 && amount <= remaining + 0.005;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setErr(null);
    try {
      await api.post(`/admin/invoices/${invoice.id}/offline-payment`, {
        amount: Number(amount.toFixed(2)),
        invoiceNumber: invoice.invoiceNumber,
        seazonaClientId: invoice.clientId,
        recordInSeazona,
      });
      addToast({
        message: `Recorded ${formatUSD(amount)} offline payment on #${invoice.invoiceNumber}.`,
        type: "success",
      });
      onRecorded?.();
      onClose();
    } catch (e) {
      setErr(
        e.response?.data?.error?.message ||
          e.message ||
          "Failed to record the offline payment."
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

        <h3 className="font-heading font-bold text-lg text-navy">
          Record offline payment
        </h3>
        <p className="mt-1 text-xs text-navy/50">
          Reflects a payment already received (check, cash, or entered in
          Seazona) in the portal balance. No card is charged.
        </p>

        <div className="mt-4 rounded-xl bg-surface-50 border border-surface-300/50 p-3 text-xs text-navy/60 space-y-0.5">
          <div className="flex justify-between">
            <span>Invoice</span>
            <span className="font-mono text-navy/80">#{invoice.invoiceNumber}</span>
          </div>
          <div className="flex justify-between">
            <span>Patient</span>
            <span className="text-navy/80">{invoice.patient || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>Remaining balance</span>
            <span className="tabular-nums font-semibold text-navy">
              {formatUSD(remaining)}
            </span>
          </div>
        </div>

        <label className="mt-4 block text-[10px] font-mono uppercase tracking-widest text-navy/40">
          Amount
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-navy/40">$</span>
          <input
            type="number"
            min="0"
            max={remaining}
            step="0.01"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={submitting}
            className={`${INPUT} flex-1`}
            autoFocus
          />
        </div>

        <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-surface-300/50 bg-surface-50 p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={recordInSeazona}
            onChange={(e) => setRecordInSeazona(e.target.checked)}
            disabled={submitting}
            className="mt-0.5 h-3.5 w-3.5 rounded border-surface-300 text-brand-500 focus:ring-brand-500/30"
          />
          <span className="text-xs text-navy/70">
            <span className="font-semibold text-navy">
              Also record this payment in Seazona
            </span>
            <br />
            Leave unchecked if staff already entered it in Seazona — checking
            it would double-credit the account.
          </span>
        </label>

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
            disabled={!valid || submitting}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-all disabled:opacity-50"
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            Record payment
          </button>
        </div>
      </div>
    </div>
  );
}


function InvoiceRow({ invoice, onRecorded }) {
  const color = statusColor(invoice.status);
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <tr className="border-t border-surface-300/30 hover:bg-surface-50/50">
      <td className="px-4 py-2.5 font-mono text-xs text-navy/60">
        {invoice.invoiceNumber}
      </td>
      <td className="px-4 py-2.5 text-sm text-navy/70">
        {invoice.patient || "—"}
      </td>
      <td className="px-4 py-2.5 text-xs text-navy/60">
        {formatDate(invoice.due)}
      </td>
      <td className="px-4 py-2.5 text-sm text-right tabular-nums">
        {formatUSD(invoice.sales)}
      </td>
      <td className="px-4 py-2.5 text-sm text-right tabular-nums text-navy/50">
        {formatUSD(invoice.tax)}
      </td>
      <td className="px-4 py-2.5 text-sm text-right tabular-nums font-semibold text-navy">
        {formatUSD(invoice.total)}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${color}`}
        >
          {invoice.status || "—"}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          title="Record offline payment (entered in Seazona)"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold text-brand-600 hover:bg-brand-500/10 transition-all"
        >
          <Banknote size={13} />
          Record payment
        </button>
        {modalOpen && (
          <OfflinePaymentModal
            invoice={invoice}
            onClose={() => setModalOpen(false)}
            onRecorded={onRecorded}
          />
        )}
      </td>
    </tr>
  );
}

function ClientGroup({ clientId, client, invoices, onRecorded }) {
  const [open, setOpen] = useState(false);
  const total = invoices.reduce((s, i) => s + i.total, 0);
  const label = clientLabel(invoices[0], client);

  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-4 p-4 md:p-5 text-left hover:bg-surface-50 transition-colors"
      >
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center text-brand-500">
          {client?.company ? <Building2 size={18} /> : <User size={18} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="font-heading font-semibold text-sm text-navy truncate">
              {label}
            </div>
            {client?.accountNumber && (
              <span className="font-mono text-[10px] text-navy/40">
                #{client.accountNumber}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-[11px] text-navy/50 truncate flex-wrap">
            {client?.email && (
              <span className="flex items-center gap-1 truncate">
                <Mail size={10} />
                {client.email}
              </span>
            )}
            {client?.phone1 && (
              <span className="flex items-center gap-1">
                <Phone size={10} />
                {client.phone1}
              </span>
            )}
            {client?.region && (
              <span className="flex items-center gap-1">
                <MapPin size={10} />
                {client.city ? `${client.city}, ` : ""}
                {client.region}
              </span>
            )}
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest">
              Invoices
            </div>
            <div className="font-mono text-sm text-navy tabular-nums">
              {invoices.length}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest">
              Total billed
            </div>
            <div className="font-heading font-bold text-sm text-navy tabular-nums">
              {formatUSD(total)}
            </div>
          </div>
        </div>

        {open ? (
          <ChevronDown size={16} className="text-navy/40 flex-shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-navy/40 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-surface-300/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-100">
                <Th>Invoice #</Th>
                <Th>Patient</Th>
                <Th>Due</Th>
                <Th className="text-right">Sales</Th>
                <Th className="text-right">Tax</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <InvoiceRow key={inv.id} invoice={inv} onRecorded={onRecorded} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AdminInvoicesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ invoices: [], clients: {}, summary: null });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  // Set when the call returned but Seazona was unreachable/degraded (so the list
  // may be empty or incomplete) — separate from `error`, which is a failed request.
  const [seazonaDown, setSeazonaDown] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);

  const load = async () => {
    try {
      setRefreshing(true);
      const res = await api.get("/admin/invoices");
      setData(res.data.data);
      setSeazonaDown(Boolean(res.data.meta?.seazonaUnavailable));
      setError(null);
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
          err.message ||
          "Failed to load invoices. Check the Seazona connection."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = data.invoices.filter((inv) => {
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (!q) return true;
      const client = data.clients[inv.clientId];
      const blob = [
        inv.clientName,
        inv.clientCompany,
        inv.patient,
        String(inv.invoiceNumber || ""),
        String(inv.clientId || ""),
        client?.email,
        client?.phone1,
        client?.accountNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });

    const byClient = new Map();
    for (const inv of filtered) {
      const key = inv.clientId || "unassigned";
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key).push(inv);
    }

    return [...byClient.entries()]
      .map(([clientId, invs]) => ({
        clientId,
        client: data.clients[clientId],
        invoices: invs.sort(
          (a, b) =>
            new Date(b.lastModified || b.due || 0) -
            new Date(a.lastModified || a.due || 0)
        ),
      }))
      .sort((a, b) => {
        const at = a.invoices.reduce((s, i) => s + i.total, 0);
        const bt = b.invoices.reduce((s, i) => s + i.total, 0);
        return bt - at;
      });
  }, [data, query, statusFilter]);

  const pagination = usePagination(groups);

  const statusChips = useMemo(() => {
    const entries = Object.entries(data.summary?.statuses || {});
    return entries.sort((a, b) => b[1] - a[1]);
  }, [data.summary]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-heading font-bold text-3xl text-navy tracking-tight">
            Invoices
          </h1>
          <p className="mt-1 text-sm text-navy/50">
            All invoices from Seazona, grouped by client.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRefundOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all"
          >
            <Undo2 size={12} />
            Refund a payment
          </button>
          <button
            type="button"
            onClick={load}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {refundOpen && <RefundPaymentModal onClose={() => setRefundOpen(false)} />}

      {seazonaDown && !error && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-amber-500" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">Seazona billing API is unreachable.</p>
            <p className="mt-0.5 text-amber-700">
              The invoice list below may be empty or incomplete — this is a connection issue with Seazona,
              not a sign that these clients have no invoices. Doctor portals are showing the same outage banner.
            </p>
          </div>
        </div>
      )}

      {data.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Invoices" value={data.summary.count.toLocaleString()} />
          <Stat label="Clients" value={data.summary.clientCount.toLocaleString()} />
          <Stat label="Total billed" value={formatUSD(data.summary.totalAmount)} />
          <Stat
            label="Statuses"
            value={Object.keys(data.summary.statuses || {}).length}
          />
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-navy/30"
          />
          <input
            type="text"
            className={`${INPUT} pl-10`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by client, patient, invoice #, email, phone, or account #…"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all ${
              statusFilter === "all"
                ? "bg-navy text-white"
                : "bg-surface-100 text-navy/60 hover:text-navy"
            }`}
          >
            All ({data.summary?.count ?? 0})
          </button>
          {statusChips.map(([status, count]) => {
            const color = statusColor(status);
            const active = statusFilter === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all ${
                  active ? "bg-navy text-white" : `${color} hover:bg-navy/10`
                }`}
              >
                {status} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex items-center justify-center text-navy/40">
          <Loader2 size={18} className="animate-spin mr-2" />
          Loading invoices…
        </div>
      ) : error ? (
        <div className="py-20 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500/40" />
          <p className="text-sm text-navy/60 max-w-md mx-auto">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-4 px-4 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600"
          >
            Retry
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="py-20 text-center">
          <FileText size={32} className="mx-auto mb-3 text-navy/20" />
          <p className="text-sm text-navy/40">
            {data.invoices.length === 0
              ? seazonaDown
                ? "Invoices are temporarily unavailable (Seazona unreachable)."
                : "No invoices returned by Seazona."
              : "No invoices match your filters."}
          </p>
        </div>
      ) : (
        <>
          <Pagination
            {...pagination}
            itemLabel="clients"
            className="mb-4"
          />
          <div className="space-y-3">
            {pagination.paged.map((g) => (
              <ClientGroup
                key={g.clientId}
                clientId={g.clientId}
                client={g.client}
                invoices={g.invoices}
                onRecorded={load}
              />
            ))}
          </div>
          <Pagination
            {...pagination}
            itemLabel="clients"
            className="mt-6"
          />
        </>
      )}

      <p className="mt-6 text-[11px] font-mono text-navy/30 text-center">
        Paid/unpaid status isn&apos;t surfaced by the Seazona invoice API —
        shown status is the workflow state (Shipped, Hold, etc.).
      </p>
    </div>
  );
}
