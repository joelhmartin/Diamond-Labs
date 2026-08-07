import { useEffect, useState } from "react";
import {
  RefreshCw,
  AlertTriangle,
  Loader2,
  AlertCircle,
  PlayCircle,
  Clock,
  ShieldAlert,
} from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";

function formatUSD(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// finishedAt is null for a run still (or forever, per the stale-row caveat)
// marked "running" — there is nothing to subtract against, so render that
// explicitly rather than a bogus duration.
function formatDuration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return "—";
  const ms = new Date(finishedAt) - new Date(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

const STATUS_TONE = {
  succeeded: "bg-emerald-500/10 text-emerald-700",
  failed: "bg-red-500/10 text-red-700",
  running: "bg-amber-500/10 text-amber-700",
};

function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] || "bg-navy/10 text-navy/50";
  return (
    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      {status || "unknown"}
    </span>
  );
}

// The AutoPay sweep's summary shape — { considered, charged, skipped, failed,
// wouldCharge, totalAmount } — is what an admin reads before deciding to flip
// AUTOPAY_LIVE_RUN. Other jobs may return a differently-shaped (or empty)
// summary object, so render known fields as labeled stats and fall back to
// raw JSON for anything else so nothing is silently dropped.
const KNOWN_SUMMARY_FIELDS = ["considered", "charged", "skipped", "failed", "wouldCharge", "totalAmount"];

