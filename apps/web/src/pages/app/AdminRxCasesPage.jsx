import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  ClipboardCheck,
} from "lucide-react";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { caseStatusLabel, resolutionLabel } from "../../lib/rx-case-labels.js";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-primary text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-icon";

// Statuses the queue offers as filter pills, in the order staff should work
// them — the same set GET /admin/rx-cases returns by default (everything
// still needing lab attention). `pushed` and `cancelled` are resolved/dead
// and deliberately excluded, mirroring the backend's DEFAULT_QUEUE_STATUSES.
const QUEUE_STATUSES = ["new", "in_review", "awaiting_doctor", "failed"];

// Resolved work: released to the lab, or sent to Seazona before the cutover (legacy).
const RESOLVED_FILTER = "resolved";
const RESOLVED_STATUSES = ["released", "pushed"];

const STATUS_COLORS = {
  new: "bg-blue-500/10 text-blue-700",
  in_review: "bg-violet-500/10 text-violet-700",
  awaiting_doctor: "bg-amber-500/10 text-amber-700",
  failed: "bg-red-500/10 text-red-600",
  released: "bg-emerald-500/10 text-emerald-700",
  pushed: "bg-emerald-500/10 text-emerald-700",
  cancelled: "bg-gray-200 text-gray-700",
};

function statusColor(s) {
  return STATUS_COLORS[s] || "bg-gray-200 text-gray-700";
}

/**
 * The line-count badge for a queue row — the thing that tells a lab tech
 * whether a case is simply waiting, or actually blocked on an unmapped
 * line. Exported (and pure) so it's directly testable without rendering
 * the page.
 */
export function queueBadge({ lineCount = 0, unmappedCount = 0 }) {
  return unmappedCount > 0
    ? `${lineCount} lines · ${unmappedCount} unmapped`
    : `${lineCount} lines`;
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Stat({ label, value, tint = "text-primary" }) {
  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 p-4">
      <div className={`font-heading font-bold text-2xl tracking-tight ${tint}`}>{value}</div>
      <div className="text-[10px] font-mono text-muted uppercase tracking-widest mt-0.5">{label}</div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th className={`text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted font-normal ${className}`}>
      {children}
    </th>
  );
}

