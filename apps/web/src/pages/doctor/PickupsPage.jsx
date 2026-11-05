import { useState } from "react";
import { Truck, XCircle } from "lucide-react";
import { PICKUP_STATUSES, formatUsDate } from "@my-app/shared";
import { DataTable } from "../../components/ui/data-table/index.js";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { PickupRequestModal } from "../../components/lab/PickupRequestModal.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { pageParams } from "../../lib/data-table/server.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { errorText } from "../../lib/requests.js";
import { cancelOwnPickup, fetchPickups, isOpenPickup, statusLabel, timePreferenceLabel, windowLabel } from "../../lib/pickups.js";

const FILTERS = [
  { id: "status", label: "Status", type: "select", placeholder: "Any status", options: PICKUP_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })) },
];

async function fetchPage({ page, pageSize, filters }) {
  return fetchPickups({ ...pageParams({ page, pageSize }), ...(filters.status ? { status: filters.status } : {}) });
}

/** A practice's pickups: request one, watch it get scheduled, cancel while it is still open. */
export function PickupsPage() {
  const { addToast } = useToast();
  const [requesting, setRequesting] = useState(false);
  const table = useDataTable({ mode: "server", fetchPage, filters: FILTERS, urlKey: "pk", getRowId: (p) => p.id, isRowSelectable: isOpenPickup });

  const cancelOne = async (p) => {
    try {
      await cancelOwnPickup(p);
      addToast({ message: `Pickup #${p.pickupNumber} cancelled`, type: "success" });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
    table.reload();
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
      table.reload();
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
      <PickupRequestModal open={requesting} onClose={() => setRequesting(false)} onCreated={() => table.reload()} />
    </div>
  );
}
