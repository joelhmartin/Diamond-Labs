import { useState } from "react";
import { Banknote } from "lucide-react";
import { SectionCard, InvoicesGate } from "./PaymentSectionCard.jsx";
import { RecordPaymentModal } from "./RecordPaymentModal.jsx";

/** "Record a payment" card of the admin payment drawer: a check, cash or ACH the lab received (no card charged). */
export function AdminRecordPaymentSection({ doctor, invoices, invoicesLoading, invoicesUnavailable, onRecorded }) {
  const [recording, setRecording] = useState(false);
  return (
    <SectionCard title="Record a payment" icon={Banknote}>
      <p className="mb-2 text-xs text-navy/50">A check, cash, ACH or other payment the lab received. No card is charged.</p>
      <InvoicesGate loading={invoicesLoading} unavailable={invoicesUnavailable} empty={invoices.length === 0} emptyText="No open invoices to record against.">
        <button
          type="button"
          onClick={() => setRecording(true)}
          className="rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy/70 hover:bg-surface-200"
        >
          Record payment
        </button>
      </InvoicesGate>
      {recording && (
        <RecordPaymentModal clientUserId={doctor.userId} clientName={doctor.name} onClose={() => setRecording(false)} onRecorded={onRecorded} />
      )}
    </SectionCard>
  );
}
