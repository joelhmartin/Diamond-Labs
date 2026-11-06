import { Info } from "lucide-react";
import { Banner, Field } from "./parts.jsx";
import { formatAnswer, humanizeKey } from "./helpers.js";

/** The doctor's original submission, read-only. */
export function PrescriptionTab({ caseRow, prescription, patientName }) {
  return (
    <div className="space-y-5">
      <Banner tone="info" icon={Info}>
        This is the doctor's original submission. It is a clinical record and is never editable here —
        correct the derived order on the Order tab instead.
      </Banner>

      <div className="bg-white rounded-2xl border border-surface-300/50 p-6">
        <h2 className="font-heading font-bold text-sm text-navy mb-4">Patient &amp; case</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          <Field label="Patient" value={patientName} />
          <Field label="DOB" value={caseRow.dob} />
          <Field label="Gender" value={caseRow.gender} />
          <Field label="Contact phone" value={caseRow.contactPhone} />
          <Field label="Records method" value={caseRow.recordsMethod} />
          <Field label="Physical bite" value={caseRow.physicalBite} />
          <Field label="Device" value={caseRow.deviceKey} />
          <Field label="Device category" value={caseRow.deviceCategory} />
          <Field label="Due date" value={caseRow.dueDate} />
          <Field label="Rush" value={caseRow.rush ? (caseRow.rushTier || "Yes") : "No"} />
          <Field label="Ship to" value={formatAnswer(caseRow.shipTo)} className="sm:col-span-2 md:col-span-3" />
        </div>
        {caseRow.generalComments && (
          <div className="mt-5 pt-5 border-t border-surface-300/40">
            <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest mb-1.5">General comments</div>
            <p className="text-sm text-navy/70 whitespace-pre-wrap leading-relaxed">{caseRow.generalComments}</p>
          </div>
        )}
      </div>

      {caseRow.deviceOptions?.devices?.length > 0 && (
        <div className="bg-white rounded-2xl border border-surface-300/50 p-6">
          <h2 className="font-heading font-bold text-sm text-navy mb-4">Device selections</h2>
          <div className="space-y-3">
            {caseRow.deviceOptions.devices.map((d, i) => (
              <div key={`${d.deviceKey || d.label || i}`} className="p-3 rounded-xl bg-surface-50 border border-surface-300/40">
                <div className="text-sm font-semibold text-navy mb-1">{d.label || d.deviceKey}</div>
                <div className="text-xs text-navy/60">{formatAnswer(d) || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {prescription && Object.keys(prescription).length > 0 && (
        <div className="bg-white rounded-2xl border border-surface-300/50 p-6">
          <h2 className="font-heading font-bold text-sm text-navy mb-4">Full submission</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(prescription)
              .map(([k, v]) => [k, formatAnswer(v)])
              .filter(([, v]) => v !== null)
              .map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 px-3 py-2 bg-surface-50 rounded-lg">
                  <dt className="text-xs text-navy/50 flex-shrink-0">{humanizeKey(k)}</dt>
                  <dd className="text-sm font-medium text-navy text-right break-words">{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}
    </div>
  );
}
