import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { CreditCard } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { PaymentModal } from "../../components/doctor/PaymentModal.jsx";
import { StatementDownload } from "../../components/billing/StatementDownload.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { formatCents } from "../../lib/money.js";
import { STATUS_TONES, statusOf, isPayable, labToday, dateText, instantText } from "../../lib/invoices.js";
import { doctorInvoicePath } from "../../config/routes.js";
import { usePaymentsPaused } from "../../hooks/usePaymentsPaused.js";
import { PaymentsPausedBanner } from "../../components/doctor/PaymentsPausedBanner.jsx";

const searchFn = (inv, q) => String(inv.invoiceNumber ?? "").includes(q.replace(/^#/, "").trim());

const columns = (today) => [
  {
    id: "invoice", header: "Invoice", sortValue: (i) => i.invoiceNumber, exportValue: (i) => i.invoiceNumber,
    cell: (i) => <Link to={doctorInvoicePath(i.id)} className="font-medium text-brand-700 hover:underline">#{i.invoiceNumber}</Link>,
  },
  { id: "order", header: "Lab order", exportValue: (i) => i.labOrderNumber ?? "", cell: (i) => <span className="text-navy/60">{i.labOrderNumber ? `#${i.labOrderNumber}` : "—"}</span> },
  { id: "patient", header: "Patient", exportValue: (i) => i.patientInitials ?? "", cell: (i) => <span className="text-navy/60">{i.patientInitials ?? "—"}</span> },
  {
    id: "issued", header: "Issued", sortValue: (i) => i.issuedAt, exportValue: (i) => i.issuedAt ?? "",
    cell: (i) => <span className="text-navy/60">{i.issuedAt ? instantText(i.issuedAt) : "—"}</span>,
  },
  { id: "due", header: "Due", sortValue: (i) => i.dueDate, exportValue: (i) => i.dueDate ?? "", cell: (i) => <span className="text-navy/60">{dateText(i.dueDate)}</span> },
  { id: "total", header: "Total", align: "right", sortValue: (i) => i.totalCents, exportValue: (i) => (i.totalCents / 100).toFixed(2), cell: (i) => formatCents(i.totalCents) },
  {
    id: "balance", header: "Balance", align: "right", sortValue: (i) => i.balanceCents,
    exportValue: (i) => (i.status === "void" ? "" : (Math.max(0, i.balanceCents) / 100).toFixed(2)),
    cell: (i) => <span className="font-medium">{i.status === "void" ? "—" : formatCents(Math.max(0, i.balanceCents))}</span>,
  },
  {
    id: "status", header: "Status", exportValue: (i) => statusOf(i, today),
    cell: (i) => {
      const status = statusOf(i, today);
      return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[status]}`}>{status}</span>;
    },
  },
];

/** The doctor's invoices (issued and void; drafts are never shown), with pay-selected and statements. */
export function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paying, setPaying] = useState(null);
  const { addToast } = useToast();
  const paused = usePaymentsPaused();
  const today = labToday();

  const fetchInvoices = useCallback(async () => {
    try {
      const { data } = await api.get("/invoices");
      setInvoices(data.data || []);
      setError(null);
    } catch (err) {
      // Don't leave pre-refresh balances on screen (and payable) after a failed refresh.
      setInvoices([]);
      setError(err);
      addToast({ message: "Failed to load invoices", type: "error" });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const filters = [{
    id: "status", label: "Status", type: "select", placeholder: "All statuses",
    options: ["Open", "Past due", "Paid"].map((s) => ({ value: s, label: s })),
    match: (inv, v) => statusOf(inv, today) === v,
  }];

  const table = useDataTable({
    mode: "client", rows: invoices, searchFn, filters, isRowSelectable: isPayable, loading, error, reload: fetchInvoices,
  });

  // Same guards as before: only payable invoices can be selected, and no payment while PAYMENTS_PAUSED.
  const bulkActions = [{
    id: "pay", label: "Pay selected", icon: <CreditCard size={12} />,
    disabled: (rows) => paused || rows.length === 0 || !rows.every(isPayable),
    run: (rows) => { setPaying(rows.filter(isPayable)); },
  }];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-gray-500">Your Diamond Labs invoices. Open one for its lines and PDF.</p>
        </div>
        <StatementDownload path="/invoices/statement.pdf" />
      </div>
      {paused && <PaymentsPausedBanner />}

      <DataTable
        table={table}
        columns={columns(today)}
        bulkActions={bulkActions}
        searchPlaceholder="Invoice #"
        itemLabel="invoices"
        exportFileName="invoices.csv"
        emptyText="No invoices yet."
      />

      {paying && (
        <PaymentModal
          invoices={paying.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, balanceCents: i.balanceCents, dueDate: i.dueDate }))}
          onClose={() => setPaying(null)}
          onSuccess={() => {
            setPaying(null);
            table.selection.clear();
            fetchInvoices();
            addToast({ message: "Payment successful!", type: "success" });
          }}
        />
      )}
    </div>
  );
}
