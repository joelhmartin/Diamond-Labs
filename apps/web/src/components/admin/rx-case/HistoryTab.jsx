import { formatDateTime, statusColor } from "./helpers.js";
import { caseStatusLabel } from "../../../lib/rx-case-labels.js";

export function HistoryTab({ caseRow, resolution }) {
  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 p-6">
      <h2 className="font-heading font-bold text-sm text-navy mb-4">History</h2>
      <dl className="space-y-3">
        <div className="flex items-center justify-between px-3 py-2.5 bg-surface-50 rounded-lg">
          <dt className="text-xs text-navy/50">Submitted</dt>
          <dd className="text-sm font-medium text-navy">{formatDateTime(caseRow.createdAt)}</dd>
        </div>
        <div className="flex items-center justify-between px-3 py-2.5 bg-surface-50 rounded-lg">
          <dt className="text-xs text-navy/50">Last updated</dt>
          <dd className="text-sm font-medium text-navy">{formatDateTime(caseRow.updatedAt)}</dd>
        </div>
        <div className="flex items-center justify-between px-3 py-2.5 bg-surface-50 rounded-lg">
          <dt className="text-xs text-navy/50">Current status</dt>
          <dd className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusColor(caseRow.status)}`}>
            {caseStatusLabel(caseRow.status)}
          </dd>
        </div>
        {resolution && (
          <div className="flex items-center justify-between px-3 py-2.5 bg-surface-50 rounded-lg">
            <dt className="text-xs text-navy/50">Resolution</dt>
            <dd className="text-sm font-medium text-navy">{resolution}</dd>
          </div>
        )}
        {caseRow.seazonaOrderId && (
          <div className="flex items-center justify-between px-3 py-2.5 bg-surface-50 rounded-lg">
            <dt className="text-xs text-navy/50">Seazona order # (legacy)</dt>
            <dd className="text-sm font-mono text-navy">{caseRow.seazonaOrderId}</dd>
          </div>
        )}
        {caseRow.seazonaPushError && (
          <div className="px-3 py-2.5 bg-red-50 rounded-lg">
            <dt className="text-xs text-red-600/70 mb-0.5">Legacy push error</dt>
            <dd className="text-sm text-red-700">{caseRow.seazonaPushError}</dd>
          </div>
        )}
      </dl>
      <p className="mt-4 text-[11px] text-navy/30">
        This reflects the case's current state. A full step-by-step audit log isn't exposed to this page yet.
      </p>
    </div>
  );
}
