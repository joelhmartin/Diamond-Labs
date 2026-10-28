import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { AGING_BUCKETS } from "@my-app/shared";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { StatementDownload } from "../../components/billing/StatementDownload.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { formatCents } from "../../lib/money.js";
import { errorText } from "../../lib/requests.js";
import { dateText, labToday, recentMonths } from "../../lib/invoices.js";

const getRowId = (r) => r.clientUserId;
const clientName = (r) => r.practice || r.name || "—";

const FILTERS = [{ id: "pastDue", label: "Past due only", type: "toggle", match: (r) => r.pastDueCents > 0 }];

const searchFn = (r, q) =>
  [r.practice, r.name, r.accountNumber].filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase());

const dollars = (cents) => (cents / 100).toFixed(2);

function receivableColumns({ lastMonth, emailStatement }) {
  return [
    {
      id: "client", header: "Client", sortValue: (r) => clientName(r).toLowerCase(),
      exportValue: (r) => [clientName(r), r.accountNumber && `Acct ${r.accountNumber}`].filter(Boolean).join(" · "),
      cell: (r) => (
        <>
          <div className="font-medium text-navy">{clientName(r)}</div>
          <div className="text-xs text-navy/40">{r.practice && r.name ? r.name : ""}{r.accountNumber ? ` · Acct ${r.accountNumber}` : ""}</div>
        </>
      ),
    },
    { id: "balance", header: "Balance", align: "right", sortValue: (r) => r.balanceCents, exportValue: (r) => dollars(r.balanceCents), cell: (r) => <span className="font-semibold">{formatCents(r.balanceCents)}</span> },
    ...AGING_BUCKETS.map((b) => ({
      id: `bucket-${b.key}`, header: b.label, align: "right", sortValue: (r) => r.buckets[b.key], exportValue: (r) => dollars(r.buckets[b.key] || 0),
      cell: (r) => (
        <span className={b.key !== "current" && r.buckets[b.key] ? "text-red-700" : "text-navy/60"}>{r.buckets[b.key] ? formatCents(r.buckets[b.key]) : "—"}</span>
      ),
    })),
    { id: "oldest", header: "Oldest due", sortValue: (r) => r.oldestDueDate, exportValue: (r) => r.oldestDueDate ?? "", cell: (r) => <span className="text-navy/60">{dateText(r.oldestDueDate)}</span> },
    {
      id: "actions", header: "", align: "right", exportValue: () => "",
      cell: (r) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link to={`${ROUTES.ADMIN_INVOICES}?inv.clientUserId=${r.clientUserId}`} className="text-xs font-semibold text-brand-700 hover:underline">Invoices</Link>
          <StatementDownload path={`/admin/clients/${r.clientUserId}/statement.pdf`} compact />
          <ConfirmButton className="rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy" confirmLabel={`Email ${lastMonth.label}?`}
            onConfirm={() => emailStatement(r)}>
            Email statement
          </ConfirmButton>
        </div>
      ),
    },
  ];
}

/** Totals for the rows the table currently matches (search + filters), so the footer follows the filter. */
function TotalsRow({ rows, columnCount }) {
  const sum = (pick) => rows.reduce((s, r) => s + (pick(r) || 0), 0);
  const cell = "px-4 py-3 text-right text-sm";
  return (
    <tr className="bg-surface-50 font-semibold text-navy">
      <td className="w-10 px-4 py-3" />
      <td className="px-4 py-3 text-sm">Total ({rows.length} clients)</td>
      <td className={cell}>{formatCents(sum((r) => r.balanceCents))}</td>
      {AGING_BUCKETS.map((b) => <td key={b.key} className={cell}>{formatCents(sum((r) => r.buckets[b.key]))}</td>)}
      <td colSpan={columnCount - 3 - AGING_BUCKETS.length} />
    </tr>
  );
}

/** Admin › Accounts receivable: one row per client with a balance, aged; worst past due first. */
export function AdminReceivablesPage() {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const lastMonth = recentMonths(labToday(), 2)[1];

  // The whole aged list loads once; "Past due only" is a table filter, and the footer totals follow it.
  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/receivables", { params: { pastDueOnly: "false" } });
      setData(res.data.data);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useDataTable({ mode: "client", rows: data?.rows ?? [], searchFn, filters: FILTERS, getRowId, loading, error, reload: load });

  const sendStatement = async (row) => {
    const res = await api.post(`/admin/clients/${row.clientUserId}/statement/email`, { month: lastMonth.value });
    if (!res.data.data.sent) throw new Error("The notice could not be sent.");
  };
  const emailStatement = async (row) => {
    try {
      await sendStatement(row);
      addToast({ message: `${lastMonth.label} statement notice sent to ${clientName(row)}.`, type: "success" });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  };
  const bulkActions = [{
    id: "email-statements", label: "Email statements", confirmLabel: `Click again: email ${lastMonth.label} statements`,
    run: (rows) => eachRow(rows, sendStatement, clientName),
  }];

  const columns = receivableColumns({ lastMonth, emailStatement });
  const footer = table.matchingRows.length > 0 ? <TotalsRow rows={table.matchingRows} columnCount={columns.length + 1} /> : null;

  return (
    <div className="mx-auto max-w-7xl p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Accounts receivable</h1>
          <p className="mt-1 text-sm text-navy/50">As of {data ? dateText(data.asOf) : "…"} · aged by due date</p>
        </div>
        <button type="button" onClick={load} className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <DataTable
        table={table}
        columns={columns}
        bulkActions={bulkActions}
        footer={footer}
        searchPlaceholder="Practice, doctor, or account #"
        itemLabel="clients"
        exportFileName="receivables.csv"
        emptyText={table.filters.pastDue ? "Nothing past due." : "No open balances."}
      />
    </div>
  );
}
