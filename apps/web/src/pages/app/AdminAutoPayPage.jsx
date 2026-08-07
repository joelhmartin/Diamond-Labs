import { useEffect, useState } from "react";
import {
  RefreshCw,
  AlertTriangle,
  Loader2,
  AlertCircle,
  PauseCircle,
  PlayCircle,
  SlidersHorizontal,
  Power,
} from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { DoctorPaymentDrawer } from "../../components/admin/DoctorPaymentDrawer.jsx";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

function formatUSD(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Th({ children, className = "" }) {
  return (
    <th className={`text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal ${className}`}>
      {children}
    </th>
  );
}

// enabled + status together determine the badge — an enrollment can exist
// (row present) without ever being live, and a live one can be enabled but
// paused after repeated failures.
function statusOf(row) {
  if (!row.enabled) return { label: "Disabled", tone: "bg-navy/10 text-navy/50" };
  if (row.status === "paused") return { label: "Paused", tone: "bg-amber-500/10 text-amber-700" };
  if (row.status === "completed") return { label: "Completed", tone: "bg-blue-500/10 text-blue-700" };
  return { label: "Active", tone: "bg-emerald-500/10 text-emerald-700" };
}

export function AdminAutoPayPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ enrollments: [], minAmount: 0, liveRun: false });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(null); // `${userId}:${action}` in flight
  const [drawerUserId, setDrawerUserId] = useState(null);
  const { addToast } = useToast();

  const load = async () => {
    try {
      const res = await api.get("/admin/autopay");
      setData(res.data.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || "Failed to load AutoPay enrollments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The list endpoint doesn't return paymentProfileId (it isn't needed for
  // display), but the admin PUT schema requires the full enrollment shape —
  // amount/dayOfMonth/paymentProfileId — even when only `enabled` is
  // changing. Fetch the single-enrollment endpoint first so the toggle never
  // sends a payload the schema will 422 on for a missing card field.
  const toggleEnabled = async (row) => {
    const key = `${row.userId}:toggle`;
    setBusy(key);
    try {
      const { data: full } = await api.get(`/admin/users/${row.userId}/autopay`);
      const enrollment = full.data?.enrollment;
      if (!enrollment) throw new Error("No enrollment on file to toggle.");
      await api.put(`/admin/users/${row.userId}/autopay`, {
        amount: Number(enrollment.amount),
        dayOfMonth: Number(enrollment.dayOfMonth),
        paymentProfileId: enrollment.paymentProfileId,
        minAmountOverride: enrollment.minAmountOverride != null ? Number(enrollment.minAmountOverride) : null,
        enabled: !row.enabled,
      });
      addToast({ message: `AutoPay ${!row.enabled ? "enabled" : "disabled"} for ${row.doctorName || row.doctorEmail}.`, type: "success" });
      load();
    } catch (err) {
      if (err.response?.status === 502) {
        addToast({ message: err.response?.data?.error?.message || "Could not reach the card processor. Try again shortly.", type: "error" });
      } else {
        addToast({ message: err.response?.data?.error?.message || "Could not update AutoPay.", type: "error" });
      }
    } finally {
      setBusy(null);
    }
  };

  const setPaused = async (row, paused) => {
    const key = `${row.userId}:pause`;
    setBusy(key);
    try {
      await api.post(`/admin/users/${row.userId}/autopay/${paused ? "pause" : "resume"}`);
      addToast({ message: `AutoPay ${paused ? "paused" : "resumed"} for ${row.doctorName || row.doctorEmail}.`, type: "success" });
      load();
    } catch (err) {
      addToast({ message: err.response?.data?.error?.message || "Could not update AutoPay.", type: "error" });
    } finally {
      setBusy(null);
    }
  };

  const filtered = data.enrollments.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [row.doctorName, row.doctorEmail, row.accountNumber]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="font-heading font-bold text-3xl text-navy tracking-tight">AutoPay</h1>
          <p className="mt-1 text-sm text-navy/50">
            Every doctor enrolled in recurring monthly payments — enable/disable, pause/resume, or
            manage a doctor's full payment setup.
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

      {!loading && !error && !data.liveRun && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border-l-4 border-amber-500 bg-amber-50 p-4 text-sm">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
          <div>
            <strong className="text-amber-900">Dry-run mode.</strong>
            <span className="text-amber-800">
              {" "}
              AUTOPAY_LIVE_RUN is off — scheduled runs compute and record what they would charge,
              but no card is charged. Do not treat any enrollment below as actively billing a doctor.
            </span>
          </div>
        </div>
      )}

      <div className="mb-5">
        <input
          type="text"
          className={INPUT}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by doctor, email, or account #…"
        />
      </div>

      {loading ? (
        <div className="py-20 flex items-center justify-center text-navy/40">
          <Loader2 size={18} className="animate-spin mr-2" />
          Loading AutoPay enrollments…
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
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-sm text-navy/40">
            {data.enrollments.length === 0 ? "No doctors are enrolled in AutoPay yet." : "No enrollments match your search."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-300/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-100 border-b border-surface-300/50">
                  <Th>Doctor</Th>
                  <Th>Account #</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Day</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Failures</Th>
                  <Th>Last charged</Th>
                  <Th className="text-right pr-4">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const s = statusOf(row);
                  const toggleBusy = busy === `${row.userId}:toggle`;
                  const pauseBusy = busy === `${row.userId}:pause`;
                  const canPause = row.enabled && row.status === "active";
                  const canResume = row.enabled && row.status === "paused";
                  return (
                    <tr key={row.userId} className="border-b border-surface-300/30 hover:bg-surface-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-navy">{row.doctorName || "—"}</div>
                        <div className="text-xs text-navy/40">{row.doctorEmail}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-navy/60">
                        {row.accountNumber ? `#${row.accountNumber}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-navy">
                        {formatUSD(row.amount)}
                        {row.minAmountOverride != null && (
                          <div className="text-[10px] font-mono text-navy/30">
                            floor {formatUSD(row.minAmountOverride)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-navy/70">{row.dayOfMonth}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${s.tone}`}>
                          {s.label}
                        </span>
                        {row.status === "paused" && row.pausedReason && (
                          <div className="mt-0.5 max-w-[160px] truncate text-[10px] text-navy/40" title={row.pausedReason}>
                            {row.pausedReason}
                          </div>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${row.consecutiveFailures > 0 ? "font-semibold text-red-600" : "text-navy/50"}`}>
                        {row.consecutiveFailures}
                      </td>
                      <td className="px-4 py-3 text-xs text-navy/60">{formatDate(row.lastChargedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => toggleEnabled(row)}
                            disabled={toggleBusy}
                            title={row.enabled ? "Disable AutoPay" : "Enable AutoPay"}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold transition-all disabled:opacity-50 ${
                              row.enabled ? "bg-brand-500/10 text-brand-700 hover:bg-brand-500/20" : "bg-surface-100 text-navy/60 hover:bg-surface-200"
                            }`}
                          >
                            {toggleBusy ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
                            {row.enabled ? "Disable" : "Enable"}
                          </button>
                          {(canPause || canResume) && (
                            <button
                              type="button"
                              onClick={() => setPaused(row, canPause)}
                              disabled={pauseBusy}
                              title={canPause ? "Pause AutoPay" : "Resume AutoPay"}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all disabled:opacity-50"
                            >
                              {pauseBusy ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : canPause ? (
                                <PauseCircle size={11} />
                              ) : (
                                <PlayCircle size={11} />
                              )}
                              {canPause ? "Pause" : "Resume"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDrawerUserId(row.userId)}
                            title="Manage this doctor's payments"
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all"
                          >
                            <SlidersHorizontal size={11} />
                            Manage
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {drawerUserId && (
        <DoctorPaymentDrawer
          doctor={(() => {
            const row = data.enrollments.find((r) => r.userId === drawerUserId);
            return {
              userId: drawerUserId,
              name: row?.doctorName || null,
              email: row?.doctorEmail || null,
              accountNumber: row?.accountNumber || null,
            };
          })()}
          onClose={() => setDrawerUserId(null)}
          onChanged={load}
          minAmount={data.minAmount}
        />
      )}
    </div>
  );
}
