import { useState } from "react";
import { Truck, XCircle } from "lucide-react";
import { PICKUP_STATUSES, formatUsDate } from "@my-app/shared";
import { DataTable } from "../../components/ui/data-table/index.js";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { PickupRequestModal } from "../../components/lab/PickupRequestModal.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { useLinkedRecord } from "../../hooks/useLinkedRecord.js";
import { pageParams } from "../../lib/data-table/server.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { errorText } from "../../lib/requests.js";
import { cancelOwnPickup, fetchPickup, fetchPickups, isOpenPickup, statusLabel, timePreferenceLabel, windowLabel } from "../../lib/pickups.js";

const FILTERS = [
  { id: "status", label: "Status", type: "select", placeholder: "Any status", options: PICKUP_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })) },
];

async function fetchPage({ page, pageSize, filters }) {
  return fetchPickups({ ...pageParams({ page, pageSize }), ...(filters.status ? { status: filters.status } : {}) });
}

/** A notification's pickup, shown above the list whichever page its row is on. */
function LinkedPickup({ pickup, onDismiss }) {
  const when = pickup.scheduledDate ? `scheduled for ${formatUsDate(pickup.scheduledDate)}` : windowLabel(pickup);
  return (
    <div role="status" aria-label="Linked pickup" className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-500/5 px-4 py-2 text-xs text-navy/70">
      <span className="font-mono font-semibold text-navy">Pickup #{pickup.pickupNumber}</span>
      <span className="font-medium text-navy">{statusLabel(pickup.status)}</span>
      <span>{when}</span>
      <button type="button" onClick={onDismiss} className="ml-auto font-medium text-brand-600 hover:underline">Dismiss</button>
    </div>
  );
}

/** A practice's pickups: request one, watch it get scheduled, cancel while it is still open. */
export function PickupsPage() {
  const { addToast } = useToast();
  const [requesting, setRequesting] = useState(false);
  const table = useDataTable({ mode: "server", fetchPage, filters: FILTERS, urlKey: "pk", getRowId: (p) => p.id, isRowSelectable: isOpenPickup });
  // ?pickup=<id> (a notification's link): read by id, shown above the list, its row highlighted.
  const linked = useLinkedRecord("pickup", fetchPickup, { notFoundText: "That pickup was not found." });
  const reload = () => { table.reload(); if (linked.id) linked.reload(); };

  const cancelOne = async (p) => {
    try {
      await cancelOwnPickup(p);
      addToast({ message: `Pickup #${p.pickupNumber} cancelled`, type: "success" });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
    reload();
  };

  const columns = [
    { id: "number", header: "Pickup", exportValue: (p) => p.pickupNumber, cell: (p) => <span className="font-mono text-xs font-semibold text-navy">#{p.pickupNumber}</span> },
    { id: "window", header: "Window", exportValue: windowLabel, cell: (p) => <span className="whitespace-nowrap text-sm text-navy/80">{windowLabel(p)}</span> },
    { id: "time", header: "Time", exportValue: (p) => timePreferenceLabel(p.timePreference), cell: (p) => <span className="text-xs text-navy/60">{timePreferenceLabel(p.timePreference)}</span> },
    { id: "boxes", header: "Boxes", align: "right", exportValue: (p) => p.boxCount, cell: (p) => <span className="font-mono text-xs">{p.boxCount}</span> },
    { id: "status", header: "Status", exportValue: (p) => statusLabel(p.status), cell: (p) => <span className="text-xs font-medium text-navy">{statusLabel(p.status)}</span> },
    { id: "scheduled", header: "Scheduled for", exportValue: (p) => p.scheduledDate ?? "", cell: (p) => <span className="whitespace-nowrap text-xs text-navy/60">{p.scheduledDate ? formatUsDate(p.scheduledDate) : "—"}</span> },
    {
      id: "actions", header: "", export: false, align: "right",
      cell: (p) => (isOpenPickup(p) ? (
        <ConfirmButton onConfirm={() => cancelOne(p)} confirmLabel="Click again to cancel" className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
          Cancel
        </ConfirmButton>
      ) : null),
    },
  ];

  const bulkActions = [{
    id: "cancel", label: "Cancel pickups", icon: <XCircle size={12} />, tone: "danger", confirmLabel: "Click again to cancel",
    run: async (rows) => {
      const result = await eachRow(rows, cancelOwnPickup, (p) => `#${p.pickupNumber}`);
      reload();
      return result;
    },
  }];

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <h1 className="font-heading text-2xl font-bold text-gray-900">Pickups</h1>
      <DataTable
        table={table}
        columns={columns}
        bulkActions={bulkActions}
        highlightRowId={linked.id}
        notice={linked.record ? <LinkedPickup pickup={linked.record} onDismiss={linked.clear} /> : null}
        searchable={false}
        exportable={false}
        itemLabel="pickups"
        emptyText="No pickups yet."
        toolbarRight={(
          <button type="button" onClick={() => setRequesting(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-brand-500 px-4 text-xs font-semibold text-white hover:bg-brand-600">
            <Truck size={12} /> Request a pickup
          </button>
        )}
      />
      <PickupRequestModal open={requesting} onClose={() => setRequesting(false)} onCreated={reload} />
    </div>
  );
}
