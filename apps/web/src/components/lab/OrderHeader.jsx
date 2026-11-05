import { Link } from "react-router-dom";
import { Printer, RotateCcw, Zap, Clock } from "lucide-react";
import { LAB_STATUS_LABELS, LAB_ORDER_SOURCE_LABELS, canRemake } from "@my-app/shared";
import { Badge } from "../ui/Badge.jsx";

/** Order number, status and flag badges, and the print / remake buttons. */
export function OrderHeader({ order, rxCase, shopOrder, legacy, scheduleFlags, busy, onPrint, onRemake }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Order #{order.orderNumber}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-navy/60">
          <span className="rounded-full bg-navy px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">{LAB_STATUS_LABELS[order.status]}</span>
          {order.rush && <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-bold uppercase text-red-700"><Zap size={11} /> Rush{order.rushTier ? ` — ${order.rushTier}` : ""}</span>}
          {order.isRemake && (
            <span className="flex items-center gap-1 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-bold uppercase text-violet-700">
              <RotateCcw size={11} /> Remake{order.remakeOfOrderNumber ? ` of #${order.remakeOfOrderNumber}` : ""}
            </span>
          )}
          {scheduleFlags?.behind && <Badge color="red">Behind</Badge>}
          {scheduleFlags?.atRisk && <Badge color="yellow">At risk</Badge>}
          {order.overdue && <span className="flex items-center gap-1 text-xs font-semibold text-red-600"><Clock size={11} /> Overdue</span>}
          {rxCase && <Link to={`/admin/rx-cases/${rxCase.id}`} className="font-mono text-xs text-brand-600 hover:underline">{rxCase.caseNumber}</Link>}
          {shopOrder && <span className="font-mono text-xs">{shopOrder.orderNumber}</span>}
          {order.source === "staff" && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">{LAB_ORDER_SOURCE_LABELS.staff}</span>}
          {legacy && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{LAB_ORDER_SOURCE_LABELS.legacy}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onPrint} className="flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">
          <Printer size={14} /> Work ticket
        </button>
        {canRemake(order) && (
          <button type="button" disabled={busy} onClick={onRemake} className="flex items-center gap-1.5 rounded-full border border-navy/20 bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy/40 disabled:opacity-40">
            <RotateCcw size={14} /> Remake
          </button>
        )}
      </div>
    </div>
  );
}
