import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { RefreshCw, Search, AlertCircle, X } from "lucide-react";
import { INVOICE_STATUSES } from "@my-app/shared";
import api from "../../config/api.js";
import { adminInvoicePath } from "../../config/routes.js";
import { formatCents } from "../../lib/money.js";
import { errorText } from "../../lib/requests.js";
import { STATUS_TONES, statusOf, labToday, dateText, instantText } from "../../lib/invoices.js";

const INPUT = "px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500";
const STATUS_WORDS = { draft: "Drafts", issued: "Issued", void: "Void" };

/** Admin › Invoices: our invoices, filtered on the server (the list is capped at 500, newest first). */
export function AdminInvoicesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const needsPrice = params.get("needsPrice") === "true";
  const clientUserId = params.get("clientUserId") ?? "";
  const [number, setNumber] = useState("");
  const [rows, setRows] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // Only the newest request may set state: a slow earlier one must not overwrite a later filter.
  const seq = useRef(0);
  const trimmedNumber = number.trim();
  const numberInvalid = trimmedNumber !== "" && !/^[1-9]\d{0,9}$/.test(trimmedNumber);
  const load = async () => {
    const mine = ++seq.current;
    // A search that isn't a positive invoice number matches nothing; don't fall back to the unfiltered list.
    if (numberInvalid) {
      setRows([]);
      setTruncated(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const query = {};
      if (status) query.status = status;
      if (needsPrice) query.needsPrice = "true";
      if (clientUserId) query.clientUserId = clientUserId;
      if (trimmedNumber) query.number = trimmedNumber;
      const res = await api.get("/admin/invoices", { params: query });
      if (mine !== seq.current) return;
      setRows(res.data.data.invoices);
      setTruncated(Boolean(res.data.data.truncated));
      setError(null);
    } catch (err) {
      if (mine === seq.current) setError(errorText(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };
  useEffect(() => {
    const t = setTimeout(load, number ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, needsPrice, clientUserId, number]);

  const today = labToday();
  const outstanding = rows.filter((r) => r.status === "issued").reduce((s, r) => s + Math.max(0, r.balanceCents), 0);

  return (
    <div className="mx-auto max-w-7xl p-6 md:p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Invoices</h1>
          <p className="mt-1 text-sm text-navy/50">{rows.length} shown · {formatCents(outstanding)} outstanding on these</p>
        </div>
        <button type="button" onClick={load} className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
          <input className={`${INPUT} w-52 pl-8`} placeholder="Invoice number" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} aria-invalid={numberInvalid} aria-label="Invoice number" />
          {numberInvalid && <p className="absolute left-0 top-full mt-1 whitespace-nowrap text-xs text-red-600" role="alert">Enter a positive invoice number.</p>}
        </div>
        <select className={INPUT} value={status} onChange={(e) => setFilter("status", e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
        </select>
        <button type="button" onClick={() => setFilter("needsPrice", needsPrice ? "" : "true")}
          className={`rounded-full px-4 py-2 text-xs font-semibold ${needsPrice ? "bg-red-500/10 text-red-700" : "bg-surface-100 text-navy/70 hover:bg-surface-200"}`}>
          Needs a price
        </button>
        {clientUserId && (
          <button type="button" onClick={() => setFilter("clientUserId", "")} className="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700">
            One client <X size={12} />
          </button>
        )}
      </div>

      {error && <p className="mb-4 flex items-center gap-2 text-sm text-red-600"><AlertCircle size={14} /> {error}</p>}
      {truncated && <p className="mb-2 text-xs text-amber-700">Showing the newest 500 — narrow the filters to see older invoices.</p>}

      <div className="overflow-x-auto rounded-2xl border border-surface-300/50 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-50 text-[11px] uppercase tracking-wide text-navy/50">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Lab order</th>
              <th className="px-4 py-3">Issued</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const label = statusOf(r, today);
              return (
                <tr key={r.id} className="border-t border-surface-300/30 hover:bg-surface-50/50">
                  <td className="px-4 py-3 font-medium"><Link to={adminInvoicePath(r.id)} className="text-brand-700 hover:underline">#{r.invoiceNumber}</Link></td>
                  <td className="px-4 py-3 text-navy/80">{r.practice || r.clientName || (r.kind === "shop" ? "Guest (shop)" : "—")}</td>
                  <td className="px-4 py-3 text-navy/60">{r.labOrderNumber ? `#${r.labOrderNumber}` : "—"}</td>
                  <td className="px-4 py-3 text-navy/60">{r.issuedAt ? instantText(r.issuedAt) : "—"}</td>
                  <td className="px-4 py-3 text-navy/60">{dateText(r.dueDate)}</td>
                  <td className="px-4 py-3 text-right">{formatCents(r.totalCents)}</td>
                  <td className="px-4 py-3 text-right font-medium">{r.status === "issued" ? formatCents(Math.max(0, r.balanceCents)) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[label]}`}>{label}</span>
                    {r.needsPrice && <span className="ml-1 rounded-full bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-700">Needs a price</span>}
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-navy/40">No invoices match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