function SummaryStats({ summary }) {
  if (!summary || typeof summary !== "object") {
    return <span className="text-navy/30">—</span>;
  }
  const known = KNOWN_SUMMARY_FIELDS.filter((k) => summary[k] !== undefined);
  const rest = Object.fromEntries(Object.entries(summary).filter(([k]) => !KNOWN_SUMMARY_FIELDS.includes(k)));
  const hasRest = Object.keys(rest).length > 0;

  if (known.length === 0 && !hasRest) {
    return <span className="text-navy/30">—</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      {known.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {known.map((key) => {
            const value = summary[key];
            const isMoney = key === "totalAmount";
            const isHeadline = key === "wouldCharge" || key === "totalAmount";
            return (
              <div key={key} className="flex items-baseline gap-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-navy/40">{key}</span>
                <span className={`tabular-nums text-xs ${isHeadline ? "font-bold text-navy" : "font-medium text-navy/70"}`}>
                  {isMoney ? formatUSD(value) : value}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {hasRest && (
        <pre className="text-[10px] font-mono text-navy/40 whitespace-pre-wrap break-all">
          {JSON.stringify(rest, null, 0)}
        </pre>
      )}
    </div>
  );
}

export function AdminJobsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [liveRun, setLiveRun] = useState(false);
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState(null);
  const [busy, setBusy] = useState(null); // job name currently running a dry run
  const { addToast } = useToast();

  const loadJobs = async () => {
    try {
      const res = await api.get("/admin/jobs");
      setJobs(res.data.data.jobs || []);
      setLiveRun(!!res.data.data.liveRun);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || "Failed to load jobs.");
    } finally {
      setLoading(false);
    }
  };

  const loadRuns = async () => {
    try {
      const res = await api.get("/admin/jobs/runs", { params: { limit: 50 } });
      setRuns(res.data.data.runs || []);
      setRunsError(null);
    } catch (err) {
      setRunsError(err.response?.data?.error?.message || err.message || "Failed to load run history.");
    } finally {
      setRunsLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runDry = async (job) => {
    setBusy(job.name);
    try {
      const res = await api.post(`/admin/jobs/${encodeURIComponent(job.name)}/run`, { dryRun: true });
      const result = res.data.data;
      addToast({
        message: `Dry run of "${job.name}" finished: ${result.status}.`,
        type: result.status === "failed" ? "error" : "success",
      });
      loadRuns();
    } catch (err) {
      if (err.response?.status === 409) {
        addToast({
          message: err.response?.data?.error?.message || `"${job.name}" is already running. Try again shortly.`,
          type: "error",
        });
      } else {
        addToast({
          message: err.response?.data?.error?.message || `Could not start a dry run of "${job.name}".`,
          type: "error",
        });
      }
    } finally {
      setBusy(null);
      loadRuns();
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="font-heading font-bold text-3xl text-navy tracking-tight">Jobs</h1>
          <p className="mt-1 text-sm text-navy/50">
            Scheduled background jobs (AutoPay sweep and friends). This page can only trigger a{" "}
            <strong className="text-navy/70">dry run</strong> — it computes and records what a run
            would do without charging anything. Going live is an environment change
            (<code className="font-mono text-[11px]">AUTOPAY_LIVE_RUN</code>), not a button here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            loadJobs();
            loadRuns();
          }}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {!loading && !error && (
        <div
          className={`mb-6 flex items-start gap-3 rounded-2xl border-l-4 p-4 text-sm ${
            liveRun ? "border-red-500 bg-red-50" : "border-amber-500 bg-amber-50"
          }`}
        >
          {liveRun ? (
            <ShieldAlert size={18} className="mt-0.5 flex-shrink-0 text-red-600" />
          ) : (
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
          )}
          <div>
            {liveRun ? (
              <>
                <strong className="text-red-900">Live run is ON.</strong>{" "}
                <span className="text-red-800">
                  AUTOPAY_LIVE_RUN is enabled — scheduled runs of the AutoPay sweep charge real
                  cards. Dry runs triggered from this page still never charge anything.
                </span>
              </>
            ) : (
              <>
                <strong className="text-amber-900">Dry-run mode.</strong>{" "}
                <span className="text-amber-800">
                  AUTOPAY_LIVE_RUN is off — scheduled runs compute and record what they would
                  charge, but no card is charged.
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-16 flex items-center justify-center text-navy/40">
          <Loader2 size={18} className="animate-spin mr-2" />
          Loading jobs…
        </div>
      ) : error ? (
        <div className="py-16 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500/40" />
          <p className="text-sm text-navy/60 max-w-md mx-auto">{error}</p>
          <button
            type="button"
            onClick={loadJobs}
            className="mt-4 px-4 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600"
          >
            Retry
          </button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-navy/40">No jobs are registered.</p>
        </div>
      ) : (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => {
            const isBusy = busy === job.name;
            return (
              <div key={job.name} className="bg-white rounded-2xl border border-surface-300/50 p-5 flex flex-col gap-3">
                <div>
                  <div className="font-mono text-sm font-semibold text-navy">{job.name}</div>
                  <p className="mt-1 text-xs text-navy/50">{job.description || "No description."}</p>
                </div>
                <button
                  type="button"
                  onClick={() => runDry(job)}
                  disabled={isBusy}
                  className="mt-auto flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-brand-500/10 text-brand-700 hover:bg-brand-500/20 transition-all disabled:opacity-50"
                >
                  {isBusy ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
                  Run dry
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <Clock size={14} className="text-navy/40" />
        <h2 className="font-heading font-semibold text-lg text-navy">Recent runs</h2>
      </div>

      {runsLoading ? (
        <div className="py-12 flex items-center justify-center text-navy/40">
          <Loader2 size={18} className="animate-spin mr-2" />
          Loading run history…
        </div>
      ) : runsError ? (
        <div className="py-12 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500/40" />
          <p className="text-sm text-navy/60 max-w-md mx-auto">{runsError}</p>
          <button
            type="button"
            onClick={loadRuns}
            className="mt-4 px-4 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600"
          >
            Retry
          </button>
        </div>
      ) : runs.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-navy/40">No runs recorded yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-300/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-100 border-b border-surface-300/50">
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal">Job</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal">Trigger</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal">Dry run</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal">Status</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal">Started</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal">Duration</th>
                  <th className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal">Summary</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  // A "running" status is only the last thing we recorded — if
                  // the process died mid-run (Cloud Run timeout/OOM) nothing
                  // ever flips it to succeeded/failed. Treat it as "last
                  // known", not "live right now", and surface the start time
                  // so a stale row is obvious rather than misread as an
                  // in-progress run.
                  const isRunning = run.status === "running";
                  return (
                    <tr key={run.id} className="border-b border-surface-300/30 hover:bg-surface-50 align-top">
                      <td className="px-4 py-3 font-mono text-xs text-navy">{run.jobName}</td>
                      <td className="px-4 py-3 text-xs text-navy/60">{run.trigger}</td>
                      <td className="px-4 py-3 text-xs">
                        {run.dryRun ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-navy/10 text-navy/50">
                            Dry
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-700">
                            Live
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={run.status} />
                        {isRunning && (
                          <div className="mt-1 text-[10px] text-navy/40 max-w-[140px]">
                            last recorded status — may be stale if the process died mid-run
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-navy/60 whitespace-nowrap">{formatDateTime(run.startedAt)}</td>
                      <td className="px-4 py-3 text-xs text-navy/60 whitespace-nowrap">
                        {isRunning ? "—" : formatDuration(run.startedAt, run.finishedAt)}
                      </td>
                      <td className="px-4 py-3 min-w-[220px]">
                        {run.status === "failed" && run.error ? (
                          <div className="text-xs text-red-600 max-w-[320px] truncate" title={run.error}>
                            {run.error}
                          </div>
                        ) : (
                          <SummaryStats summary={run.summary} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
