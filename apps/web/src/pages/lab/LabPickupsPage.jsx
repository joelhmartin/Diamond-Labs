import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarCheck, CheckCircle2, Plus, XCircle } from "lucide-react";
import { PICKUP_STATUSES, formatUsDate } from "@my-app/shared";
import { DataTable } from "../../components/ui/data-table/index.js";
import { summarizeResult } from "../../components/ui/data-table/BulkBar.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { PickupRequestModal } from "../../components/lab/PickupRequestModal.jsx";
import { ScheduleModal } from "../../components/lab/ScheduleModal.jsx";
import { PickupDetailModal } from "../../components/lab/PickupDetailModal.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { pageParams } from "../../lib/data-table/server.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { errorText } from "../../lib/requests.js";
import {
  cancelPickupAsStaff, completePickup, fetchAssignableStaff, fetchLabPickups, isOpenPickup, schedulePickup,
  statusLabel, timePreferenceLabel, windowLabel,
} from "../../lib/pickups.js";

const STATUS_OPTIONS = [
  { value: "open", label: "Open (requested + scheduled)" },
  ...PICKUP_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
];
const rowLabel = (p) => `#${p.pickupNumber}`;
const clientName = (p) => p.companyName || p.clientName || "—";

async function fetchPage({ page, pageSize, q, filters }) {
  const params = { ...pageParams({ page, pageSize, q }), status: filters.status ?? undefined };
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.assigneeUserId) params.assigneeUserId = filters.assigneeUserId;
  return fetchLabPickups(params);
}

