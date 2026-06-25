import { useState, useEffect, useMemo } from "react";
import { X, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import { HostedPaymentForm } from "./HostedPaymentForm.jsx";
import api from "../../config/api.js";

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Use portalBalance (partial-payment-aware) when present; fall back to gross total for safety.
export const balanceOf = (inv) => round2(inv.portalBalance != null ? inv.portalBalance : (parseFloat(inv.total) || 0));
const idOf = (inv) => inv.id || inv.invoiceId;

export function PaymentModal({ invoices, onClose, onSuccess }) {
  const [method, setMethod] = useState("new"); // "new" | "saved"
  const [savedCards, setSavedCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [loadingCards, setLoadingCards] = useState(true);
  const [launched, setLaunched] = useState(false); // hosted card form shown?
  const [saveCard, setSaveCard] = useState(false); // "save this card" checkbox
  const { addToast } = useToast();

  // Oldest-due-first ordering drives FIFO auto-allocation.
  const ordered = useMemo(
    () => [...invoices].sort((a, b) => new Date(a.due || 0) - new Date(b.due || 0)),
    [invoices]
  );

  // alloc: { [invoiceId]: appliedAmount } — the source of truth for the charge.
  const [alloc, setAlloc] = useState(() =>
    Object.fromEntries(invoices.map((inv) => [idOf(inv), balanceOf(inv)]))
  );
  const totalBalance = useMemo(
    () => round2(invoices.reduce((s, inv) => s + balanceOf(inv), 0)),
    [invoices]
  );
  const [targetStr, setTargetStr] = useState(String(totalBalance.toFixed(2)));

  useEffect(() => {
    api.get("/payments/saved-cards")
      .then(({ data }) => {
        const list = data.data || [];
        setSavedCards(list);
        if (list.length > 0) {
          // Pre-select the doctor's default card, else the first.
          const preferred = list.find((c) => c.isDefault) || list[0];
          setSelectedCard(preferred.paymentProfileId);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingCards(false));
  }, []);

  // Distribute `target` across invoices oldest-first, capped at each balance.
  const autoAllocate = (target) => {
    let remaining = round2(Math.max(0, target));
    const next = {};
    for (const inv of ordered) {
      const bal = balanceOf(inv);
      const apply = round2(Math.min(bal, remaining));
      next[idOf(inv)] = apply;
      remaining = round2(remaining - apply);
    }
    setAlloc(next);
  };

  const handleTargetChange = (val) => {
    setTargetStr(val);
    const n = parseFloat(val);
    if (!Number.isNaN(n)) autoAllocate(n);
  };

  const setRow = (inv, val) => {
    const bal = balanceOf(inv);
    let n = parseFloat(val);
    if (Number.isNaN(n) || n < 0) n = 0;
    if (n > bal) n = bal;
    setAlloc((prev) => {
      const next = { ...prev, [idOf(inv)]: round2(n) };
      setTargetStr(
        String(round2(Object.values(next).reduce((s, v) => s + (v || 0), 0)).toFixed(2))
      );
      return next;
    });
  };

  const payTotal = round2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));

  const allocations = invoices
    .filter((inv) => (Number(alloc[idOf(inv)]) || 0) > 0)
    .map((inv) => ({
      invoiceId: idOf(inv),
      invoiceNumber: inv.invoiceNumber,
      amount: round2(alloc[idOf(inv)]),
    }));

  const canPay = payTotal > 0 && allocations.length > 0;

  const submit = async (charger) => {
    if (!canPay) {
      addToast({ message: "Enter an amount to pay.", type: "error" });
      return;
    }
    setProcessing(true);
    try {
      await charger();
      onSuccess();
    } catch (err) {
      addToast({ message: err.response?.data?.error?.message || "Payment failed", type: "error" });
    } finally {
      setProcessing(false);
    }
  };

  const handleSavedCardPayment = () => {
    if (!selectedCard) {
      addToast({ message: "Select a card", type: "error" });
      return;
    }
    // One idempotency key per submit attempt so a duplicate click / retry can't
    // double-charge the saved card (backend requires the header).
    const idempotencyKey = crypto.randomUUID();
    submit(() =>
      api.post(
        "/payments/charge-saved",
        {
          paymentProfileId: selectedCard,
          amount: payTotal,
          allocations,
        },
        { headers: { "Idempotency-Key": idempotencyKey } }
      )
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>

        <h3 className="mb-1 text-lg font-semibold">Pay Invoices</h3>
        <p className="mb-4 text-sm text-gray-500">
          {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} selected · balance ${totalBalance.toFixed(2)}
        </p>

        {/* Amount + allocation */}
        <div className="mb-5 rounded-xl border border-gray-200 p-4">
          <label className="mb-1 block text-xs font-medium text-gray-500">Amount to pay</label>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-gray-400">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={targetStr}
              onChange={(e) => handleTargetChange(e.target.value)}
              disabled={launched}
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 disabled:text-gray-400"
            />
            <span className="text-xs text-gray-400">applied oldest-first; adjust rows below</span>
          </div>

          <div className="max-h-44 space-y-1 overflow-y-auto">
            {ordered.map((inv) => {
              const bal = balanceOf(inv);
              const applied = round2(alloc[idOf(inv)] || 0);
              const label = applied <= 0 ? "" : applied >= bal ? "paid in full" : "partial";
              return (
                <div key={idOf(inv)} className="flex items-center gap-2 text-sm">
                  <span className="w-20 shrink-0 font-medium">#{inv.invoiceNumber || idOf(inv)}</span>
                  <span className="w-16 shrink-0 text-gray-400">${bal.toFixed(2)}</span>
                  <span className="text-gray-300">→</span>
                  <input
                    type="number"
                    min="0"
                    max={bal}
                    step="0.01"
                    value={applied}
                    onChange={(e) => setRow(inv, e.target.value)}
                    disabled={launched}
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                  {label && (
                    <span className={`text-xs ${applied >= bal ? "text-green-600" : "text-amber-600"}`}>
                      {label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Method tabs */}
        <div className="mb-5 flex gap-2">
          <button
            onClick={() => setMethod("new")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              method === "new" ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            New Card
          </button>
          <button
            onClick={() => setMethod("saved")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              method === "saved" ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            Saved Card {savedCards.length > 0 && `(${savedCards.length})`}
          </button>
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
                  <input
                    type="checkbox"
                    checked={saveCard}
                    onChange={(e) => setSaveCard(e.target.checked)}
                    className="accent-brand-600"
                  />
                  Save this card for later
                </label>
                <Button onClick={() => setLaunched(true)} disabled={!canPay} className="w-full">
                  Pay ${payTotal.toFixed(2)} with a card
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
              <p className="py-6 text-center text-sm text-gray-400">No saved cards. Use "New Card" to pay.</p>
            ) : (
              <>
                {savedCards.map((card) => (
                  <label key={card.paymentProfileId}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                      selectedCard === card.paymentProfileId ? "border-brand-500 bg-brand-50" : "border-gray-200 hover:bg-gray-50"
                    }`}>
                    <input type="radio" name="savedCard" value={card.paymentProfileId}
                      checked={selectedCard === card.paymentProfileId}
                      onChange={() => setSelectedCard(card.paymentProfileId)} className="accent-brand-600" />
                    <CreditCard className="h-5 w-5 text-gray-400" />
                    <span className="text-sm">{card.cardType || "Card"} ****{card.cardNumber?.slice(-4)}</span>
                    {card.isDefault && (
                      <span className="ml-auto rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                        Default
                      </span>
                    )}
                  </label>
                ))}
                <Button onClick={handleSavedCardPayment} loading={processing} disabled={!canPay} className="w-full">
                  Pay ${payTotal.toFixed(2)}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
