import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MessageSquare, RotateCcw } from "lucide-react";
import { formatLabDate, formatUsDate } from "@my-app/shared";
import api from "../../config/api.js";
import { ROUTES, doctorThreadPath } from "../../config/routes.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { errorText } from "../../lib/requests.js";
import { NewThreadModal, fetchRecordThreads } from "../../modules/messaging/index.js";
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

/**
 * ?case=<id> (a message's record link): once the cases load, search for that
 * case so its row is on screen whatever page it was on; the table highlights
 * it. A case that isn't in the list is toasted and the param removed. → the id.
 */
function useLinkedCase({ cases, loading, error, table, addToast }) {
  const [params, setParams] = useSearchParams();
  const linkedId = params.get("case");
  const applied = useRef(null);
  useEffect(() => {
    if (!linkedId || loading || error || applied.current === linkedId) return;
    applied.current = linkedId;
    const hit = cases.find((c) => c.id === linkedId);
    if (hit) {
      table.setQ(hit.caseNumber);
      return;
    }
    addToast({ message: "That case was not found.", type: "error" });
    setParams((prev) => { const out = new URLSearchParams(prev); out.delete("case"); return out; }, { replace: true });
    // table and addToast are read once per linked id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedId, loading, error, cases]);
  return linkedId;
}

export function MyCasesPage() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [messaging, setMessaging] = useState(null); // the case a new thread is being started on
  const navigate = useNavigate();
  const { addToast } = useToast();

  // Opens the case's existing conversation, or starts one.
  const messageTheLab = async (c) => {
    try {
      const threads = await fetchRecordThreads({ recordType: "rx_case", recordId: c.id, side: "party" });
      if (threads.length) navigate(doctorThreadPath(threads[0].id));
      else setMessaging(c);
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  };
  const columns = [...COLUMNS, {
    id: "message", header: "", export: false, align: "right",
    cell: (c) => (
      <button type="button" onClick={() => messageTheLab(c)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50">
        <MessageSquare size={12} /> Message the lab
      </button>
    ),
  }];

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
  const linkedId = useLinkedCase({ cases, loading, error, table, addToast });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="font-heading text-2xl font-bold text-gray-900">My cases</h1>
        <Link to={ROUTES.RX_CHOOSER} className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">New Rx</Link>
      </div>
      <DataTable
        table={table}
        columns={columns}
        searchPlaceholder="Case #, device, or patient"
        itemLabel="cases"
        exportFileName="my-cases.csv"
        highlightRowId={linkedId}
        emptyText="No cases yet. Submitted prescriptions appear here with their production status."
      />
      <NewThreadModal
        open={Boolean(messaging)}
        onClose={() => setMessaging(null)}
        title={messaging ? `Message the lab about ${messaging.caseNumber}` : "Message the lab"}
        record={messaging ? { recordType: "rx_case", recordId: messaging.id } : null}
        onCreated={(thread) => { setMessaging(null); navigate(doctorThreadPath(thread.id)); }}
      />
    </div>
  );
}
