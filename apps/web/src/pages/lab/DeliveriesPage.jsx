import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, PackageCheck, Printer } from "lucide-react";
import { LAB_STATUS_LABELS, addIsoDays } from "@my-app/shared";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { useResource } from "../../hooks/useResource.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { completePickup } from "../../lib/pickups.js";
import {
  addressLine, dayLabel, defaultDeliveryRange, deliveryPrintPath, deliveryRangeOf, markOrderShipped, ordersLabel, planMarkDelivered,
} from "../../lib/deliveries.js";

const FILTERS = [
  { id: "from", label: "From", type: "date" },
  { id: "to", label: "To", type: "date" },
];
const EMPTY = [];

/** Stop numbers restart each day, in the list's order (day, then practice). */
function stopNumbers(stops) {
  const out = new Map();
  let day = null;
  let n = 0;
  for (const s of stops) {
    n = s.day === day ? n + 1 : 1;
    day = s.day;
    out.set(s.id, n);
  }
  return out;
}

const openPrint = (range) => window.open(deliveryPrintPath(range), "_blank", "noopener");
const searchFn = (s, q) => {
  const needle = q.toLowerCase().replace(/^#/, "");
  return s.practice.toLowerCase().includes(needle) || s.orders.some((o) => String(o.orderNumber).startsWith(needle));
};

/**
 * The lab driver's route list: local-delivery stops (day × practice) for a
 * date range, grouped by day. Bulk: Mark delivered (ready orders → shipped),
 * Pickups collected, Print route. Order numbers only, never patient names.
 */
export function DeliveriesPage() {
  const [defaults] = useState(() => defaultDeliveryRange());
  const [rows, setRows] = useState(EMPTY);
  // The range is the table's From/To filters, read back into the fetch; they have no `match`, so the hook doesn't filter rows by them.
  const [filters, setFilters] = useState(defaults);
  const from = filters.from || defaults.from;
  const range = { from, to: filters.to || addIsoDays(from, 6) };
  const res = useResource("/lab/deliveries", { params: range });
  useEffect(() => { setRows(res.data?.stops ?? EMPTY); }, [res.data]);

  const table = useDataTable({
    mode: "client", rows, filters: FILTERS, initialFilters: defaults, urlKey: "dl", searchFn, initialPageSize: 100,
    loading: res.loading, error: res.error, reload: res.reload,
  });
  useEffect(() => { setFilters(table.filters); }, [table.filters]);

  const numbers = useMemo(() => stopNumbers(rows), [rows]);

  const markDelivered = async (stops) => {
    const plan = planMarkDelivered(stops);
    const result = await eachRow(plan.moves, markOrderShipped, (m) => `#${m.orderNumber}`);
    res.reload();
    return { ok: result.ok, failed: [...result.failed, ...plan.skipped.map((s) => ({ id: `#${s.orderNumber}`, message: s.reason }))] };
  };
  const collectPickups = async (stops) => {
    const result = await eachRow(stops.flatMap((s) => s.pickups), completePickup, (p) => `#${p.pickupNumber}`);
    res.reload();
    return result;
  };

  const columns = [
    { id: "stop", header: "Stop", exportValue: (s) => numbers.get(s.id), cell: (s) => <span className="font-mono text-xs font-semibold text-navy">{numbers.get(s.id)}</span> },
    {
      id: "practice", header: "Practice", exportValue: (s) => s.practice,
      cell: (s) => (
        <span className="flex items-center gap-2 text-sm font-medium text-navy">
          {s.practice}
          {s.late && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">Late</span>}
        </span>
      ),
    },
    {
      id: "address", header: "Address", exportValue: (s) => addressLine(s.address),
      cell: (s) => (
        <span className="block text-xs text-navy/70">
          {addressLine(s.address)}
          {s.deliveryNotes && <span className="mt-0.5 block text-navy/50">{s.deliveryNotes}</span>}
        </span>
      ),
    },
    { id: "phone", header: "Phone", exportValue: (s) => s.phone ?? "", cell: (s) => <span className="whitespace-nowrap text-xs text-navy/60">{s.phone || "—"}</span> },
    {
      id: "orders", header: "Orders", exportValue: (s) => ordersLabel(s.orders),
      cell: (s) => (
        <ul className="space-y-0.5">
          {s.orders.map((o) => (
            <li key={o.id} className="whitespace-nowrap text-xs">
              <span className="font-mono font-semibold text-navy">#{o.orderNumber}</span>{" "}
              <span className="text-navy/50">{LAB_STATUS_LABELS[o.status] ?? o.status}</span>
            </li>
          ))}
          {s.orders.length === 0 && <li className="text-xs text-navy/40">—</li>}
        </ul>
      ),
    },
    {
      id: "pickups", header: "Pickups", exportValue: (s) => s.pickups.map((p) => `#${p.pickupNumber} (${p.boxCount})`).join(" "),
      cell: (s) => (s.pickups.length === 0 ? <span className="text-xs text-navy/40">—</span> : (
        <ul className="space-y-0.5">
          {s.pickups.map((p) => (
            <li key={p.id} className="whitespace-nowrap text-xs text-navy/70">
              <span className="font-mono font-semibold text-navy">#{p.pickupNumber}</span> · {p.boxCount} {p.boxCount === 1 ? "box" : "boxes"}
            </li>
          ))}
        </ul>
      )),
    },
  ];

  const bulkActions = [
    {
      id: "delivered", label: "Mark delivered", icon: <CheckCircle2 size={12} />, confirmLabel: "Click again to mark delivered",
      disabled: (stops) => !stops.some((s) => s.orders.length), run: markDelivered,
    },
    { id: "collected", label: "Pickups collected", icon: <PackageCheck size={12} />, disabled: (stops) => !stops.some((s) => s.pickups.length), run: collectPickups },
    { id: "print", label: "Print route", icon: <Printer size={12} />, run: (stops) => { openPrint(deliveryRangeOf(stops)); } },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 md:p-8">
      <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Deliveries</h1>
      <DataTable
        table={table}
        columns={columns}
        bulkActions={bulkActions}
        groupBy={{ key: (s) => s.day, header: (day, stops) => `${dayLabel(day)} · ${stops.length} ${stops.length === 1 ? "stop" : "stops"}` }}
        searchPlaceholder="Practice or order #"
        itemLabel="stops"
        exportFileName="deliveries.csv"
        emptyText="No local deliveries or pickups in this range."
        toolbarRight={(
          <button type="button" onClick={() => openPrint(range)} className="flex h-9 items-center gap-1.5 rounded-full bg-navy px-4 text-xs font-semibold text-white hover:bg-navy/90">
            <Printer size={12} /> Print route
          </button>
        )}
      />
    </div>
  );
}
