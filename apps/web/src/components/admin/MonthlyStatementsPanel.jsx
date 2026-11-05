import { useEffect, useState } from "react";
import { X } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { ConfirmButton } from "../ui/ConfirmButton.jsx";
import { DataTable } from "../ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { formatCents } from "../../lib/money.js";
import { errorText } from "../../lib/requests.js";
import { instantText, labToday, recentMonths } from "../../lib/invoices.js";

const getRowId = (r) => r.clientUserId;
const clientName = (r) => r.practice || r.name || "—";
const PLANNED = {
  send: { label: "Will send", tone: "bg-brand-500/10 text-brand-700" },
  already_sent: { label: "Already sent", tone: "bg-surface-100 text-navy/50" },
  no_email: { label: "Missing email", tone: "bg-amber-500/10 text-amber-700" },
  no_activity: { label: "Nothing to send", tone: "bg-surface-100 text-navy/50" },
};

const FILTERS = [
  { id: "planned", label: "Status", type: "select", options: Object.entries(PLANNED).map(([value, p]) => ({ value, label: p.label })), match: (r, v) => r.planned === v },
];
const searchFn = (r, q) => [r.practice, r.name, r.accountNumber, r.email].filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase());

const COLUMNS = [
  {
    id: "client", header: "Client", sortValue: (r) => clientName(r).toLowerCase(), exportValue: clientName,
    cell: (r) => (
      <>
        <div className="font-medium text-navy">{clientName(r)}</div>
        <div className="text-xs text-navy/40">{r.practice && r.name ? r.name : ""}{r.accountNumber ? ` · Acct ${r.accountNumber}` : ""}</div>
      </>
    ),
  },
  { id: "email", header: "Email", sortValue: (r) => r.email ?? "", exportValue: (r) => r.email ?? "", cell: (r) => (r.email ? <span className="text-xs text-navy/70">{r.email}</span> : <span className="text-xs text-amber-700">No email</span>) },
  { id: "closing", header: "Closing", align: "right", sortValue: (r) => r.closingCents, exportValue: (r) => (r.closingCents / 100).toFixed(2), cell: (r) => <span className="font-semibold">{formatCents(r.closingCents)}</span> },
  { id: "sent", header: "Already sent", sortValue: (r) => r.alreadySentAt ?? "", exportValue: (r) => r.alreadySentAt ?? "", cell: (r) => <span className="text-xs text-navy/60">{r.alreadySentAt ? instantText(r.alreadySentAt) : "—"}</span> },
  {
    id: "planned", header: "", align: "right", sortValue: (r) => r.planned, exportValue: (r) => PLANNED[r.planned]?.label ?? "",
    cell: (r) => {
      const p = PLANNED[r.planned];
      return p && r.planned !== "no_email" ? <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${p.tone}`}>{p.label}</span> : null;
    },
  },
];

const resultText = ({ sent = 0, failed = 0, skipped = 0 }) => `${sent} sent${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} skipped` : ""}.`;

/**
 * Receivables › Monthly statements: preview who gets a month's statement notice
 * and send them all at once. The server run is idempotent per client and month,
 * so a double-click or a retry never sends anyone the same month twice.
 */
export function MonthlyStatementsPanel({ onClose }) {
  const { addToast } = useToast();
  const months = recentMonths(labToday(), 13); // this month back a year; months ahead are refused
  const [month, setMonth] = useState(months[1].value);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/statements/run", { params: { month } });
      setRows(res.data.data || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useDataTable({ mode: "client", rows: rows ?? [], searchFn, filters: FILTERS, getRowId, loading, error, reload: load, isRowSelectable: (r) => r.planned === "send" });
  const due = (rows ?? []).filter((r) => r.planned === "send").length;
  const label = months.find((m) => m.value === month)?.label ?? month;

  const send = async (clientUserIds) => {
    try {
      const res = await api.post("/admin/statements/run", clientUserIds ? { month, clientUserIds } : { month });
      const out = res.data.data;
      addToast({ message: `${label}: ${resultText(out)}`, type: out.failed ? "warning" : "success" });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      load();
    }
  };
  const bulkActions = [{
    id: "send-selected", label: (sel) => `Send ${sel.length} selected`, confirmLabel: (sel) => `Click again: email ${sel.length} ${label} statements`,
    run: (sel) => send(sel.map(getRowId)),
  }];

  return (
    <section className="mb-6 rounded-[2rem] border border-surface-300/50 bg-white p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-bold text-navy">Monthly statements</h2>
          <p className="mt-1 text-xs text-navy/50">Every client with activity in the month or a balance at its end. Each client gets one notice per month.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-navy/60">Month{" "}
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="ml-1 rounded-lg border border-surface-300/60 bg-white px-2.5 py-1.5 text-sm text-navy">
              {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <ConfirmButton onConfirm={() => send(null)} disabled={loading || due === 0} confirmLabel={`Click again: email ${due} ${label} statements`}
            className="rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600">
            {`Send ${due} statements`}
          </ConfirmButton>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-navy/40 hover:bg-surface-100 hover:text-navy" aria-label="Close monthly statements"><X size={16} /></button>
        </div>
      </div>
      <DataTable table={table} columns={COLUMNS} bulkActions={bulkActions} dense searchPlaceholder="Practice, doctor, account # or email"
        itemLabel="clients" exportFileName={`statements-${month}.csv`} emptyText="No client is due a statement for this month." />
    </section>
  );
}
