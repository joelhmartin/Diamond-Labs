import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Mail } from "lucide-react";
import { AGING_BUCKETS } from "@my-app/shared";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { AccountCreditModal } from "../../components/admin/AccountCreditModal.jsx";
import { MonthlyStatementsPanel } from "../../components/admin/MonthlyStatementsPanel.jsx";
import { StatementDownload } from "../../components/billing/StatementDownload.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { formatCents } from "../../lib/money.js";
import { errorText } from "../../lib/requests.js";
import { dateText, labToday, recentMonths } from "../../lib/invoices.js";

// A table row is a practice (one per account) or, in "By group" view, a group of them.
// An unassigned row (invoices with a client but no practice yet) is keyed by its client user.
const getRowId = (r) => (r.isGroup ? `g:${r.organizationId}` : r.accountId ?? `u:${r.ownerUserId}`);
const rowName = (r) => r.name || "—";
// A credit is for exactly this row: the practice's own invoices, or an Unassigned row's client's unassigned ones.
const creditPathOf = (r) =>
  r.accountId ? `/admin/practices/${r.accountId}/account-credit` : r.ownerUserId ? `/admin/clients/${r.ownerUserId}/account-credit` : null;
const practiceCount = (r) => (r.isGroup ? r.members.length : 1);

const FILTERS = [{ id: "pastDue", label: "Past due only", type: "toggle", match: (r) => r.pastDueCents > 0 }];

const searchText = (r) => [r.name, r.accountNumber, r.organizationName].filter(Boolean).join(" ");
const searchFn = (r, q) =>
  [searchText(r), ...(r.isGroup ? r.members.map(searchText) : [])].join(" ").toLowerCase().includes(q.toLowerCase());

const SELECTABLE = true; // the totals row mirrors the leading checkbox column

/** Why the table is empty: a search or filter that matches nothing, or truly no balances. */
function emptyMessage(table) {
  if (table.q.trim()) return `No practices match "${table.q.trim()}".`;
  return table.filters.pastDue ? "Nothing past due." : "No open balances.";
}

const dollars = (cents) => (cents / 100).toFixed(2);

function receivableColumns({ lastMonth, emailStatement, openCredit }) {
  return [
    {
      id: "client", header: "Practice", sortValue: (r) => rowName(r).toLowerCase(),
      exportValue: (r) => (r.isGroup ? `${rowName(r)} (group)` : [rowName(r), r.accountNumber && `Acct ${r.accountNumber}`].filter(Boolean).join(" · ")),
      cell: (r) => (
        <>
          <div className="font-medium text-navy">{rowName(r)}</div>
          <div className="text-xs text-navy/40">
            {r.isGroup ? `Group · ${r.members.length} ${r.members.length === 1 ? "practice" : "practices"}` : [r.unassigned && "Unassigned (no practice yet)", r.accountNumber && `Acct ${r.accountNumber}`, r.organizationName].filter(Boolean).join(" · ")}
          </div>
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
      cell: (r) => (r.isGroup ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link to={`${ROUTES.ADMIN_INVOICES}?${r.accountId ? `inv.accountId=${r.accountId}` : `inv.clientUserId=${r.ownerUserId}`}`} className="text-xs font-semibold text-brand-700 hover:underline">Invoices</Link>
          {r.accountId && <StatementDownload path={`/admin/practices/${r.accountId}/statement.pdf`} compact />}
          {r.accountId && (
            <ConfirmButton className="rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy" confirmLabel={`Email ${lastMonth.label}?`}
              onConfirm={() => emailStatement(r)}>
              Email statement
            </ConfirmButton>
          )}
          {!r.isGroup && creditPathOf(r) && <button type="button" onClick={() => openCredit(r)} className="rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy">Account credit…</button>}
        </div>
      )),
    },
  ];
}

