import { useEffect, useState } from "react";
import api from "../../config/api.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { formatCents } from "../../lib/money.js";

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const STATUS_PILL = {
  paid: "bg-brand-50 text-brand-700",
  partially_refunded: "bg-amber-50 text-amber-700",
  refunded: "bg-surface-100 text-navy/60",
  refund_pending: "bg-blue-50 text-blue-700",
};
const STATUS_LABEL = {
  paid: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  refund_pending: "Refund pending",
};

// How the payment was made. AutoPay is the one a doctor did not personally
// initiate, so it is the one worth naming — seeing an unexplained charge and
// not knowing it was their own scheduled payment is how support tickets start.
// Legacy rows predate the column and carry null; show nothing rather than guess.
const SOURCE_LABEL = {
  autopay: "AutoPay",
  doctor_card: "Card",
  doctor_hosted: "Card",
  admin_card: "By lab",
  admin_offline: "Recorded by lab",
  admin_check: "Check (recorded by lab)",
  admin_cash: "Cash (recorded by lab)",
  admin_ach: "ACH (recorded by lab)",
  admin_other: "Recorded by lab",
  credit: "Credit from lab",
  refund: "Refund",
};

const dollars = (cents) => (cents / 100).toFixed(2);
const invoiceList = (p) => p.invoices.map((inv) => inv.invoiceNumber || inv.invoiceId).join(", ");
const getRowId = (p) => p.transactionId;

// "Reference" is the invoice numbers the payment covered, plus the transaction id.
const searchFn = (p, q) => `${invoiceList(p)} ${p.transactionId}`.toLowerCase().includes(q.replace(/^#/, "").toLowerCase());

const COLUMNS = [
  { id: "date", header: "Date", sortValue: (p) => p.createdAt, exportValue: (p) => p.createdAt ?? "", cell: (p) => <span className="whitespace-nowrap text-navy/70">{formatDate(p.createdAt)}</span> },
  { id: "invoices", header: "Invoices", exportValue: invoiceList, cell: (p) => <span className="text-xs text-navy/60">{invoiceList(p) || "—"}</span> },
  {
    id: "method", header: "Method", exportValue: (p) => (p.source === "autopay" ? "AutoPay" : SOURCE_LABEL[p.source] || ""),
    cell: (p) => (p.source === "autopay" ? (
      <span className="inline-block rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-brand-700">AutoPay</span>
    ) : (
      <span className="text-xs text-navy/50">{SOURCE_LABEL[p.source] || "—"}</span>
    )),
  },
  { id: "amount", header: "Amount", align: "right", sortValue: (p) => p.grossCents, exportValue: (p) => dollars(p.grossCents), cell: (p) => <span className="whitespace-nowrap">{formatCents(p.grossCents)}</span> },
  {
    id: "refunded", header: "Refunded", align: "right", sortValue: (p) => p.refundedCents, exportValue: (p) => dollars(p.refundedCents || 0),
    cell: (p) => <span className="whitespace-nowrap text-navy/50">{p.refundedCents > 0 ? `-${formatCents(p.refundedCents)}` : "—"}</span>,
  },
  { id: "net", header: "Net", align: "right", sortValue: (p) => p.netCents, exportValue: (p) => dollars(p.netCents), cell: (p) => <span className="whitespace-nowrap font-medium">{formatCents(p.netCents)}</span> },
  {
    id: "status", header: "Status", exportValue: (p) => STATUS_LABEL[p.status] || p.status,
    cell: (p) => (
      <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${STATUS_PILL[p.status] || "bg-surface-100 text-navy/60"}`}>
        {STATUS_LABEL[p.status] || p.status}
      </span>
    ),
  },
];

const FILTERS = [{
  id: "status", label: "Status", type: "select", placeholder: "All statuses",
  options: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
  match: (p, v) => p.status === v,
}];

export function PaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/payments/history");
      setPayments(data.data?.payments || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useDataTable({ mode: "client", rows: payments, searchFn, filters: FILTERS, getRowId, loading, error, reload: load });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Payment history</h1>
      <p className="mt-1 mb-6 text-sm text-gray-500">
        Every payment you've made through the portal, including any refunds.
      </p>
      <DataTable
        table={table}
        columns={COLUMNS}
        searchPlaceholder="Invoice # or reference"
        itemLabel="payments"
        exportFileName="payments.csv"
        emptyText="No payments yet."
      />
    </div>
  );
}
