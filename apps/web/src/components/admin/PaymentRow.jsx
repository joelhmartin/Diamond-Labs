import { Fragment } from "react";
import { Loader2, Undo2, History, ChevronDown } from "lucide-react";
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

/** One payment-history row, plus its expandable audit trail. */
export function PaymentRow({ payment: p, open, audit, onToggleHistory, onRefund }) {
  return (
    <Fragment key={p.transactionId}>
      <tr className="border-t border-surface-300/30 hover:bg-surface-50/50">
        <td className="px-4 py-3 text-navy/70 whitespace-nowrap">{formatDate(p.createdAt)}</td>
        <td className="px-4 py-3 text-navy/80">
          <div className="font-medium">{p.doctorName || "—"}</div>
          {p.doctorEmail && <div className="text-xs text-navy/40">{p.doctorEmail}</div>}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-navy/60">{p.transactionId}</td>
        <td className="px-4 py-3 text-navy/70 text-xs">
          {p.invoices.map((inv) => inv.invoiceNumber || inv.invoiceId).join(", ") || "—"}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {p.source === "autopay" ? (
            <span className="inline-block rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
              AutoPay
            </span>
          ) : (
            <span className="text-xs text-navy/50">{SOURCE_LABEL[p.source] || "—"}</span>
          )}
        </td>
        <td className="px-4 py-3 text-right text-navy/80 whitespace-nowrap">{formatCents(p.grossCents)}</td>
        <td className="px-4 py-3 text-right whitespace-nowrap text-navy/60">
          {p.refundedCents > 0 ? `-${formatCents(p.refundedCents)}` : "—"}
        </td>
        <td className="px-4 py-3 text-right font-medium text-navy whitespace-nowrap">{formatCents(p.netCents)}</td>
        <td className="px-4 py-3"><StatusPill status={p.status} /></td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => onToggleHistory(p.transactionId)}
              aria-expanded={open}
              title={open ? "Hide payment history" : "Payment history"}
              aria-label={open ? "Hide payment action history" : "Show payment action history"}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-all ${
                open ? "bg-surface-100 text-navy" : "text-navy/50 hover:text-navy hover:bg-surface-100"
              }`}
            >
              <History size={12} />
              <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {p.refundable ? (
              <button
                type="button"
                onClick={() => onRefund(p)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all"
              >
                <Undo2 size={12} /> Refund
              </button>
            ) : p.offline ? (
              <span className="text-xs text-navy/40">Offline</span>
            ) : (
              <span className="text-xs text-navy/30">—</span>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-50/40">
          <td colSpan={10} className="px-4 py-3">
            <AuditTrail audit={audit} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}
