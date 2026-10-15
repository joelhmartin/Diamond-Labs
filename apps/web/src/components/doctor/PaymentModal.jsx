import { useState, useEffect } from "react";
import { X, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import { HostedPaymentForm } from "./HostedPaymentForm.jsx";
import { useInvoiceAllocation } from "../../hooks/useInvoiceAllocation.js";
import { formatCents } from "../../lib/money.js";
import api from "../../config/api.js";

/**
 * Pay one or more of the doctor's invoices: a new card on Authorize.net's
 * hosted form (card data never touches this site) or a saved card.
 * `invoices`: [{ id, invoiceNumber, balanceCents, dueDate }]. Money is cents.
 */
export function PaymentModal({ invoices, onClose, onSuccess }) {
  const [method, setMethod] = useState("new"); // "new" | "saved"
  const [savedCards, setSavedCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [loadingCards, setLoadingCards] = useState(true);
  const [launched, setLaunched] = useState(false); // hosted card form shown?
  const [saveCard, setSaveCard] = useState(false);
  const { addToast } = useToast();

  const { ordered, alloc, targetStr, totalBalanceCents, handleTargetChange, setRow, payTotalCents, allocations, canPay } =
    useInvoiceAllocation(invoices);

  useEffect(() => {
    api.get("/payments/saved-cards")
      .then(({ data }) => {
        const list = data.data || [];
        setSavedCards(list);
        if (list.length > 0) setSelectedCard((list.find((c) => c.isDefault) || list[0]).paymentProfileId);
      })
      .catch(() => {})
      .finally(() => setLoadingCards(false));
  }, []);

  const payWithSavedCard = async () => {
    if (!selectedCard) {
      addToast({ message: "Select a card", type: "error" });
      return;
    }
    if (!canPay) {
      addToast({ message: "Enter an amount to pay.", type: "error" });
      return;
    }
    setProcessing(true);
    try {
      // One idempotency key per submit, so a double click or retry can't double-charge.
      await api.post(
        "/payments/charge-saved",
        { paymentProfileId: selectedCard, amountCents: payTotalCents, allocations },
        { headers: { "Idempotency-Key": crypto.randomUUID() } }
      );
      onSuccess();
    } catch (err) {
      addToast({ message: err.response?.data?.error?.message || "Payment failed", type: "error" });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600" aria-label="Close">
          <X className="h-5 w-5" />
        </button>

        <h3 className="mb-1 text-lg font-semibold">Pay invoices</h3>
        <p className="mb-4 text-sm text-gray-500">
          {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} selected · balance {formatCents(totalBalanceCents)}
        </p>

        <div className="mb-5 rounded-xl border border-gray-200 p-4">
          <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="pay-amount">Amount to pay</label>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-gray-400">$</span>
            <input
              id="pay-amount"
              type="text"
              inputMode="decimal"
              value={targetStr}
              onChange={(e) => handleTargetChange(e.target.value)}
              disabled={launched}
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 disabled:text-gray-400"
            />
            <span className="text-xs text-gray-400">applied oldest-first; adjust rows below</span>
          </div>

          <div className="max-h-44 space-y-1 overflow-y-auto">
            {ordered.map((inv) => {
              const applied = alloc[inv.id] ?? 0;
              const label = applied <= 0 ? "" : applied >= inv.balanceCents ? "paid in full" : "partial";
              return (
                <div key={inv.id} className="flex items-center gap-2 text-sm">
                  <span className="w-20 shrink-0 font-medium">#{inv.invoiceNumber}</span>
                  <span className="w-20 shrink-0 text-gray-400">{formatCents(inv.balanceCents)}</span>
                  <span className="text-gray-300">→</span>
                  <input
                    type="number"
                    min="0"
                    max={inv.balanceCents / 100}
                    step="0.01"
                    value={applied / 100}
                    onChange={(e) => setRow(inv, e.target.value)}
                    disabled={launched}
                    aria-label={`Amount for invoice ${inv.invoiceNumber}`}
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                  {label && <span className={`text-xs ${applied >= inv.balanceCents ? "text-green-600" : "text-amber-600"}`}>{label}</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mb-5 flex gap-2">
          {[["new", "New card"], ["saved", `Saved card${savedCards.length ? ` (${savedCards.length})` : ""}`]].map(([value, text]) => (
            <button
              key={value}
              onClick={() => setMethod(value)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                method === value ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {text}
            </button>
          ))}
        </div>

        {method === "new" ? (
          <div className="space-y-3">
            {!launched ? (
              <>
                <div className="flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <span>Card details are entered on Authorize.net's secure form — they never touch this site.</span>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} className="accent-brand-600" />
                  Save this card for later
                </label>
                <Button onClick={() => setLaunched(true)} disabled={!canPay} className="w-full">
                  Pay {formatCents(payTotalCents)} with a card
                </Button>
              </>
            ) : (
              <HostedPaymentForm
                tokenEndpoint="/payments/hosted-token"
                completeEndpoint="/payments/hosted-complete"
                tokenBody={{ allocations, saveCard }}
                completeBody={{ allocations }}
                onComplete={() => onSuccess()}
                onError={(msg) => {
                  addToast({ message: msg, type: "error" });
                  setLaunched(false);
                }}
              />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {loadingCards ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
            ) : savedCards.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">No saved cards. Use "New card" to pay.</p>
            ) : (
              <>
                {savedCards.map((card) => (
                  <label
                    key={card.paymentProfileId}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                      selectedCard === card.paymentProfileId ? "border-brand-500 bg-brand-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <input type="radio" name="savedCard" value={card.paymentProfileId} checked={selectedCard === card.paymentProfileId}
                      onChange={() => setSelectedCard(card.paymentProfileId)} className="accent-brand-600" />
                    <CreditCard className="h-5 w-5 text-gray-400" />
                    <span className="text-sm">{card.cardType || "Card"} ****{card.cardNumber?.slice(-4)}</span>
                    {card.isDefault && (
                      <span className="ml-auto rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">Default</span>
                    )}
                  </label>
                ))}
                <Button onClick={payWithSavedCard} loading={processing} disabled={!canPay} className="w-full">
                  Pay {formatCents(payTotalCents)}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