export function AdminRxCasesPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cases, setCases] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [resolvedLoaded, setResolvedLoaded] = useState(false);
  const [resolvedLoading, setResolvedLoading] = useState(false);

  // Merges rows into `cases` by id rather than replacing the array — called
  // by both the initial mount (open queue) and, lazily, the Resolved filter
  // pill (resolved rows), and neither fetch should stomp the other's
  // results.
  const mergeCases = (rows) => {
    setCases((prev) => {
      const byId = new Map(prev.map((c) => [c.id, c]));
      for (const row of rows) byId.set(row.id, row);
      return Array.from(byId.values());
    });
  };

  const load = async () => {
    try {
      // limit=200 (the API's max) so a normal-sized queue loads in one
      // request without pagination UI — no status param, so the backend
      // applies its own DEFAULT_QUEUE_STATUSES. Resolved (pushed) cases are
      // deliberately NOT part of this fetch; see loadResolved below.
      const res = await api.get("/admin/rx-cases", { params: { limit: 200 } });
      mergeCases(res.data.data || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || "Failed to load the case queue.");
    } finally {
      setLoading(false);
    }
  };

  // Fetches resolved (pushed) cases on demand — the queue's default fetch
  // excludes them, so without this the Resolved filter would show nothing
  // even though matching rows exist. Idempotent: a repeat call while already
  // loaded/loading is a no-op rather than a redundant request.
  const loadResolved = async () => {
    if (resolvedLoaded || resolvedLoading) return;
    setResolvedLoading(true);
    try {
      const res = await api.get("/admin/rx-cases", {
        params: { limit: 200, status: RESOLVED_STATUSES.join(",") },
      });
      mergeCases(res.data.data || []);
      setResolvedLoaded(true);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || "Failed to load resolved cases.");
    } finally {
      setResolvedLoading(false);
    }
  };

  const refresh = () => {
    load();
    if (resolvedLoaded) {
      setResolvedLoaded(false);
      loadResolved();
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusCounts = useMemo(() => {
    const counts = {};
    for (const c of cases) counts[c.status] = (counts[c.status] || 0) + 1;
    return counts;
  }, [cases]);

  // "In queue" — the open-queue count only (QUEUE_STATUSES), not
  // cases.length: once the Resolved pill has been used, `cases` also holds
  // pushed rows, and those are resolved work, not backlog.
  const queueCount = useMemo(
    () => QUEUE_STATUSES.reduce((sum, s) => sum + (statusCounts[s] || 0), 0),
    [statusCounts],
  );

  const blockedCount = useMemo(
    () => cases.filter((c) => QUEUE_STATUSES.includes(c.status) && c.unmappedCount > 0).length,
    [cases],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases.filter((c) => {
      // "All" means the open queue (matching the page's own description
      // below) — not literally every fetched row, since resolved cases may
      // also be sitting in `cases` once the Resolved pill has been used.
      if (statusFilter === "all") {
        if (!QUEUE_STATUSES.includes(c.status)) return false;
      } else if (statusFilter === RESOLVED_FILTER ? !RESOLVED_STATUSES.includes(c.status) : c.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const blob = [c.caseNumber, c.patientName, c.practiceName, c.deviceKey]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [cases, query, statusFilter]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-heading font-bold text-3xl text-primary tracking-tight">Rx Case Queue</h1>
          <p className="mt-1 text-sm text-secondary">
            Submitted prescriptions waiting on the lab — new, in review, awaiting a doctor, or a failed push.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-secondary hover:text-primary hover:bg-surface-100 transition-all"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {!loading && !error && cases.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="In queue" value={queueCount} />
          <Stat label="Awaiting doctor" value={statusCounts.awaiting_doctor || 0} tint="text-amber-700" />
          <Stat label="Failed" value={statusCounts.failed || 0} tint="text-red-600" />
          <Stat label="Blocked (unmapped)" value={blockedCount} tint="text-red-600" />
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-icon" />
          <input
            type="text"
            className={`${INPUT} pl-10`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by case #, patient, practice, or device…"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all ${
              statusFilter === "all" ? "bg-navy text-white" : "bg-surface-100 text-secondary hover:text-primary"
            }`}
          >
            All ({queueCount})
          </button>
          {QUEUE_STATUSES.map((s) => {
            const active = statusFilter === s;
            const count = statusCounts[s] || 0;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all ${
                  active ? "bg-navy text-white" : `${statusColor(s)} hover:bg-navy/10`
                }`}
              >
                {caseStatusLabel(s)} ({count})
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setStatusFilter(RESOLVED_FILTER);
              loadResolved();
            }}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition-all ${
              statusFilter === RESOLVED_FILTER ? "bg-navy text-white" : `${statusColor("released")} hover:bg-navy/10`
            }`}
          >
            {resolvedLoading && <Loader2 size={11} className="animate-spin" />}
            Resolved{resolvedLoaded ? ` (${RESOLVED_STATUSES.reduce((n, s) => n + (statusCounts[s] || 0), 0)})` : ""}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex items-center justify-center text-icon">
          <Loader2 size={18} className="animate-spin mr-2" /> Loading the queue…
        </div>
      ) : error ? (
        <div className="py-20 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500/40" />
          <p className="text-sm text-secondary max-w-md mx-auto">{error}</p>
          <button type="button" onClick={load} className="mt-4 px-4 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white">
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <ClipboardCheck size={32} className="mx-auto mb-3 text-emerald-500/50" />
          <p className="text-sm text-secondary max-w-md mx-auto">
            {cases.length === 0
              ? "Queue is clear — no prescriptions are waiting on the lab."
              : "No cases match your filters."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-300/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-100 border-b border-surface-300/50">
                  <Th>Case #</Th>
                  <Th>Patient</Th>
                  <Th>Practice</Th>
                  <Th>Device</Th>
                  <Th>Lines</Th>
                  <Th>Submitted</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(ROUTES.ADMIN_RX_CASE_DETAIL.replace(":id", c.id))}
                    className="border-b border-surface-300/30 hover:bg-surface-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-brand-600">{c.caseNumber || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-primary truncate max-w-[200px]">
                        {c.patientName || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-secondary truncate max-w-[220px]">
                      {c.practiceName || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-secondary">{c.deviceKey || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          c.unmappedCount > 0 ? "bg-red-500/10 text-red-600" : "bg-surface-100 text-secondary"
                        }`}
                      >
                        {queueBadge(c)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-secondary">{formatDate(c.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusColor(c.status)}`}>
                          {caseStatusLabel(c.status)}
                        </span>
                        {resolutionLabel(c.seazonaPushStatus) && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-700">
                            {resolutionLabel(c.seazonaPushStatus)}
                          </span>
                        )}
                      </div>
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
