import { useState } from "react";
import { CreditCard, Star, Trash2, Plus, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { HostedAddCardForm } from "../doctor/HostedAddCardForm.jsx";
import { SectionCard } from "./PaymentSectionCard.jsx";
import { apiErrorMessage as errMsg, isGatewayError } from "../../lib/requests.js";

/** "Saved cards" card of the admin payment drawer: list, set default, delete, add on the hosted form. */
export function AdminCardsSection({ doctorUserId, cards, cardsUnavailable, onChanged }) {
  const { addToast } = useToast();
  const [showAddCard, setShowAddCard] = useState(false);
  const [cardBusy, setCardBusy] = useState(null); // profileId being acted on
  const [cardRowError, setCardRowError] = useState(null); // { profileId, message }

  const setDefaultCard = async (profileId) => {
    setCardBusy(profileId);
    setCardRowError(null);
    try {
      await api.put(`/admin/users/${doctorUserId}/saved-cards/${profileId}/default`);
      addToast({ message: "Default card updated.", type: "success" });
      onChanged();
    } catch (err) {
      const fallback = isGatewayError(err) ? "Could not reach the card processor. Try again shortly." : "Could not set default card.";
      addToast({ message: errMsg(err, fallback), type: "error" });
    } finally {
      setCardBusy(null);
    }
  };

  const deleteCard = async (profileId) => {
    setCardBusy(profileId);
    setCardRowError(null);
    try {
      await api.delete(`/admin/users/${doctorUserId}/saved-cards/${profileId}`);
      addToast({ message: "Card removed.", type: "success" });
      onChanged();
    } catch (err) {
      // 409 = this card is what the doctor's active AutoPay charges — a
      // generic failure toast would send the admin hunting for a bug that
      // isn't one. Name it plainly, right on the card row.
      if (err.response?.status === 409) {
        setCardRowError({ profileId, message: errMsg(err, "This card is used by an active AutoPay enrollment. Change the AutoPay card or cancel AutoPay first.") });
      } else if (isGatewayError(err)) {
        setCardRowError({ profileId, message: errMsg(err, "Could not reach the card processor. Please try again shortly.") });
      } else {
        addToast({ message: errMsg(err, "Could not remove card."), type: "error" });
      }
    } finally {
      setCardBusy(null);
    }
  };

  return (
    <SectionCard title="Saved cards" icon={CreditCard}>
      {cards.length === 0 && !cardsUnavailable && <p className="mb-2 text-xs text-navy/40">No cards on file.</p>}
      <div className="space-y-2">
        {cards.map((card) => {
          const busy = cardBusy === card.paymentProfileId;
          return (
            <div key={card.paymentProfileId}>
              <div className="flex items-center justify-between rounded-xl border border-surface-300/50 px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-navy/80">
                  <CreditCard size={14} className="text-navy/30" />
                  {card.cardType || "Card"} ****{card.cardNumber?.slice(-4)}
                  {card.isDefault && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">Default</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {!card.isDefault && (
                    <button type="button" title="Set as default" onClick={() => setDefaultCard(card.paymentProfileId)} disabled={busy}
                      className="rounded-lg p-1.5 text-navy/30 hover:bg-brand-50 hover:text-brand-600 disabled:opacity-50">
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}
                    </button>
                  )}
                  <button type="button" title="Delete card" onClick={() => deleteCard(card.paymentProfileId)} disabled={busy}
                    className="rounded-lg p-1.5 text-navy/30 hover:bg-red-50 hover:text-red-500 disabled:opacity-50">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
              {cardRowError?.profileId === card.paymentProfileId && <p className="mt-1 px-1 text-xs text-red-600">{cardRowError.message}</p>}
            </div>
          );
        })}
      </div>

      {!showAddCard ? (
        <button type="button" onClick={() => setShowAddCard(true)} disabled={cardsUnavailable}
          className="mt-3 flex items-center gap-1.5 rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy/70 hover:bg-surface-200 disabled:opacity-50">
          <Plus size={12} /> Add card
        </button>
      ) : (
        <div className="mt-3">
          <p className="mb-2 text-xs text-navy/50">
            The doctor's card is entered directly on Authorize.net's secure form below — it never touches this admin session.
          </p>
          <HostedAddCardForm
            tokenEndpoint={`/admin/users/${doctorUserId}/saved-cards/hosted-token`}
            onComplete={() => {
              setShowAddCard(false);
              onChanged();
              addToast({ message: "Card added.", type: "success" });
            }}
            onCancel={() => setShowAddCard(false)}
            onError={(msg) => {
              addToast({ message: msg || "Failed to add card.", type: "error" });
              setShowAddCard(false);
            }}
          />
        </div>
      )}
    </SectionCard>
  );
}
