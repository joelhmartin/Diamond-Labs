import { PauseCircle } from "lucide-react";

/** Shown instead of Pay buttons during the cutover freeze. */
export function PaymentsPausedBanner() {
  return (
    <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>Payments are paused for an upgrade. You can still view and download your invoices; paying will be back shortly.</p>
    </div>
  );
}
