import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { caseStatusLabel, resolutionLabel } from "../../lib/rx-case-labels.js";

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

const searchFn = (c, q) =>
  [c.caseNumber, c.patientName, c.practiceName, c.deviceKey].filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase());

/** Status filter values: a queue status, or RESOLVED_FILTER for released + pushed. */
const statusMatch = (c, picked) =>
  picked.some((v) => (v === RESOLVED_FILTER ? RESOLVED_STATUSES.includes(c.status) : c.status === v));

function caseColumns() {
  return [
    { id: "case", header: "Case #", exportValue: (c) => c.caseNumber ?? "", cell: (c) => <span className="font-mono text-xs text-brand-600">{c.caseNumber || "—"}</span> },
    { id: "patient", header: "Patient", exportValue: (c) => c.patientName ?? "", cell: (c) => <div className="text-sm font-medium text-primary truncate max-w-[200px]">{c.patientName || "—"}</div> },
    { id: "practice", header: "Practice", exportValue: (c) => c.practiceName ?? "", cell: (c) => <div className="text-sm text-secondary truncate max-w-[220px]">{c.practiceName || "—"}</div> },
    { id: "device", header: "Device", exportValue: (c) => c.deviceKey ?? "", cell: (c) => <span className="text-xs text-secondary">{c.deviceKey || "—"}</span> },
    {
      id: "lines", header: "Lines", exportValue: (c) => queueBadge(c),
      cell: (c) => (
        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${c.unmappedCount > 0 ? "bg-red-500/10 text-red-600" : "bg-surface-100 text-secondary"}`}>
          {queueBadge(c)}
        </span>
      ),
    },
    { id: "submitted", header: "Submitted", sortValue: (c) => (c.createdAt ? new Date(c.createdAt) : null), exportValue: (c) => c.createdAt ?? "", cell: (c) => <span className="text-xs text-secondary">{formatDate(c.createdAt)}</span> },
    {
      id: "status", header: "Status", exportValue: (c) => caseStatusLabel(c.status),
      cell: (c) => (
        <div className="flex flex-col items-start gap-1">
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusColor(c.status)}`}>{caseStatusLabel(c.status)}</span>
          {resolutionLabel(c.seazonaPushStatus) && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-700">{resolutionLabel(c.seazonaPushStatus)}</span>
          )}
        </div>
      ),
    },
  ];
}

export function AdminRxCasesPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cases, setCases] = useState([]);
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
      setError(err);
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
      setError(err);
    } finally {
      setResolvedLoading(false);
    }
  };

  const refresh = () => {
    load();
    setResolvedLoaded(false); // the effect below refetches resolved rows if that option is picked
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

  // Counts stay live in the option labels; the open queue is the default selection.
  const filters = useMemo(() => [{
    id: "status", label: "Status", type: "multiselect", match: statusMatch,
    options: [
      ...QUEUE_STATUSES.map((s) => ({ value: s, label: `${caseStatusLabel(s)} (${statusCounts[s] || 0})` })),
      { value: RESOLVED_FILTER, label: `Resolved${resolvedLoaded ? ` (${RESOLVED_STATUSES.reduce((n, s) => n + (statusCounts[s] || 0), 0)})` : ""}` },
    ],
  }], [statusCounts, resolvedLoaded]);

  const table = useDataTable({
    mode: "client", rows: cases, searchFn, filters, initialFilters: { status: QUEUE_STATUSES },
    loading: loading || resolvedLoading, error, reload: refresh,
  });

  // Resolved rows aren't in the default fetch; pull them the first time that option is picked.
  const wantsResolved = table.filters.status?.includes(RESOLVED_FILTER);
  useEffect(() => {
    if (wantsResolved) loadResolved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsResolved, resolvedLoaded]);

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

      <DataTable
        table={table}
        columns={caseColumns()}
        onRowClick={(c) => navigate(ROUTES.ADMIN_RX_CASE_DETAIL.replace(":id", c.id))}
        searchPlaceholder="Case #, patient, practice, or device"
        itemLabel="cases"
        exportFileName="rx-cases.csv"
        emptyText={cases.length === 0 ? "Queue is clear — no prescriptions are waiting on the lab." : "No cases match your filters."}
      />
    </div>
  );
}
