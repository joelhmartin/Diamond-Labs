import { useState, useEffect, useMemo } from "react";
import { X, CreditCard, Loader2 } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import api from "../../config/api.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const balanceOf = (inv) => round2(parseFloat(inv.total) || 0);
const idOf = (inv) => inv.id || inv.invoiceId;

export function PaymentModal({ invoices, onClose, onSuccess }) {
  const [method, setMethod] = useState("new"); // "new" | "saved"
  const [savedCards, setSavedCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [loadingCards, setLoadingCards] = useState(true);
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
        setSavedCards(data.data || []);
        if (data.data?.length > 0) setSelectedCard(data.data[0].paymentProfileId);
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

  const handleNewCardPayment = () => {
    if (!window.Accept) {
      addToast({ message: "Payment system not loaded. Please refresh and try again.", type: "error" });
      return;
    }
    const cardNumber = document.getElementById("pay-card-number")?.value;
    const expMonth = document.getElementById("pay-exp-month")?.value;
    const expYear = document.getElementById("pay-exp-year")?.value;
    const cvv = document.getElementById("pay-cvv")?.value;
    if (!cardNumber || !expMonth || !expYear || !cvv) {
      addToast({ message: "Please fill in all card fields.", type: "error" });
      return;
    }
    if (!canPay) {
      addToast({ message: "Enter an amount to pay.", type: "error" });
      return;
    }

    setProcessing(true);
    const authData = {
      clientKey: window.__AUTHORIZE_NET_CLIENT_KEY__,
      apiLoginID: window.__AUTHORIZE_NET_API_LOGIN__,
    };
    const cardData = {
      cardNumber: cardNumber.replace(/\s/g, ""),
      month: expMonth.padStart(2, "0"),
      year: expYear,
      cardCode: cvv,
    };

    window.Accept.dispatchData({ authData, cardData }, async (response) => {
      if (response.messages.resultCode === "Error") {
        addToast({ message: response.messages.message[0]?.text || "Card validation failed", type: "error" });
        setProcessing(false);
        return;
      }
      try {
        await api.post("/payments/charge", {
          opaqueData: response.opaqueData,
          amount: payTotal,
          allocations,
        });
        onSuccess();
      } catch (err) {
        addToast({ message: err.response?.data?.error?.message || "Payment failed", type: "error" });
      } finally {
        setProcessing(false);
      }
    });
  };

  const handleSavedCardPayment = () => {
    if (!selectedCard) {
      addToast({ message: "Select a card", type: "error" });
      return;
    }
    submit(() =>
      api.post("/payments/charge-saved", {
        paymentProfileId: selectedCard,
        amount: payTotal,
        allocations,
      })
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
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Card Number</label>
              <input
                id="pay-card-number"
                type="text"
                placeholder="4111 1111 1111 1111"
                maxLength={19}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Month</label>
                <input id="pay-exp-month" type="text" placeholder="MM" maxLength={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Year</label>
                <input id="pay-exp-year" type="text" placeholder="YYYY" maxLength={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">CVV</label>
                <input id="pay-cvv" type="text" placeholder="123" maxLength={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
            <Button onClick={handleNewCardPayment} loading={processing} disabled={!canPay} className="w-full">
              Pay ${payTotal.toFixed(2)}
            </Button>
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
