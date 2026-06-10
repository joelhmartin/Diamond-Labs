import { useEffect, useState, useCallback } from "react";
import { CreditCard, Pencil, Plus, Trash2, X, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { HostedAddCardForm } from "../../components/doctor/HostedAddCardForm.jsx";

export function SavedCardsPage() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);         // paymentProfileId being deleted
  const [showAddCard, setShowAddCard] = useState(false);  // add-card modal open?
  const [editingCard, setEditingCard] = useState(null);   // paymentProfileId open for edit
  const [editExpiry, setEditExpiry] = useState("");       // MM/YYYY input value
  const [saving, setSaving] = useState(false);            // edit-expiry submit in flight
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchCards(); }, [fetchCards]);

  const handleDelete = async (paymentProfileId) => {
    setDeleting(paymentProfileId);
    try {
      await api.delete(`/payments/saved-cards/${paymentProfileId}`);
      setCards((prev) => prev.filter((c) => c.paymentProfileId !== paymentProfileId));
      if (editingCard === paymentProfileId) setEditingCard(null);
      addToast({ message: "Card removed", type: "success" });
    } catch {
      addToast({ message: "Failed to remove card", type: "error" });
    } finally {
      setDeleting(null);
    }
  };

  /** Validate MM/YYYY → YYYY-MM and PUT the updated expiry. */
  const handleSaveExpiry = async (paymentProfileId) => {
    const match = editExpiry.trim().match(/^(\d{2})\/(\d{4})$/);
    if (!match) {
      addToast({ message: "Expiry must be MM/YYYY (e.g. 09/2027)", type: "error" });
      return;
    }
    const [, mm, yyyy] = match;
    const month = parseInt(mm, 10);
    if (month < 1 || month > 12) {
      addToast({ message: "Month must be between 01 and 12", type: "error" });
      return;
    }
    const now = new Date();
    const y = parseInt(yyyy, 10);
    if (y < now.getFullYear() || (y === now.getFullYear() && month < now.getMonth() + 1)) {
      addToast({ message: "Expiry date is in the past", type: "error" });
      return;
    }
    const expirationDate = `${yyyy}-${mm}`;

    setSaving(true);
    try {
      await api.put(`/payments/saved-cards/${paymentProfileId}`, { expirationDate });
      setEditingCard(null);
      await fetchCards();
      addToast({ message: "Card updated", type: "success" });
    } catch (err) {
      addToast({
        message: err.response?.data?.error?.message || "Failed to update card",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (card) => {
    if (editingCard === card.paymentProfileId) {
      setEditingCard(null);
      return;
    }
    setEditingCard(card.paymentProfileId);
    setEditExpiry(""); // expiry is masked at the gateway; user must type a new one
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Saved Cards</h1>
            <p className="text-sm text-gray-500">Manage your payment methods</p>
          </div>
          <Button onClick={() => setShowAddCard(true)} variant="secondary">
            <Plus className="mr-2 h-4 w-4" />
            Add Card
          </Button>
        </div>

        {cards.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
            <CreditCard className="mx-auto mb-3 h-8 w-8 text-gray-300" />
            <p className="text-gray-500">No saved cards. Add one to pay invoices quickly.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cards.map((card) => (
              <div
                key={card.paymentProfileId}
                className="rounded-xl border border-gray-200 bg-white px-5 py-4"
              >
                {/* Card row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <CreditCard className="h-6 w-6 shrink-0 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium">
                        {card.cardType || "Card"} ending in {card.cardNumber?.slice(-4) || "****"}
                      </p>
                      {card.expirationDate && (
                        <p className="text-xs text-gray-400">Expires {card.expirationDate}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(card)}
                      title="Edit expiration"
                      aria-label="Edit expiration date"
                      className={`rounded-lg p-2 transition-colors ${
                        editingCard === card.paymentProfileId
                          ? "bg-blue-50 text-blue-500"
                          : "text-gray-400 hover:bg-blue-50 hover:text-blue-500"
                      }`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
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
                </div>

                {/* Inline edit form — shown when this card is being edited */}
                {editingCard === card.paymentProfileId && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <p className="mb-2 text-xs font-medium text-gray-500">
                      Update expiration date
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        placeholder="MM/YYYY"
                        value={editExpiry}
                        onChange={(e) => setEditExpiry(e.target.value)}
                        maxLength={7}
                        className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSaveExpiry(card.paymentProfileId)}
                        loading={saving}
                        disabled={!editExpiry.trim()}
                      >
                        Save
                      </Button>
                      <button
                        onClick={() => setEditingCard(null)}
                        className="text-sm text-gray-400 hover:text-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add-card modal — hosted Authorize.net iframe (SAQ A) */}
      {showAddCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            style={{ maxHeight: "90vh" }}
          >
            <button
              onClick={() => setShowAddCard(false)}
              aria-label="Close"
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="mb-1 text-lg font-semibold">Add a Card</h3>
            <p className="mb-4 text-sm text-gray-500">
              Card details are entered on Authorize.net's secure form — they never touch this site.
            </p>

            <HostedAddCardForm
              onComplete={() => {
                setShowAddCard(false);
                fetchCards();
                addToast({ message: "Card saved successfully", type: "success" });
              }}
              onCancel={() => setShowAddCard(false)}
              onError={(msg) => {
                addToast({ message: msg || "Failed to add card", type: "error" });
                setShowAddCard(false);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
