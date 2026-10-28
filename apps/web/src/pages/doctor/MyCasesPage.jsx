import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { formatLabDate, formatUsDate } from "@my-app/shared";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";

const TONES = {
  Submitted: "bg-blue-500/10 text-blue-700",
  "Waiting on you": "bg-orange-500/10 text-orange-800",
  Received: "bg-violet-500/10 text-violet-700",
  "In production": "bg-amber-500/10 text-amber-800",
  "On hold": "bg-red-500/10 text-red-700",
  Shipped: "bg-emerald-500/10 text-emerald-700",
  "Sent to lab": "bg-emerald-500/10 text-emerald-700",
  Cancelled: "bg-gray-200 text-gray-700",
};

const dateText = (d) => formatLabDate(d) || "—";

// Patient names are encrypted at rest; they arrive decrypted to their owner, so this search runs in the browser.
const searchFn = (c, q) =>
  [c.caseNumber, c.deviceSummary, c.patientName].filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase());

const trackingText = (t) => (t ? `${t.carrier ?? ""} ${t.trackingNumber ?? ""}`.trim() : "");

const COLUMNS = [
  { id: "case", header: "Case", sortValue: (c) => c.caseNumber, exportValue: (c) => c.caseNumber, cell: (c) => <span className="font-mono text-xs">{c.caseNumber}</span> },
  { id: "patient", header: "Patient", sortValue: (c) => c.patientName?.toLowerCase(), exportValue: (c) => c.patientName ?? "", cell: (c) => c.patientName ?? "—" },
  { id: "device", header: "Device", exportValue: (c) => c.deviceSummary ?? "", cell: (c) => <span className="text-navy/60">{c.deviceSummary ?? "—"}</span> },
  { id: "submitted", header: "Submitted", sortValue: (c) => c.submittedAt, exportValue: (c) => c.submittedAt ?? "", cell: (c) => <span className="text-navy/60">{dateText(c.submittedAt)}</span> },
  {
    id: "status", header: "Status", exportValue: (c) => c.status + (c.isRemake ? " (remake)" : ""),
    cell: (c) => (
      <>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONES[c.status] ?? "bg-gray-100 text-gray-700"}`}>{c.status}</span>
        {c.isRemake && <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-violet-700"><RotateCcw size={10} /> Remake</span>}
      </>
    ),
  },
  { id: "due", header: "Due", sortValue: (c) => c.dueDate, exportValue: (c) => c.dueDate ?? "", cell: (c) => <span className="text-navy/60">{formatUsDate(c.dueDate) || "—"}</span> },
  {
    id: "tracking", header: "Tracking", exportValue: (c) => trackingText(c.tracking),
    cell: (c) => (c.tracking ? (
      <>
        {c.tracking.url
          ? <a href={c.tracking.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{trackingText(c.tracking)}</a>
          : <span className="text-navy/60">{trackingText(c.tracking)}</span>}
        {c.tracking.deliveredAt && <div className="text-[11px] text-emerald-700">Delivered {dateText(c.tracking.deliveredAt)}</div>}
      </>
    ) : "—"),
  },
];

export function MyCasesPage() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const res = await api.get("/rx/cases");
      setCases(res.data.data);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statuses = [...new Set(cases.map((c) => c.status).filter(Boolean))];
  const filters = [{
    id: "status", label: "Status", type: "select", placeholder: "All statuses",
    options: statuses.map((s) => ({ value: s, label: s })),
    match: (c, v) => c.status === v,
  }];
  const table = useDataTable({ mode: "client", rows: cases, searchFn, filters, loading, error, reload: load });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="font-heading text-2xl font-bold text-gray-900">My cases</h1>
        <Link to={ROUTES.RX_CHOOSER} className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">New Rx</Link>
      </div>
      <DataTable
        table={table}
        columns={COLUMNS}
        searchPlaceholder="Case #, device, or patient"
        itemLabel="cases"
        exportFileName="my-cases.csv"
        emptyText="No cases yet. Submitted prescriptions appear here with their production status."
      />
    </div>
  );
}
