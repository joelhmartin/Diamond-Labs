import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { LAB_ORDER_STATUSES, LAB_STATUS_LABELS, formatUsDate } from "@my-app/shared";
import api from "../../config/api.js";
import { labOrderPath } from "../../config/routes.js";
import { errorText } from "../../lib/lab-board.js";
import { sourceLabel } from "../../lib/staff.js";

const INPUT =
  "px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500";

const dateText = (d) => formatUsDate(d) || "—";

/** Every lab order — Rx cases and shop orders, open and closed. The board is for working them. */
export function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/lab/orders", { params: { includeClosed: "true" } });
      setOrders(res.data.data.orders);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (status && o.status !== status) return false;
      if (source && o.source !== source) return false;
      if (!q) return true;
      return [String(o.orderNumber), o.reference, o.practice, o.deviceSummary].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [orders, query, status, source]);

  return (
    <div className="mx-auto max-w-7xl p-6 md:p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Orders</h1>
          <p className="mt-1 text-sm text-navy/50">Every lab order, from Rx cases and the shop.</p>
        </div>
        <button type="button" onClick={load} className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
          <input className={`${INPUT} w-72 pl-8`} placeholder="Order #, case #, practice, item…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {LAB_ORDER_STATUSES.map((s) => <option key={s} value={s}>{LAB_STATUS_LABELS[s]}</option>)}
        </select>
        <select className={INPUT} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Rx cases and shop</option>
          <option value="rx_case">Rx cases</option>
          <option value="shop_order">Shop orders</option>
        </select>
      </div>

      {error && <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={14} /> {error}</div>}

      {loading && orders.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-navy/40"><Loader2 size={18} className="mr-2 animate-spin" /> Loading orders…</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-surface-300/50 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-50 text-[10px] font-mono uppercase tracking-widest text-navy/40">
              <tr>
                <th className="px-4 py-3">Order</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Practice</th>
                <th className="px-4 py-3">Items</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Received</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="border-t border-surface-300/40">
                  <td className="px-4 py-3 font-mono font-bold"><Link className="text-navy hover:text-brand-600" to={labOrderPath(o.id)}>#{o.orderNumber}</Link></td>
                  <td className="px-4 py-3 text-xs">{sourceLabel(o.source)}<div className="font-mono text-navy/40">{o.reference ?? ""}</div></td>
                  <td className="px-4 py-3">{o.practice}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-navy/70" title={o.deviceSummary}>{o.deviceSummary}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-surface-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">{LAB_STATUS_LABELS[o.status]}</span>{o.rush && <span className="ml-1 text-[10px] font-bold text-red-600">RUSH</span>}</td>
                  <td className={`px-4 py-3 ${o.overdue ? "font-semibold text-red-600" : ""}`}>{dateText(o.dueDate)}</td>
                  <td className="px-4 py-3 text-navy/60">{dateText(o.receivedAt)}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-navy/40">No orders match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
