import { useEffect, useState, useCallback } from "react";
import { CreditCard, Plus, Trash2, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Button } from "../../components/ui/Button.jsx";

export function SavedCardsPage() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const { addToast } = useToast();

  const fetchCards = useCallback(async () => {
    try {
      const { data } = await api.get("/payments/saved-cards");
      setCards(data.data || []);
    } catch {
      addToast({ message: "Failed to load saved cards", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  const handleDelete = async (paymentProfileId) => {
    setDeleting(paymentProfileId);
    try {
      await api.delete(`/payments/saved-cards/${paymentProfileId}`);
      setCards((prev) => prev.filter((c) => c.paymentProfileId !== paymentProfileId));
      addToast({ message: "Card removed", type: "success" });
    } catch {
      addToast({ message: "Failed to remove card", type: "error" });
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Saved Cards</h1>
          <p className="text-sm text-gray-500">Manage your payment methods</p>
        </div>
        <Button
          onClick={() => addToast({ message: "Use the payment modal on the Invoices page to add a new card.", type: "info" })}
          variant="outline"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Card
        </Button>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <CreditCard className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-gray-500">No saved cards. Cards are saved when you make a payment.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map((card) => (
            <div
              key={card.paymentProfileId}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-4"
            >
              <div className="flex items-center gap-4">
                <CreditCard className="h-6 w-6 text-gray-400" />
                <div>
                  <p className="text-sm font-medium">
                    {card.cardType || "Card"} ending in {card.cardNumber?.slice(-4) || "****"}
                  </p>
                  {card.expirationDate && (
                    <p className="text-xs text-gray-400">Expires {card.expirationDate}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(card.paymentProfileId)}
                disabled={deleting === card.paymentProfileId}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
              >
                {deleting === card.paymentProfileId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
