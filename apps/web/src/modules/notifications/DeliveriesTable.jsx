import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { pageParams } from "../../lib/data-table/server.js";
import { fetchDeliveries } from "./api.js";
import { formatWhen } from "./format.js";

const TONE = {
  sent: "bg-emerald-500/10 text-emerald-700",
  failed: "bg-red-500/10 text-red-700",
  skipped: "bg-navy/10 text-navy/50",
  suppressed: "bg-amber-500/10 text-amber-700",
};
const opts = (values) => values.map((v) => ({ value: v, label: v }));
const FILTERS = [
  { id: "channel", label: "Channel", type: "select", placeholder: "Any channel", options: opts(["sms", "email", "in_app"]) },
  { id: "status", label: "Status", type: "select", placeholder: "Any status", options: opts(["sent", "failed", "skipped", "suppressed"]) },
];

async function fetchPage({ page, pageSize, filters }) {
  const params = pageParams({ page, pageSize });
  if (filters.channel) params.channel = filters.channel;
  if (filters.status) params.status = filters.status;
  return fetchDeliveries(params); // { rows, total }
}

/** Email and text attempts, newest first (numbers arrive masked), filterable by channel and status. */
export function DeliveriesTable({ timeZone, eventLabels = {} }) {
  const table = useDataTable({ mode: "server", fetchPage, filters: FILTERS, urlKey: "dl", getRowId: (d) => d.id });
  const columns = [
    { id: "when", header: "When", exportValue: (d) => d.createdAt, cell: (d) => <span className="whitespace-nowrap text-xs text-navy/60">{formatWhen(d.createdAt, timeZone)}</span> },
    { id: "event", header: "Alert", exportValue: (d) => d.event, cell: (d) => eventLabels[d.event] ?? d.event },
    { id: "channel", header: "Channel", exportValue: (d) => d.channel, cell: (d) => <span className="text-xs uppercase text-navy/60">{d.channel}</span> },
    { id: "to", header: "To", exportValue: (d) => d.targetMasked ?? "", cell: (d) => <span className="font-mono text-xs text-navy/60">{d.targetMasked ?? "—"}</span> },
    {
      id: "status", header: "Status", exportValue: (d) => d.status,
      cell: (d) => <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${TONE[d.status] ?? TONE.skipped}`}>{d.status}</span>,
    },
    { id: "reason", header: "Reason", exportValue: (d) => d.reason ?? "", cell: (d) => <span className="text-xs text-navy/50">{d.reason ?? ""}</span> },
  ];
  return <DataTable table={table} columns={columns} selectable={false} searchable={false} exportable={false} itemLabel="deliveries" emptyText="No deliveries yet." />;
}
