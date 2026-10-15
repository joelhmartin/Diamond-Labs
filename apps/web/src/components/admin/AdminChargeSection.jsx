import { useEffect, useState } from "react";
import { Loader2, Banknote } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { AllocationRows } from "../billing/AllocationRows.jsx";
import { SectionCard, InvoicesGate, DRAWER_INPUT as INPUT } from "./PaymentSectionCard.jsx";
import { useInvoiceAllocation } from "../../hooks/useInvoiceAllocation.js";
import { formatCents } from "../../lib/money.js";
import { apiErrorMessage as errMsg, isGatewayError } from "../../lib/requests.js";

/**
 * Oldest-due-first allocation across a doctor's open invoices, using the same
 * hook (and so the same math) as the doctor's own PaymentModal, so "charge on
 * behalf of" can't drift from what the doctor would compute.
 *
 * `invoices` must be stable for this component's lifetime (see
 * useInvoiceAllocation); the section remounts it with a new key whenever the
 * invoice list reloads.
 */
function ChargePanel({ invoices, cards, cardsUnavailable, doctorUserId, onSuccess }) {
  const { addToast } = useToast();
  const [selectedCard, setSelectedCard] = useState(() => (cards.find((c) => c.isDefault) || cards[0])?.paymentProfileId || "");
  const [processing, setProcessing] = useState(false);

  // Card actions reload `cards` without remounting this panel; if the selected
  // card was deleted, fall back so the <select> and the charge agree.
  useEffect(() => {
    if (cards.some((c) => c.paymentProfileId === selectedCard)) return;
    setSelectedCard((cards.find((c) => c.isDefault) || cards[0])?.paymentProfileId || "");
  }, [cards, selectedCard]);

  const { ordered, alloc, targetStr, totalBalanceCents, handleTargetChange, setRow, payTotalCents, allocations, canPay } =
    useInvoiceAllocation(invoices);
  // Rows can belong to a practice colleague; say so rather than let staff charge them blind.
  const allOwn = ordered.every((inv) => inv.clientUserId === doctorUserId);

  const charge = async () => {
    if (!selectedCard) return addToast({ message: "Select a card to charge.", type: "error" });
    if (!canPay) return addToast({ message: "Enter an amount to charge.", type: "error" });
    setProcessing(true);
    try {
      // Fresh key per submit: a duplicate click or retry must not double-charge.
      await api.post(
        `/admin/users/${doctorUserId}/payments/charge-saved`,
        { paymentProfileId: selectedCard, amountCents: payTotalCents, allocations },
        { headers: { "Idempotency-Key": crypto.randomUUID() } }
      );
      addToast({ message: `Charged ${formatCents(payTotalCents)}.`, type: "success" });
      onSuccess?.();
    } catch (err) {
      const fallback = isGatewayError(err)
        ? "Could not reach the card processor. Please try again shortly."
        : err.response?.status === 409 ? "This charge is already being processed." : "Charge failed.";
      addToast({ message: errMsg(err, fallback), type: "error" });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-navy/40">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={targetStr}
          onChange={(e) => handleTargetChange(e.target.value)}
          disabled={processing}
          aria-label="Amount to charge"
          className={`${INPUT} w-28`}
        />
        <span className="text-xs text-navy/40">applied oldest-first · {allOwn ? "open balance" : "practice open balance"} {formatCents(totalBalanceCents)}</span>
      </div>

      <AllocationRows
        rows={ordered}
        showOwner={!allOwn}
        valueOf={(inv) => (alloc[inv.id] ?? 0) / 100}
        onChange={setRow}
        disabled={processing}
        className="max-h-40"
      />

      <select value={selectedCard} onChange={(e) => setSelectedCard(e.target.value)} disabled={processing || cards.length === 0} className={INPUT}>
        {cards.length === 0 && <option value="">{cardsUnavailable ? "Couldn't check — try again" : "No cards on file"}</option>}
        {cards.map((c) => (
          <option key={c.paymentProfileId} value={c.paymentProfileId}>
            {c.cardType || "Card"} ****{c.cardNumber?.slice(-4)} — exp {c.expirationDate}
            {c.isDefault ? " (default)" : ""}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={charge}
        disabled={processing || !canPay || cards.length === 0}
        className="flex w-full items-center justify-center gap-1.5 rounded-full bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white transition-all hover:bg-brand-600 disabled:opacity-50"
      >
        {processing && <Loader2 size={12} className="animate-spin" />}
        Charge {formatCents(payTotalCents)}
      </button>
    </div>
  );
}

/** "Charge a card" card of the admin payment drawer: charge a saved card on the doctor's behalf. */
export function AdminChargeSection({ doctorUserId, invoices, invoicesLoading, invoicesUnavailable, invoiceGen, cards, cardsUnavailable, onCharged }) {
  return (
    <SectionCard title="Charge a card" icon={Banknote}>
      <InvoicesGate loading={invoicesLoading} unavailable={invoicesUnavailable} empty={invoices.length === 0} emptyText="No open invoices for this doctor.">
        <ChargePanel
          key={`${doctorUserId}:${invoiceGen}`}
          invoices={invoices}
          cards={cards}
          cardsUnavailable={cardsUnavailable}
          doctorUserId={doctorUserId}
          onSuccess={onCharged}
        />
      </InvoicesGate>
    </SectionCard>
  );
}
