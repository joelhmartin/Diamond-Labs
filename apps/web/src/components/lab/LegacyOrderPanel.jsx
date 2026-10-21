import { Link } from "react-router-dom";
import { History } from "lucide-react";
import { LAB_ORDER_SOURCE_LABELS } from "@my-app/shared";

/**
 * A Seazona order imported at cutover. Shipped and cancelled ones are history;
 * open ones are worked on the board like any order (and shipped on their own),
 * but their bill is the imported Seazona invoice, so shipping one issues
 * nothing new and it cannot be remade.
 */
export function LegacyOrderPanel({ legacy, order }) {
  const open = order.status !== "shipped" && order.status !== "cancelled";
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-semibold"><History size={14} /> {LAB_ORDER_SOURCE_LABELS.legacy}</p>
      <p className="mt-1">
        Seazona order <span className="font-mono">{legacy.seazonaOrderId}</span>
        {legacy.patientName ? <> · Patient: <span className="font-medium">{legacy.patientName}</span></> : null}
      </p>
      <p className="mt-1 text-amber-800/80">
        {open ? "Open when we left Seazona: work it here. It was billed in Seazona; shipping it adds no new invoice." : "Read-only history from Seazona."}
      </p>
      <p className="mt-1 text-amber-800/80">
        {legacy.caseId
          ? <>Files and the prescription are on portal case <Link className="font-mono underline" to={`/admin/rx-cases/${legacy.caseId}`}>{legacy.caseNumber}</Link>.</>
          : "Its files stay in Seazona."}
      </p>
    </div>
  );
}
