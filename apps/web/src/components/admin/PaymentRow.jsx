import { useEffect, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import api from "../../config/api.js";
import { formatCents } from "../../lib/money.js";
import { formatUSD, formatDate, formatDateTime, auditLabel, SOURCE_LABEL, StatusPill } from "./payment-labels.jsx";

/** The recorded actions (charge, refund, card changes) for one transaction. */
function AuditTrail({ audit }) {
  if (!audit || audit.loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-navy/40">
        <Loader2 size={12} className="animate-spin" /> Loading history…
      </div>
    );
  }
  if (audit.failed) return <div className="text-xs text-red-600">Failed to load history.</div>;
  if (audit.entries.length === 0) return <div className="text-xs text-navy/40">No recorded actions for this transaction.</div>;
  return (
    <ol className="space-y-1.5">
      {audit.entries.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-mono text-navy/40 whitespace-nowrap">{formatDateTime(e.createdAt)}</span>
          <span className="font-semibold text-navy">{auditLabel(e)}</span>
          {e.metadata?.amountCents != null ? (
            <span className="text-navy/70">{formatCents(e.metadata.amountCents)}</span>
          ) : e.metadata?.amount != null ? (
            <span className="text-navy/70">{formatUSD(e.metadata.amount)}</span>
          ) : null}
          <span className="text-navy/50">
            by {e.actorName || e.actorEmail || (e.actorId ? "user " + e.actorId.slice(0, 8) : "system")}
          </span>
          {e.metadata?.ledgerWriteFailed && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">ledger needs reconcile</span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** A payment's recorded actions, fetched when its row is expanded. Remount (change `key`) to refetch. */
export function PaymentHistory({ transactionId }) {
  const [audit, setAudit] = useState(null);
  useEffect(() => {
    let live = true;
    api.get("/admin/payments/audit", { params: { transactionId } })
      .then(({ data }) => live && setAudit({ entries: data.data?.entries || [] }))
      .catch(() => live && setAudit({ entries: [], failed: true }));
    return () => { live = false; };
  }, [transactionId]);
  return <AuditTrail audit={audit} />;
}

const invoiceNumbers = (p) => p.invoices.map((inv) => inv.invoiceNumber || inv.invoiceId).join(", ");
const dollars = (cents) => (cents / 100).toFixed(2);

/** DataTable columns for the payments list. `onRefund(payment)` opens the refund modal. */
export function paymentColumns({ onRefund }) {
  return [
    { id: "date", header: "Date", className: "whitespace-nowrap text-navy/70", cell: (p) => formatDate(p.createdAt), exportValue: (p) => p.createdAt },
    {
      id: "doctor", header: "Doctor", exportValue: (p) => p.doctorName ?? "",
      cell: (p) => (
        <div className="text-navy/80">
          <div className="font-medium">{p.doctorName || "—"}</div>
          {p.doctorEmail && <div className="text-xs text-navy/40">{p.doctorEmail}</div>}
        </div>
      ),
    },
    { id: "transaction", header: "Transaction", className: "font-mono text-xs text-navy/60", cell: (p) => p.transactionId, exportValue: (p) => p.transactionId },
    { id: "invoices", header: "Invoices", className: "text-xs text-navy/70", cell: (p) => invoiceNumbers(p) || "—", exportValue: invoiceNumbers },
    {
      id: "method", header: "Method", className: "whitespace-nowrap", exportValue: (p) => (p.source === "autopay" ? "AutoPay" : SOURCE_LABEL[p.source] || ""),
      cell: (p) => (p.source === "autopay" ? (
        <span className="inline-block rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-brand-700">AutoPay</span>
      ) : (
        <span className="text-xs text-navy/50">{SOURCE_LABEL[p.source] || "—"}</span>
      )),
    },
    { id: "gross", header: "Gross", align: "right", className: "whitespace-nowrap text-navy/80", cell: (p) => formatCents(p.grossCents), exportValue: (p) => dollars(p.grossCents) },
    {
      id: "refunded", header: "Refunded", align: "right", className: "whitespace-nowrap text-navy/60", exportValue: (p) => dollars(p.refundedCents),
      cell: (p) => (p.refundedCents > 0 ? `-${formatCents(p.refundedCents)}` : "—"),
    },
    { id: "net", header: "Net", align: "right", className: "whitespace-nowrap font-medium", cell: (p) => formatCents(p.netCents), exportValue: (p) => dollars(p.netCents) },
    { id: "status", header: "Status", cell: (p) => <StatusPill status={p.status} />, exportValue: (p) => p.status },
    {
      id: "action", header: "Action", align: "right", export: false,
      cell: (p) => {
        if (p.refundable) {
          return (
            <button type="button" onClick={() => onRefund(p)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-navy/60 transition-all hover:bg-surface-100 hover:text-navy">
              <Undo2 size={12} /> Refund
            </button>
          );
        }
        return p.offline ? <span className="text-xs text-navy/40">Offline</span> : <span className="text-xs text-navy/30">—</span>;
      },
    },
  ];
}