/** The practices inside an expanded group row, with the same aging as the main table. */
function GroupPractices({ group }) {
  return (
    <table className="w-full text-sm" aria-label={`${group.name} practices`}>
      <tbody>
        {group.members.map((m) => (
          <tr key={m.accountId} className="border-t border-surface-300/40 first:border-t-0">
            <td className="py-1.5 pr-4 font-medium text-navy">{rowName(m)}{m.accountNumber ? <span className="ml-2 text-xs font-normal text-navy/40">Acct {m.accountNumber}</span> : null}</td>
            <td className="py-1.5 pr-4 text-right font-semibold">{formatCents(m.balanceCents)}</td>
            <td className="py-1.5 pr-4 text-right text-red-700">{m.pastDueCents ? `${formatCents(m.pastDueCents)} past due` : <span className="text-navy/40">Nothing past due</span>}</td>
            <td className="py-1.5 text-right text-navy/60">{dateText(m.oldestDueDate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Totals for the rows the table currently matches (search + filters), so the footer follows the filter. */
function TotalsRow({ rows, columnCount, selectable }) {
  const sum = (pick) => rows.reduce((s, r) => s + (pick(r) || 0), 0);
  const cell = "px-4 py-3 text-right text-sm";
  return (
    <tr className="bg-surface-50 font-semibold text-navy">
      {selectable && <td className="w-10 px-4 py-3" />}
      <td className="w-8 px-4 py-3" />
      <td className="px-4 py-3 text-sm">Total ({rows.reduce((n, r) => n + practiceCount(r), 0)} practices)</td>
      <td className={cell}>{formatCents(sum((r) => r.balanceCents))}</td>
      {AGING_BUCKETS.map((b) => <td key={b.key} className={cell}>{formatCents(sum((r) => r.buckets[b.key]))}</td>)}
      <td colSpan={columnCount - 3 - AGING_BUCKETS.length} />
    </tr>
  );
}

/** Admin › Accounts receivable: one row per practice with a balance, aged; "By group" rolls practices of a group into one expandable row. */
export function AdminReceivablesPage() {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creditFor, setCreditFor] = useState(null);
  const [statementsOpen, setStatementsOpen] = useState(false);
  const [byGroup, setByGroup] = useState(false);
  const lastMonth = recentMonths(labToday(), 2)[1];

  // The whole aged list loads once; "Past due only" is a table filter, and the footer totals follow it.
  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/receivables", { params: { pastDueOnly: "false", groupBy: "organization" } });
      setData(res.data.data);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // "By group": each group's row (its practices inside) plus the practices that are in no group.
  const tableRows = useMemo(() => {
    const rows = data?.rows ?? [];
    if (!byGroup) return rows;
    const groups = (data?.groups ?? []).map((g) => ({ ...g, isGroup: true, members: rows.filter((r) => new Set(g.accountIds).has(r.accountId)) }));
    return [...groups, ...rows.filter((r) => !r.organizationId)];
  }, [data, byGroup]);

  const table = useDataTable({ mode: "client", rows: tableRows, searchFn, filters: FILTERS, getRowId, loading, error, reload: load });

  // One practice, now, to its approved doctors (an explicit re-send is allowed). The whole month goes out from "Monthly statements".
  const emailStatement = async (row) => {
    try {
      const res = await api.post(`/admin/practices/${row.accountId}/statement/email`, { month: lastMonth.value });
      if (!res.data.data.sent) throw new Error("The notice could not be sent.");
      addToast({ message: `${lastMonth.label} statement notice sent to ${rowName(row)}.`, type: "success" });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  };
  const columns = receivableColumns({ lastMonth, emailStatement, openCredit: setCreditFor });
  const footer = table.matchingRows.length > 0 ? <TotalsRow rows={table.matchingRows} columnCount={columns.length + 1} selectable={SELECTABLE} /> : null;

  return (
    <div className="mx-auto max-w-7xl p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Accounts receivable</h1>
          <p className="mt-1 text-sm text-navy/50">As of {data ? dateText(data.asOf) : "…"} · aged by due date</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setStatementsOpen((v) => !v)} aria-expanded={statementsOpen}
            className="flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600">
            <Mail size={12} /> Monthly statements
          </button>
          <button type="button" onClick={load} className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {statementsOpen && <MonthlyStatementsPanel onClose={() => setStatementsOpen(false)} />}

      <DataTable
        table={table}
        columns={columns}
        footer={footer}
        searchPlaceholder="Practice, group, or account #"
        itemLabel={byGroup ? "groups and practices" : "practices"}
        renderExpanded={(g) => (g.isGroup ? <GroupPractices group={g} /> : null)}
        canExpand={(r) => r.isGroup}
        toolbarRight={(
          <button type="button" onClick={() => setByGroup((v) => !v)} aria-pressed={byGroup}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${byGroup ? "bg-brand-500 text-white" : "bg-surface-100 text-navy"}`}>
            By group
          </button>
        )}
        selectable={SELECTABLE}
        exportFileName="receivables.csv"
        emptyText={emptyMessage(table)}
      />
      {creditFor && (
        <AccountCreditModal creditPath={creditPathOf(creditFor)} clientName={rowName(creditFor)} onClose={() => setCreditFor(null)} onRecorded={load} />
      )}
    </div>
  );
}
