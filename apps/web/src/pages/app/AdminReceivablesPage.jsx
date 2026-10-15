import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, AlertCircle } from "lucide-react";
import { AGING_BUCKETS } from "@my-app/shared";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { StatementDownload } from "../../components/billing/StatementDownload.jsx";
import { formatCents } from "../../lib/money.js";
import { errorText } from "../../lib/requests.js";
import { dateText, labToday, recentMonths } from "../../lib/invoices.js";

/** Admin › Accounts receivable: one row per client with a balance, aged; worst past due first. */
export function AdminReceivablesPage() {
  const { addToast } = useToast();
  const [pastDueOnly, setPastDueOnly] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const lastMonth = recentMonths(labToday(), 2)[1];

  // Only the newest request may set state, so toggling "past due only" quickly can't show stale rows.
  const seq = useRef(0);
  const load = async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await api.get("/admin/receivables", { params: { pastDueOnly: pastDueOnly ? "true" : "false" } });
      if (mine !== seq.current) return;
      setData(res.data.data);
      setError(null);
    } catch (err) {
      if (mine === seq.current) setError(errorText(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [pastDueOnly]);

  const emailStatement = async (row) => {
    try {
      const res = await api.post(`/admin/clients/${row.clientUserId}/statement/email`, { month: lastMonth.value });
      addToast(res.data.data.sent
        ? { message: `${lastMonth.label} statement notice sent to ${row.practice || row.name}.`, type: "success" }
        : { message: "The notice could not be sent.", type: "error" });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Accounts receivable</h1>
          <p className="mt-1 text-sm text-navy/50">As of {data ? dateText(data.asOf) : "…"} · aged by due date</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPastDueOnly(!pastDueOnly)}
            className={`rounded-full px-4 py-2 text-xs font-semibold ${pastDueOnly ? "bg-red-500/10 text-red-700" : "bg-surface-100 text-navy/70 hover:bg-surface-200"}`}>
            Past due only
          </button>
          <button type="button" onClick={load} className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {error && <p className="mb-4 flex items-center gap-2 text-sm text-red-600"><AlertCircle size={14} /> {error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-surface-300/50 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-50 text-[11px] uppercase tracking-wide text-navy/50">
            <tr>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3 text-right">Balance</th>
              {AGING_BUCKETS.map((b) => <th key={b.key} className="px-4 py-3 text-right">{b.label}</th>)}
              <th className="px-4 py-3">Oldest due</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.clientUserId} className="border-t border-surface-300/30 align-middle">
                <td className="px-4 py-3">
                  <div className="font-medium text-navy">{r.practice || r.name || "—"}</div>
                  <div className="text-xs text-navy/40">{r.practice && r.name ? r.name : ""}{r.accountNumber ? ` · Acct ${r.accountNumber}` : ""}</div>
                </td>
                <td className="px-4 py-3 text-right font-semibold">{formatCents(r.balanceCents)}</td>
                {AGING_BUCKETS.map((b) => (
                  <td key={b.key} className={`px-4 py-3 text-right ${b.key !== "current" && r.buckets[b.key] ? "text-red-700" : "text-navy/60"}`}>
                    {r.buckets[b.key] ? formatCents(r.buckets[b.key]) : "—"}
                  </td>
                ))}
                <td className="px-4 py-3 text-navy/60">{dateText(r.oldestDueDate)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Link to={`${ROUTES.ADMIN_INVOICES}?clientUserId=${r.clientUserId}`} className="text-xs font-semibold text-brand-700 hover:underline">Invoices</Link>
                    <StatementDownload path={`/admin/clients/${r.clientUserId}/statement.pdf`} compact />
                    <ConfirmButton className="rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy" confirmLabel={`Email ${lastMonth.label}?`}
                      onConfirm={() => emailStatement(r)}>
                      Email statement
                    </ConfirmButton>
                  </div>
                </td>
              </tr>
            ))}
            {data && data.rows.length > 0 && (
              <tr className="border-t-2 border-surface-300 bg-surface-50 font-semibold">
                <td className="px-4 py-3">Total ({data.rows.length} clients)</td>
                <td className="px-4 py-3 text-right">{formatCents(data.totals.balanceCents)}</td>
                {AGING_BUCKETS.map((b) => <td key={b.key} className="px-4 py-3 text-right">{formatCents(data.totals.buckets[b.key])}</td>)}
                <td colSpan={2} />
              </tr>
            )}
            {data && data.rows.length === 0 && (
              <tr><td colSpan={AGING_BUCKETS.length + 4} className="px-4 py-10 text-center text-sm text-navy/40">{pastDueOnly ? "Nothing past due." : "No open balances."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
