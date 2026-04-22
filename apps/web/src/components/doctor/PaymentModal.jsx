import { useState, useEffect } from "react";
import { X, CreditCard, Loader2 } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { useToast } from "../ui/Toast.jsx";
import api from "../../config/api.js";

export function PaymentModal({ invoices, total, onClose, onSuccess }) {
  const [method, setMethod] = useState("new"); // "new" | "saved"
  const [savedCards, setSavedCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [loadingCards, setLoadingCards] = useState(true);
  const { addToast } = useToast();

  useEffect(() => {
    api.get("/payments/saved-cards")
      .then(({ data }) => {
        setSavedCards(data.data || []);
        if (data.data?.length > 0) {
          setSelectedCard(data.data[0].paymentProfileId);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingCards(false));
  }, []);

  const invoiceIds = invoices.map((inv) => inv.id || inv.invoiceId);

  const handleNewCardPayment = async () => {
    // Use Accept.js to get the nonce
    if (!window.Accept) {
      addToast({ message: "Payment system not loaded. Please refresh and try again.", type: "error" });
      return;
    }

    // Collect card data from the form
    const cardNumber = document.getElementById("pay-card-number")?.value;
    const expMonth = document.getElementById("pay-exp-month")?.value;
    const expYear = document.getElementById("pay-exp-year")?.value;
    const cvv = document.getElementById("pay-cvv")?.value;

    if (!cardNumber || !expMonth || !expYear || !cvv) {
      addToast({ message: "Please fill in all card fields.", type: "error" });
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

    window.Accept.dispatchData(
      { authData, cardData },
      async (response) => {
        if (response.messages.resultCode === "Error") {
          const msg = response.messages.message[0]?.text || "Card validation failed";
          addToast({ message: msg, type: "error" });
          setProcessing(false);
          return;
        }

        try {
          await api.post("/payments/charge", {
            opaqueData: response.opaqueData,
            amount: total,
            invoiceIds,
          });
          onSuccess();
        } catch (err) {
          addToast({ message: err.response?.data?.error?.message || "Payment failed", type: "error" });
        } finally {
          setProcessing(false);
        }
      }
    );
  };

  const handleSavedCardPayment = async () => {
    if (!selectedCard) {
      addToast({ message: "Select a card", type: "error" });
      return;
    }

    setProcessing(true);
    try {
      await api.post("/payments/charge-saved", {
        paymentProfileId: selectedCard,
        amount: total,
        invoiceIds,
      });
      onSuccess();
    } catch (err) {
      addToast({ message: err.response?.data?.error?.message || "Payment failed", type: "error" });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>

        <h3 className="mb-1 text-lg font-semibold">Pay Invoices</h3>
        <p className="mb-5 text-sm text-gray-500">
          {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} — Total: <span className="font-semibold text-gray-900">${total.toFixed(2)}</span>
        </p>

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
                <input
                  id="pay-exp-month"
                  type="text"
                  placeholder="MM"
                  maxLength={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Year</label>
                <input
                  id="pay-exp-year"
                  type="text"
                  placeholder="YYYY"
                  maxLength={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">CVV</label>
                <input
                  id="pay-cvv"
                  type="text"
                  placeholder="123"
                  maxLength={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>
            <Button onClick={handleNewCardPayment} loading={processing} className="w-full">
              Pay ${total.toFixed(2)}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {loadingCards ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : savedCards.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">No saved cards. Use "New Card" to pay.</p>
            ) : (
              <>
                {savedCards.map((card) => (
                  <label
                    key={card.paymentProfileId}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                      selectedCard === card.paymentProfileId ? "border-brand-500 bg-brand-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="savedCard"
                      value={card.paymentProfileId}
                      checked={selectedCard === card.paymentProfileId}
                      onChange={() => setSelectedCard(card.paymentProfileId)}
                      className="accent-brand-600"
                    />
                    <CreditCard className="h-5 w-5 text-gray-400" />
                    <span className="text-sm">
                      {card.cardType || "Card"} ****{card.cardNumber?.slice(-4)}
                    </span>
                  </label>
                ))}
                <Button onClick={handleSavedCardPayment} loading={processing} className="w-full">
                  Pay ${total.toFixed(2)}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
