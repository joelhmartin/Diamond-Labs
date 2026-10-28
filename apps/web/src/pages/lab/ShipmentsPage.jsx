import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Printer, RefreshCw } from "lucide-react";
import { CARRIERS, CARRIER_LABELS, SHIPMENT_STATUSES, formatCents, formatLabDate } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";
import { CarriersPanel } from "../../components/lab/CarriersPanel.jsx";
import { labOrderPath, shipmentPrintPath } from "../../config/routes.js";
import { errorText } from "../../lib/requests.js";
import { pageParams } from "../../lib/data-table/server.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { shipmentLine, shipmentStatusLabel, shipmentListParams, canRefreshTracking } from "../../lib/shipping.js";

const ROW_BTN = "rounded-full bg-surface-100 px-2.5 py-1 text-[11px] font-semibold text-navy hover:bg-surface-200 disabled:opacity-40";

const FILTERS = [
  { id: "status", label: "Status", type: "select", placeholder: "Any status", options: SHIPMENT_STATUSES.map((s) => ({ value: s, label: shipmentStatusLabel(s) })) },
  { id: "carrier", label: "Carrier", type: "select", placeholder: "Any carrier", options: CARRIERS.map((c) => ({ value: c, label: CARRIER_LABELS[c] })) },
  { id: "from", label: "From", type: "date" },
  { id: "to", label: "To", type: "date" },
];

async function fetchPage({ page, pageSize, q, filters }) {
  const res = await api.get("/lab/shipments", { params: { ...shipmentListParams(filters), ...pageParams({ page, pageSize, q }) } });
  return { rows: res.data.data.shipments, total: res.data.data.total };
}

/** Run `fn(shipment)` for each row one at a time, carrying on past failures. → { ok, failed } */
async function eachShipment(rows, fn) {
  let ok = 0;
  const failed = [];
  for (const s of rows) {
    try {
      await fn(s);
      ok += 1;
    } catch (err) {
      failed.push({ id: shipmentLine(s), message: errorText(err) });
    }
  }
  return { ok, failed };
}

function shipmentColumns({ busy, act }) {
  return [
    { id: "bought", header: "Bought", cell: (s) => <span className="text-xs text-navy/60">{formatLabDate(s.purchasedAt)}</span>, exportValue: (s) => s.purchasedAt ?? "" },
    {
      id: "shipment", header: "Shipment", exportValue: (s) => shipmentLine(s),
      cell: (s) => (
        <>
          {s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{shipmentLine(s)}</a> : shipmentLine(s)}
          {s.trackingError && <div className="text-[11px] text-red-700">{s.trackingError}</div>}
        </>
      ),
    },
    { id: "status", header: "Status", cell: (s) => <span className="text-xs">{shipmentStatusLabel(s.status)}</span>, exportValue: (s) => shipmentStatusLabel(s.status) },
    {
      id: "orders", header: "Orders", exportValue: (s) => s.orders.map((o) => `#${o.orderNumber}`).join(" "),
      cell: (s) => (
        <span className="text-xs">
          {s.orders.length ? s.orders.map((o) => <Link key={o.id} to={labOrderPath(o.id)} className="mr-1 font-mono text-brand-600 hover:underline">#{o.orderNumber}</Link>) : "—"}
        </span>
      ),
    },
    { id: "to", header: "To", cell: (s) => <span className="text-xs text-navy/70">{s.shipToName ?? "—"}</span>, exportValue: (s) => s.shipToName ?? "" },
    { id: "charge", header: "Charge", cell: (s) => <span className="font-mono text-xs">{formatCents(s.chargeCents)}</span>, exportValue: (s) => (s.chargeCents / 100).toFixed(2) },
    { id: "by", header: "By", cell: (s) => <span className="text-xs text-navy/60">{s.createdByName ?? "—"}</span>, exportValue: (s) => s.createdByName ?? "" },
    {
      id: "actions", header: "", export: false,
      cell: (s) => (
        <div className="flex flex-wrap justify-end gap-1">
          {s.hasLabel && <a href={shipmentPrintPath(s.id)} target="_blank" rel="noreferrer" className={ROW_BTN}><Printer size={10} className="inline" /> Print</a>}
          {s.canMarkShipped && <button type="button" disabled={busy} className={ROW_BTN} onClick={() => act(() => api.post(`/lab/shipments/${s.id}/mark-shipped`), "Marked shipped")}>Mark shipped</button>}
          {canRefreshTracking(s) && (
            <button type="button" disabled={busy} className={ROW_BTN} onClick={() => act(() => api.post(`/lab/shipments/${s.id}/refresh-tracking`), (d) => (d.updated ? "Tracking updated" : "No change"))}>
              <RefreshCw size={10} className="inline" /> Tracking
            </button>
          )}
          {s.canVoid && (
            <ConfirmButton onConfirm={() => act(() => api.post(`/lab/shipments/${s.id}/void`), "Label voided")} disabled={busy} confirmLabel="Click again to void" className={`${ROW_BTN} bg-red-50 text-red-700`}>
              Void
            </ConfirmButton>
          )}
        </div>
      ),
    },
  ];
}

/** Admin › Shipments (lab staff and admins): every shipment, its orders, and the actions that apply. */
export function ShipmentsPage() {
  const { addToast } = useToast();
  const [carriers, setCarriers] = useState([]);
  const [busy, setBusy] = useState(false);
  const table = useDataTable({ mode: "server", fetchPage, filters: FILTERS, urlKey: "shp", getRowId: (s) => s.id });
  const { reload } = table;

  useEffect(() => {
    api.get("/lab/carriers")
      .then((c) => setCarriers(c.data.data.carriers))
      .catch((err) => addToast({ message: errorText(err), type: "error" }));
  }, [addToast]);

  const act = async (fn, success) => {
    setBusy(true);
    try {
      const res = await fn();
      addToast({ message: typeof success === "function" ? success(res.data.data) : success, type: "success" });
      reload();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const bulkActions = [
    {
      id: "mark-shipped", label: "Mark shipped",
      disabled: (rows) => !rows.some((s) => s.canMarkShipped),
      run: async (rows) => {
        const result = await eachShipment(rows.filter((s) => s.canMarkShipped), (s) => api.post(`/lab/shipments/${s.id}/mark-shipped`));
        reload();
        return result;
      },
    },
    {
      id: "refresh-tracking", label: "Refresh tracking",
      disabled: (rows) => !rows.some(canRefreshTracking),
      run: async (rows) => {
        const result = await eachShipment(rows.filter(canRefreshTracking), (s) => api.post(`/lab/shipments/${s.id}/refresh-tracking`));
        reload();
        return result;
      },
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Shipments</h1>
        <ConfirmButton
          onConfirm={() => act(() => api.post("/lab/shipments/mark-all-shipped"), (d) => `${d.shipped} shipped${d.failed ? `, ${d.failed} failed (see logs)` : ""}`)}
          disabled={busy}
          confirmLabel="Click again: every labelled box has left"
          className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90"
        >
          Mark all labelled shipped
        </ConfirmButton>
      </div>

      <CarriersPanel carriers={carriers} />

      <DataTable
        table={table}
        columns={shipmentColumns({ busy, act })}
        bulkActions={bulkActions}
        searchPlaceholder="Tracking # or order #"
        itemLabel="shipments"
        exportFileName="shipments.csv"
        emptyText="No shipments match."
      />
    </div>
  );
}
