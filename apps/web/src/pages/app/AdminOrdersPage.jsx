import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  Package,
  FileText,
} from "lucide-react";
import api from "../../config/api.js";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

const STATUS_COLORS = {
  "In Prod":        "bg-blue-500/10 text-blue-700",
  "In Production":  "bg-blue-500/10 text-blue-700",
  "Shipped":        "bg-emerald-500/10 text-emerald-700",
  "Hold":           "bg-amber-500/10 text-amber-700",
  "Cancelled":      "bg-red-500/10 text-red-600",
};

function statusColor(s) {
  return STATUS_COLORS[s] || "bg-gray-200 text-gray-700";
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Stat({ label, value, tint = "text-navy" }) {
  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 p-4">
      <div className={`font-heading font-bold text-2xl tracking-tight ${tint}`}>{value}</div>
      <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest mt-0.5">{label}</div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th className={`text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal ${className}`}>
      {children}
    </th>
  );
}

export function AdminOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ orders: [], clients: {}, summary: null });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = async () => {
    try {
      const res = await api.get("/admin/orders");
      setData(res.data.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || "Failed to load orders.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (!q) return true;
      const blob = [
        o.clientName, o.company, o.patient,
        String(o.invoiceNumber || ""), String(o.clientId || ""),
        o.department, o.assignedTo,
      ].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [data.orders, query, statusFilter]);

  const statusChips = useMemo(() => {
    return Object.entries(data.summary?.statuses || {}).sort((a, b) => b[1] - a[1]);
  }, [data.summary]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-heading font-bold text-3xl text-navy tracking-tight">Orders</h1>
          <p className="mt-1 text-sm text-navy/50">
            Workflow records from Seazona — products, files, departments, assignments.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {data.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Orders" value={data.summary.count.toLocaleString()} />
          <Stat label="Statuses" value={Object.keys(data.summary.statuses || {}).length} />
          <Stat label="Departments" value={Object.keys(data.summary.departments || {}).length} />
          <Stat
            label="Open"
            value={data.orders.filter((o) => o.status !== "Shipped").length.toLocaleString()}
            tint="text-amber-700"
          />
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-navy/30" />
          <input
            type="text"
            className={`${INPUT} pl-10`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by client, patient, invoice #, department, or tech…"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all ${
              statusFilter === "all" ? "bg-navy text-white" : "bg-surface-100 text-navy/60 hover:text-navy"
            }`}
          >
            All ({data.summary?.count ?? 0})
          </button>
          {statusChips.map(([s, c]) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all ${
                  active ? "bg-navy text-white" : `${statusColor(s)} hover:bg-navy/10`
                }`}
              >
                {s} ({c})
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex items-center justify-center text-navy/40">
          <Loader2 size={18} className="animate-spin mr-2" /> Loading orders…
        </div>
      ) : error ? (
        <div className="py-20 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500/40" />
          <p className="text-sm text-navy/60 max-w-md mx-auto">{error}</p>
          <button type="button" onClick={load} className="mt-4 px-4 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white">
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <Package size={32} className="mx-auto mb-3 text-navy/20" />
          <p className="text-sm text-navy/50 max-w-md mx-auto">
            {data.orders.length === 0
              ? "Seazona's Orders module isn't populated for this lab — workflow tracking lives in invoices instead."
              : "No orders match your filters."}
          </p>
          {data.orders.length === 0 && (
            <Link
              to="/admin/invoices"
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600"
            >
              <FileText size={14} />
              View Invoices
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-300/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-100 border-b border-surface-300/50">
                  <Th>Invoice #</Th>
                  <Th>Client</Th>
                  <Th>Patient</Th>
                  <Th>Department</Th>
                  <Th>Assigned</Th>
                  <Th>Ordered</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-surface-300/30 hover:bg-surface-50 cursor-pointer"
                    onClick={() => (window.location.href = `/admin/orders/${o.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-brand-600 underline">
                      {o.invoiceNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-navy truncate max-w-[240px]">
                        {o.clientName || o.company || `Client #${o.clientId}`}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-navy/70">{o.patient || "—"}</td>
                    <td className="px-4 py-3 text-xs text-navy/60">{o.department || "—"}</td>
                    <td className="px-4 py-3 text-xs text-navy/60">{o.assignedTo || "—"}</td>
                    <td className="px-4 py-3 text-xs text-navy/60">{formatDate(o.ordered)}</td>
                    <td className="px-4 py-3 text-xs text-navy/60">{formatDate(o.due)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusColor(o.status)}`}>
                        {o.status || "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
