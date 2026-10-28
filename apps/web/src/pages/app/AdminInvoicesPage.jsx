import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { INVOICE_STATUSES } from "@my-app/shared";
import api from "../../config/api.js";
import { adminInvoicePath } from "../../config/routes.js";
import { formatCents } from "../../lib/money.js";
import { STATUS_TONES, statusOf, labToday, dateText, instantText } from "../../lib/invoices.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { pageParams } from "../../lib/data-table/server.js";

const STATUS_WORDS = { draft: "Drafts", issued: "Issued", void: "Void" };

const FILTERS = [
  { id: "status", label: "Status", type: "select", placeholder: "All statuses", options: INVOICE_STATUSES.map((s) => ({ value: s, label: STATUS_WORDS[s] })) },
  { id: "needsPrice", label: "Needs a price", type: "toggle" },
  // Set by the Receivables "Invoices" link; shown as a removable chip.
  { id: "clientUserId", label: "One client", type: "chip" },
];

const clientText = (r) => r.practice || r.clientName || (r.kind === "shop" ? "Guest (shop)" : r.kind === "legacy" ? "Unowned (Seazona history)" : "—");

async function fetchPage({ page, pageSize, q, filters }) {
  const params = pageParams({ page, pageSize, q });
  if (filters.status) params.status = filters.status;
  if (filters.needsPrice) params.needsPrice = "true";
  if (filters.clientUserId) params.clientUserId = filters.clientUserId;
  const res = await api.get("/admin/invoices", { params });
  return { rows: res.data.data.invoices, total: res.data.data.total };
}

function invoiceColumns(today) {
  return [
    {
      id: "invoice", header: "Invoice", exportValue: (r) => r.invoiceNumber,
      cell: (r) => <Link to={adminInvoicePath(r.id)} className="font-medium text-brand-700 hover:underline">#{r.invoiceNumber}</Link>,
    },
    { id: "client", header: "Client", cell: (r) => <span className="text-navy/80">{clientText(r)}</span>, exportValue: clientText },
    { id: "order", header: "Lab order", cell: (r) => <span className="text-navy/60">{r.labOrderNumber ? `#${r.labOrderNumber}` : "—"}</span>, exportValue: (r) => r.labOrderNumber ?? "" },
    { id: "issued", header: "Issued", cell: (r) => <span className="text-navy/60">{r.issuedAt ? instantText(r.issuedAt) : "—"}</span>, exportValue: (r) => r.issuedAt ?? "" },
    { id: "due", header: "Due", cell: (r) => <span className="text-navy/60">{dateText(r.dueDate)}</span>, exportValue: (r) => r.dueDate ?? "" },
    { id: "total", header: "Total", align: "right", cell: (r) => formatCents(r.totalCents), exportValue: (r) => (r.totalCents / 100).toFixed(2) },
    {
      id: "balance", header: "Balance", align: "right", className: "font-medium",
      cell: (r) => (r.status === "issued" ? formatCents(Math.max(0, r.balanceCents)) : "—"),
      exportValue: (r) => (r.status === "issued" ? (Math.max(0, r.balanceCents) / 100).toFixed(2) : ""),
    },
    {
      id: "status", header: "Status", exportValue: (r) => statusOf(r, today),
      cell: (r) => {
        const label = statusOf(r, today);
        return (
          <>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[label]}`}>{label}</span>
            {r.needsPrice && <span className="ml-1 rounded-full bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-700">Needs a price</span>}
          </>
        );
      },
    },
  ];
}

/** Admin › Invoices: our invoices, searched, filtered and paged on the server. */
export function AdminInvoicesPage() {
  const table = useDataTable({ mode: "server", fetchPage, filters: FILTERS, urlKey: "inv", getRowId: (r) => r.id });
  const outstanding = table.rows.filter((r) => r.status === "issued").reduce((s, r) => s + Math.max(0, r.balanceCents), 0);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6 md:p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Invoices</h1>
          <p className="mt-1 text-sm text-navy/50">{table.total} match · {formatCents(outstanding)} outstanding on this page</p>
        </div>
        <button type="button" onClick={table.reload} className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200">
          <RefreshCw size={12} className={table.loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      <DataTable
        table={table}
        columns={invoiceColumns(labToday())}
        searchPlaceholder="Invoice # or client"
        itemLabel="invoices"
        exportFileName="invoices.csv"
        emptyText="No invoices match."
      />
    </div>
  );
}
