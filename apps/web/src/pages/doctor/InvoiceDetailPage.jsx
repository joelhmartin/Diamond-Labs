import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CreditCard, FileDown, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { InvoiceView } from "../../components/billing/InvoiceView.jsx";
import { PaymentModal } from "../../components/doctor/PaymentModal.jsx";
import { ROUTES } from "../../config/routes.js";
import { formatCents } from "../../lib/money.js";
import { isPayable } from "../../lib/invoices.js";
import { openPdf, blobErrorText } from "../../lib/requests.js";
import { usePaymentsPaused } from "../../hooks/usePaymentsPaused.js";
import { PaymentsPausedBanner } from "../../components/doctor/PaymentsPausedBanner.jsx";

/** One of the doctor's invoices, read-only, with its PDF and a pay button while it owes. */
export function InvoiceDetailPage() {
  const { id } = useParams();
  const [inv, setInv] = useState(null);
  const [failed, setFailed] = useState(false);
  const [paying, setPaying] = useState(false);
  const { addToast } = useToast();
  const paused = usePaymentsPaused();

  const load = useCallback(() => {
    api.get(`/invoices/${id}`)
      .then((res) => { setInv(res.data.data); setFailed(false); })
      .catch(() => setFailed(true));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const back = (
    <Link to={ROUTES.DOCTOR_INVOICES} className="mb-6 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
      <ArrowLeft size={12} /> Invoices
    </Link>
  );
  if (failed) {
    return <div className="mx-auto max-w-4xl px-4 py-8">{back}<p className="text-sm text-red-600">We couldn't load this invoice.</p></div>;
  }
  if (!inv) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;

  const downloadPdf = () =>
    openPdf(api, `/invoices/${inv.id}/pdf`).catch(async (err) => addToast({ message: await blobErrorText(err), type: "error" }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {back}{paused && <PaymentsPausedBanner />}
      <InvoiceView
        invoice={inv}
        order={{ orderNumber: inv.labOrderNumber, caseNumber: inv.caseNumber, patientName: inv.patientName }}
        lines={inv.lines}
        payments={inv.payments}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={downloadPdf}><FileDown size={14} /> PDF</Button>
            {isPayable(inv) && !paused && (
              <Button size="sm" onClick={() => setPaying(true)}><CreditCard size={14} /> Pay {formatCents(inv.balanceCents)}</Button>
            )}
          </>
        }
      />
      {paying && (
        <PaymentModal
          invoices={[{ id: inv.id, invoiceNumber: inv.invoiceNumber, balanceCents: inv.balanceCents, dueDate: inv.dueDate }]}
          onClose={() => setPaying(false)}
          onSuccess={() => {
            setPaying(false);
            load();
            addToast({ message: "Payment successful!", type: "success" });
          }}
        />
      )}
    </div>
  );
}