/** The lab's pickup desk: open pickups by default, bulk Schedule / Complete / Cancel, "New pickup" for a client. */
export function LabPickupsPage() {
  const { addToast } = useToast();
  const [params, setParams] = useSearchParams();
  const [staff, setStaff] = useState([]);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState(null); // { mode: "schedule" | "cancel", rows }
  const [linked, setLinked] = useState(null);

  useEffect(() => { fetchAssignableStaff().then(setStaff).catch(() => setStaff([])); }, []);

  const filters = useMemo(() => [
    { id: "status", label: "Status", type: "select", placeholder: "All statuses", options: STATUS_OPTIONS },
    { id: "from", label: "From", type: "date" },
    { id: "to", label: "To", type: "date" },
    { id: "assigneeUserId", label: "Driver", type: "select", placeholder: "Anyone", options: staff.map((s) => ({ value: s.id, label: s.name })) },
  ], [staff]);

  const table = useDataTable({
    mode: "server", fetchPage, filters, initialFilters: { status: "open" }, urlKey: "pk", getRowId: (p) => p.id, isRowSelectable: isOpenPickup,
  });

  // ?pickup=<id> opens that pickup: from the loaded page when it is there, else by looking it up across all statuses.
  const linkedId = params.get("pickup");
  const loaded = linkedId ? table.rows.find((p) => p.id === linkedId) : null;
  useEffect(() => {
    if (!linkedId || loaded || table.loading) return undefined;
    let live = true;
    fetchLabPickups({ limit: 100 }).then(({ rows }) => { if (live) setLinked(rows.find((p) => p.id === linkedId) ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [linkedId, loaded, table.loading]);
  const detail = linkedId ? (loaded ?? (linked?.id === linkedId ? linked : null)) : null;
  const closeDetail = () => setParams((prev) => { const next = new URLSearchParams(prev); next.delete("pickup"); return next; }, { replace: true });
  const openDetail = (p) => setParams((prev) => { const next = new URLSearchParams(prev); next.set("pickup", p.id); return next; }, { replace: true });

  const report = (result) => addToast({ message: summarizeResult(result), type: result.failed.length === 0 ? "success" : result.ok ? "warning" : "error", duration: result.failed.length ? 8000 : 4000 });

  const runSchedule = async (rows, values) => {
    const result = await eachRow(rows, (p) => schedulePickup(p, values), rowLabel);
    setDialog(null); closeDetail(); table.reload(); report(result);
  };
  const runCancel = async (rows, { reason }) => {
    const result = await eachRow(rows, (p) => cancelPickupAsStaff(p, reason), rowLabel);
    setDialog(null); closeDetail(); table.reload(); report(result);
  };
  const runComplete = async (rows) => {
    const result = await eachRow(rows, completePickup, rowLabel);
    closeDetail(); table.reload();
    return result;
  };

  const columns = [
    { id: "number", header: "Pickup", exportValue: (p) => p.pickupNumber, cell: (p) => <span className="font-mono text-xs font-semibold text-navy">#{p.pickupNumber}</span> },
    { id: "client", header: "Client", exportValue: clientName, cell: (p) => <span className="text-sm text-navy">{clientName(p)}</span> },
    { id: "window", header: "Window", exportValue: windowLabel, cell: (p) => <span className="whitespace-nowrap text-sm text-navy/80">{windowLabel(p)}</span> },
    { id: "time", header: "Time", exportValue: (p) => timePreferenceLabel(p.timePreference), cell: (p) => <span className="text-xs text-navy/60">{timePreferenceLabel(p.timePreference)}</span> },
    { id: "boxes", header: "Boxes", align: "right", exportValue: (p) => p.boxCount, cell: (p) => <span className="font-mono text-xs">{p.boxCount}</span> },
    { id: "status", header: "Status", exportValue: (p) => statusLabel(p.status), cell: (p) => <span className="text-xs font-medium text-navy">{statusLabel(p.status)}</span> },
    { id: "scheduled", header: "Scheduled for", exportValue: (p) => p.scheduledDate ?? "", cell: (p) => <span className="whitespace-nowrap text-xs text-navy/60">{p.scheduledDate ? formatUsDate(p.scheduledDate) : "—"}</span> },
    { id: "driver", header: "Driver", exportValue: (p) => p.assigneeName ?? "", cell: (p) => <span className="text-xs text-navy/60">{p.assigneeName || "—"}</span> },
  ];

  const bulkActions = [
    { id: "schedule", label: "Schedule…", icon: <CalendarCheck size={12} />, run: (rows) => { setDialog({ mode: "schedule", rows }); } },
    { id: "complete", label: "Complete", icon: <CheckCircle2 size={12} />, run: runComplete },
    { id: "cancel", label: "Cancel…", icon: <XCircle size={12} />, tone: "danger", run: (rows) => { setDialog({ mode: "cancel", rows }); } },
  ];

  const detailActions = {
    schedule: (p) => setDialog({ mode: "schedule", rows: [p] }),
    cancel: (p) => setDialog({ mode: "cancel", rows: [p] }),
    complete: async (p) => report(await runComplete([p])),
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 md:p-8">
      <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Pickups</h1>
      <DataTable
        table={table}
        columns={columns}
        bulkActions={bulkActions}
        onRowClick={openDetail}
        searchPlaceholder="Number or client"
        exportable={false}
        itemLabel="pickups"
        emptyText="No pickups match."
        toolbarRight={(
          <button type="button" onClick={() => setCreating(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-navy px-4 text-xs font-semibold text-white hover:bg-navy/90">
            <Plus size={12} /> New pickup
          </button>
        )}
      />
      <PickupDetailModal pickup={detail} onClose={closeDetail} actions={detailActions} />
      <ScheduleModal
        open={Boolean(dialog)}
        mode={dialog?.mode}
        count={dialog?.rows.length ?? 0}
        onClose={() => setDialog(null)}
        onSubmit={(values) => (dialog.mode === "cancel" ? runCancel(dialog.rows, values) : runSchedule(dialog.rows, values)).catch((err) => addToast({ message: errorText(err), type: "error" }))}
      />
      <PickupRequestModal staff open={creating} onClose={() => setCreating(false)} onCreated={() => table.reload()} />
    </div>
  );
}
