import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2, AlertCircle, CheckCircle2, ClipboardList, FileText, FileStack, History as HistoryIcon, Tag } from "lucide-react";
import api from "../../config/api.js";
import { useAuth } from "../../hooks/useAuth.js";
import { LAB_STATUS_LABELS, LAB_TIMEZONE, isStaffRole } from "@my-app/shared";
import { ROUTES, labOrderPath, labThreadPath } from "../../config/routes.js";
import { RecordThreads } from "../../modules/messaging/index.js";
import { caseStatusLabel, resolutionLabel } from "../../lib/rx-case-labels.js";
import { Banner } from "../../components/admin/rx-case/parts.jsx";
import { errMsg, statusColor } from "../../components/admin/rx-case/helpers.js";
import { ReleaseCard } from "../../components/admin/rx-case/ReleaseCard.jsx";
import { OrderLinesCard } from "../../components/admin/rx-case/OrderLinesCard.jsx";
import { PrescriptionTab } from "../../components/admin/rx-case/PrescriptionTab.jsx";
import { FilesTab } from "../../components/admin/rx-case/FilesTab.jsx";
import { HistoryTab } from "../../components/admin/rx-case/HistoryTab.jsx";

// Re-exported so the page's existing test import keeps working; the helper lives with the rx-case parts.
export { releaseBlockedReason } from "../../components/admin/rx-case/helpers.js";

const TABS = [
  { key: "order", label: "Order", icon: ClipboardList },
  { key: "prescription", label: "Prescription", icon: FileText },
  { key: "files", label: "Files", icon: FileStack },
  { key: "history", label: "History", icon: HistoryIcon },
];

// ── Main page: loads the case and composes the rx-case sections ──────────────

export function AdminRxCaseDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const canEdit = user?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [caseRow, setCaseRow] = useState(null);
  const [lines, setLines] = useState([]);
  const [files, setFiles] = useState([]);
  const [prescription, setPrescription] = useState(null);
  const [tab, setTab] = useState("order");
  const [labOrder, setLabOrder] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/rx-cases/${id}`);
      const { case: c, lines: l, files: f, prescription: p, labOrder: lo } = res.data.data;
      setCaseRow(c);
      setLines(l || []);
      setFiles(f || []);
      setPrescription(p || {});
      setLabOrder(lo || null);
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="py-20 flex items-center justify-center text-navy/40">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading case…
      </div>
    );
  }

  if (error || !caseRow) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <Link to={ROUTES.ADMIN_RX_CASES} className="inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy mb-6">
          <ArrowLeft size={12} /> Back to queue
        </Link>
        <div className="py-20 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500/40" />
          <p className="text-sm text-navy/60">{error || "Case not found."}</p>
        </div>
      </div>
    );
  }

  const locked = caseRow.status === "pushed" || caseRow.status === "released";
  const readOnly = locked || !canEdit;
  const legacyPushUnconfirmed = caseRow.seazonaPushStatus === "pushing";
  const resolution = resolutionLabel(caseRow.seazonaPushStatus);
  const patientName = `${caseRow.patientFirst || ""} ${caseRow.patientLast || ""}`.trim();

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <Link to={ROUTES.ADMIN_RX_CASES} className="inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy mb-6">
        <ArrowLeft size={12} /> Back to queue
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-navy/40 uppercase tracking-widest">
            <ClipboardList size={12} />
            Rx Case
          </div>
          <h1 className="mt-2 font-heading font-bold text-3xl text-navy tracking-tight">
            {caseRow.caseNumber || "Case"}
          </h1>
          <div className="mt-2 text-sm text-navy/50">
            {patientName && <span>Patient: <span className="text-navy">{patientName}</span></span>}
            {caseRow.practiceName && <span className="ml-3">Practice: <span className="text-navy">{caseRow.practiceName}</span></span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {resolution && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-700">
              <Tag size={11} /> {resolution}
            </span>
          )}
          <span className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${statusColor(caseRow.status)}`}>
            {caseStatusLabel(caseRow.status)}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-surface-300/50">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-all ${
                active ? "border-navy text-navy" : "border-transparent text-navy/40 hover:text-navy/70"
              }`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "order" && (
        <div className="space-y-5">
          {!locked && caseRow.status !== "cancelled" && isStaffRole(user?.role) && (
            <ReleaseCard caseId={id} lines={lines} legacyPushUnconfirmed={legacyPushUnconfirmed} onReleased={load} />
          )}

          {locked && (
            <Banner tone="success" icon={CheckCircle2}>
              {caseRow.status === "released" ? (
                <>
                  On the production board
                  {labOrder && (
                    <>
                      {" "}as{" "}
                      <Link to={labOrderPath(labOrder.id)} className="font-mono font-semibold underline">order #{labOrder.orderNumber}</Link>
                      {" "}({LAB_STATUS_LABELS[labOrder.status]})
                    </>
                  )}
                  . Its lines are locked — change the lab order instead.
                </>
              ) : (
                <>
                  {resolution || "Sent to Seazona (legacy)"} — sent before the lab moved to the portal. Its lines are locked; correct it in Seazona.
                  {caseRow.seazonaOrderId && <span className="block mt-1 font-mono text-xs">Seazona order #{caseRow.seazonaOrderId}</span>}
                </>
              )}
            </Banner>
          )}

          {caseRow.status === "failed" && caseRow.seazonaPushError && (
            <Banner tone="error" icon={AlertCircle}>
              Legacy Seazona push failed: {caseRow.seazonaPushError}. Releasing to the lab replaces that push.
            </Banner>
          )}

          <OrderLinesCard caseId={id} lines={lines} setLines={setLines} readOnly={readOnly} />
        </div>
      )}

      {tab === "prescription" && <PrescriptionTab caseRow={caseRow} prescription={prescription} patientName={patientName} />}
      {tab === "files" && <FilesTab caseId={id} files={files} />}
      {tab === "history" && <HistoryTab caseRow={caseRow} resolution={resolution} />}

      <div className="mt-6">
        <RecordThreads recordType="rx_case" recordId={caseRow.id} side="host" threadPath={labThreadPath} timeZone={LAB_TIMEZONE} />
      </div>
    </div>
  );
}
