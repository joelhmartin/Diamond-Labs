import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import api from "../../config/api.js";
import { paymentColumns, PaymentHistory } from "../../components/admin/PaymentRow.jsx";
import { RefundPaymentModal } from "../../components/admin/RefundPaymentModal.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { pageParams } from "../../lib/data-table/server.js";

async function fetchPage({ page, pageSize, q }) {
  const { data } = await api.get("/admin/payments", { params: pageParams({ page, pageSize, q }) });
  return { rows: data.data?.payments || [], total: data.data?.total || 0 };
}

export function AdminPaymentsPage() {
  const [refundPayment, setRefundPayment] = useState(null);
  // Bumped after a refund so an open history row refetches instead of showing the trail from before it.
  const [historyGen, setHistoryGen] = useState(0);
  const table = useDataTable({ mode: "server", fetchPage, getRowId: (p) => p.transactionId });
  const columns = useMemo(() => paymentColumns({ onRefund: setRefundPayment }), []);

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Payments</h1>
          <p className="mt-1 text-sm text-navy/50">
            Every portal charge, with refunds/voids netted out. Reverse a payment from its row.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setHistoryGen((g) => g + 1); table.reload(); }}
          disabled={table.loading}
          className="flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-semibold text-navy/60 transition-all hover:bg-surface-100 hover:text-navy disabled:opacity-50"
        >
          <RefreshCw size={12} className={table.loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <DataTable
        table={table}
        columns={columns}
        renderExpanded={(p) => <PaymentHistory key={`${p.transactionId}-${historyGen}`} transactionId={p.transactionId} />}
        searchPlaceholder="Transaction id, doctor, client, or invoice #"
        itemLabel="payments"
        exportFileName="payments.csv"
        emptyText="No payments found."
      />

      {refundPayment && (
        <RefundPaymentModal
          presetTransactionId={refundPayment.transactionId}
          payment={refundPayment}
          onClose={() => setRefundPayment(null)}
          onDone={() => { setHistoryGen((g) => g + 1); table.reload(); }}
        />
      )}
    </div>
  );
}
