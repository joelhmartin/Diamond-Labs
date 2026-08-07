import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { autopayEnrollSchema } from "@my-app/shared";
import {
  X,
  CreditCard,
  Star,
  Trash2,
  Plus,
  Loader2,
  Banknote,
  AlertCircle,
  AlertTriangle,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Repeat,
} from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { HostedAddCardForm } from "../doctor/HostedAddCardForm.jsx";
import { useInvoiceAllocation, balanceOf, idOf } from "../../hooks/useInvoiceAllocation.js";
// Reused rather than reinvented — the exact same flow AdminInvoicesPage.jsx
// uses per-invoice-row to record a payment staff already took directly in
// Seazona.
import { OfflinePaymentModal } from "../../pages/app/AdminInvoicesPage.jsx";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25 disabled:bg-surface-100 disabled:text-navy/40";

function formatUSD(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function errMsg(err, fallback) {
  return err.response?.data?.error?.message || fallback;
}

function isGatewayError(err) {
  return err.response?.status === 502;
}

function SectionCard({ title, icon: Icon, children }) {
  return (
    <div className="rounded-2xl border border-surface-300/50 bg-white p-4">
      <h4 className="mb-3 flex items-center gap-2 font-heading text-sm font-bold text-navy">
        {Icon && <Icon size={14} className="text-brand-500" />}
        {title}
      </h4>
      {children}
    </div>
  );
}

/**
 * Charge panel — oldest-due-first FIFO allocation across a doctor's open
 * invoices, reusing the exact allocation math from PaymentModal.jsx (via
 * useInvoiceAllocation) so the admin "charge on behalf of" flow can't drift
 * from what a doctor charging their own card would compute.
 *
 * `invoices` must be stable for this component's lifetime — see
 * useInvoiceAllocation.js. The parent only mounts this once the doctor's
 * invoice list has finished loading, matching that contract.
 */
function ChargePanel({ invoices, cards, cardsUnavailable, doctorUserId, onSuccess }) {
  const { addToast } = useToast();
  const [selectedCard, setSelectedCard] = useState(
    () => (cards.find((c) => c.isDefault) || cards[0])?.paymentProfileId || ""
  );
  const [processing, setProcessing] = useState(false);

  const { ordered, alloc, targetStr, totalBalance, handleTargetChange, setRow, payTotal, allocations, canPay } =
    useInvoiceAllocation(invoices);

  const charge = async () => {
    if (!selectedCard) {
      addToast({ message: "Select a card to charge.", type: "error" });
      return;
    }
    if (!canPay) {
      addToast({ message: "Enter an amount to charge.", type: "error" });
      return;
    }
    setProcessing(true);
    try {
      // Fresh key per submit attempt — a duplicate click / retry must not
      // double-charge the doctor's card (backend requires the header).
      const idempotencyKey = crypto.randomUUID();
      await api.post(
        `/admin/users/${doctorUserId}/payments/charge-saved`,
        { paymentProfileId: selectedCard, amount: payTotal, allocations },
        { headers: { "Idempotency-Key": idempotencyKey } }
      );
      addToast({ message: `Charged ${formatUSD(payTotal)}.`, type: "success" });
      onSuccess?.();
    } catch (err) {
      if (isGatewayError(err)) {
        addToast({ message: errMsg(err, "Could not reach the card processor. Please try again shortly."), type: "error" });
      } else if (err.response?.status === 409) {
        addToast({ message: errMsg(err, "This charge is already being processed."), type: "error" });
      } else {
        addToast({ message: errMsg(err, "Charge failed."), type: "error" });
      }
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-navy/40">$</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={targetStr}
          onChange={(e) => handleTargetChange(e.target.value)}
          disabled={processing}
          className={`${INPUT} w-28`}
        />
        <span className="text-xs text-navy/40">applied oldest-first · balance {formatUSD(totalBalance)}</span>
      </div>

      <div className="max-h-40 space-y-1 overflow-y-auto">
        {ordered.map((inv) => {
          const bal = balanceOf(inv);
          const applied = Number(alloc[idOf(inv)] || 0);
          return (
            <div key={idOf(inv)} className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0 font-mono text-xs text-navy/60">#{inv.invoiceNumber || idOf(inv)}</span>
              <span className="w-16 shrink-0 text-xs text-navy/40">{formatUSD(bal)}</span>
              <span className="text-navy/20">→</span>
              <input
                type="number"
                min="0"
                max={bal}
                step="0.01"
                value={applied}
                onChange={(e) => setRow(inv, e.target.value)}
                disabled={processing}
                className={`${INPUT} w-24 !py-1`}
              />
            </div>
          );
        })}
      </div>

      <select
        value={selectedCard}
        onChange={(e) => setSelectedCard(e.target.value)}
        disabled={processing || cards.length === 0}
        className={INPUT}
      >
        {cards.length === 0 && (
          <option value="">{cardsUnavailable ? "Couldn't check — try again" : "No cards on file"}</option>
        )}
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
        Charge {formatUSD(payTotal)}
      </button>
    </div>
  );
}

/**
 * One-place parity surface for a single doctor: saved cards, a charge on
 * behalf of them, an offline-payment record, and full AutoPay control
 * (including the admin-only floor override). Opened from AdminAutoPayPage's
 * "Manage" row action and AdminUsersPage's "Payments" row action.
 *
 * `doctor` — { userId, name, email, accountNumber }. `accountNumber` is used
 * to match this doctor's invoices out of the lab-wide /admin/invoices list
 * (there's no per-doctor invoice endpoint) — the seazonaClientId itself isn't
 * always known by callers (e.g. the AutoPay list doesn't select it), so we
 * match on the Seazona account number instead, which every caller has.
 */
export function DoctorPaymentDrawer({ doctor, onClose, onChanged, minAmount }) {
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardsUnavailable, setCardsUnavailable] = useState(false);
  const [enrollment, setEnrollment] = useState(null);

  const [invoices, setInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [invoicesUnavailable, setInvoicesUnavailable] = useState(false);
  // Bumped every time invoices are (re)fetched — used to force ChargePanel to
  // remount with a fresh FIFO allocation instead of holding onto stale
  // balances from before a charge or offline payment was recorded. This is
  // money math; a stale allocation surviving a balance change is not an
  // acceptable UX rough edge.
  const [invoiceGen, setInvoiceGen] = useState(0);

  const [showAddCard, setShowAddCard] = useState(false);
  const [cardBusy, setCardBusy] = useState(null); // profileId being acted on
  const [cardRowError, setCardRowError] = useState(null); // { profileId, message }

  const [offlineInvoiceId, setOfflineInvoiceId] = useState("");
  const [offlineModalInvoice, setOfflineModalInvoice] = useState(null);

  const [gatewayError, setGatewayError] = useState(false);
  const [overrideStr, setOverrideStr] = useState("");
  const [enabledChecked, setEnabledChecked] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(autopayEnrollSchema) });

  // Combined enrollment + cards load — same endpoint the "toggle enabled"
  // action on the list page uses, kept as the single source of truth here so
  // every panel (cards, charge, autopay) reflects one consistent snapshot.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/users/${doctor.userId}/autopay`);
      setCards(data.data.cards || []);
      setCardsUnavailable(Boolean(data.data.cardsUnavailable));
      setEnrollment(data.data.enrollment || null);
      setLoadError(null);
    } catch (err) {
      setLoadError(errMsg(err, "Could not load this doctor's payment setup."));
    } finally {
      setLoading(false);
    }
  }, [doctor.userId]);

  // There's no per-doctor invoice endpoint — /admin/invoices returns every
  // invoice in the lab. Filter to this doctor by matching the Seazona
  // account number embedded in the client record.
  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    try {
      const { data } = await api.get("/admin/invoices");
      const clients = data.data?.clients || {};
      const list = (data.data?.invoices || []).filter((inv) => {
        if (!doctor.accountNumber) return false;
        const client = clients[inv.clientId];
        return client?.accountNumber && String(client.accountNumber) === String(doctor.accountNumber);
      });
      setInvoices(list);
      setInvoicesUnavailable(Boolean(data.meta?.seazonaUnavailable));
    } catch {
      setInvoicesUnavailable(true);
    } finally {
      setInvoicesLoading(false);
      setInvoiceGen((n) => n + 1);
    }
  }, [doctor.accountNumber]);

  useEffect(() => {
    load();
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctor.userId]);

  // Prefill the AutoPay form whenever the enrollment/cards snapshot changes.
  useEffect(() => {
    if (loading) return;
    if (enrollment) {
      reset({
        amount: Number(enrollment.amount),
        dayOfMonth: enrollment.dayOfMonth,
        paymentProfileId: enrollment.paymentProfileId,
      });
      setOverrideStr(enrollment.minAmountOverride != null ? String(Number(enrollment.minAmountOverride)) : "");
      setEnabledChecked(Boolean(enrollment.enabled));
    } else if (cards.length > 0) {
      reset({ paymentProfileId: (cards.find((c) => c.isDefault) || cards[0]).paymentProfileId });
      setOverrideStr("");
      setEnabledChecked(false);
    }
  }, [enrollment, cards, loading, reset]);

  const notifyChanged = () => {
    load();
    onChanged?.();
  };

  // ── Cards ──
  const setDefaultCard = async (profileId) => {
    setCardBusy(profileId);
    setCardRowError(null);
    try {
      await api.put(`/admin/users/${doctor.userId}/saved-cards/${profileId}/default`);
      addToast({ message: "Default card updated.", type: "success" });
      load();
    } catch (err) {
      if (isGatewayError(err)) addToast({ message: errMsg(err, "Could not reach the card processor. Try again shortly."), type: "error" });
      else addToast({ message: errMsg(err, "Could not set default card."), type: "error" });
    } finally {
      setCardBusy(null);
    }
  };

  const deleteCard = async (profileId) => {
    setCardBusy(profileId);
    setCardRowError(null);
    try {
      await api.delete(`/admin/users/${doctor.userId}/saved-cards/${profileId}`);
      addToast({ message: "Card removed.", type: "success" });
      load();
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

  // ── AutoPay ──
  const onSubmitAutopay = async (form) => {
    setGatewayError(false);
    const override = overrideStr.trim() === "" ? null : Number(overrideStr);
    if (override != null && (!(override > 0) || Number.isNaN(override))) {
      addToast({ message: "Floor override must be a positive number.", type: "error" });
      return;
    }
    try {
      await api.put(`/admin/users/${doctor.userId}/autopay`, {
        amount: Number(form.amount),
        dayOfMonth: Number(form.dayOfMonth),
        paymentProfileId: form.paymentProfileId,
        minAmountOverride: override,
        enabled: enabledChecked,
      });
      addToast({ message: "AutoPay saved.", type: "success" });
      notifyChanged();
    } catch (err) {
      // A 502 means Authorize.net itself was unreachable — not that anything
      // the admin entered was invalid. Keep it out of the field-error path.
      if (isGatewayError(err)) {
        setGatewayError(true);
        addToast({ message: errMsg(err, "Could not reach the card processor. Please try again shortly."), type: "error" });
        return;
      }
      // 422 names the offending field (amount, dayOfMonth, or
      // paymentProfileId) and — for a floor violation — states the minimum
      // right in the message. Surface it on that field, not a generic toast.
      if (err.response?.status === 422) {
        const field = err.response.data?.error?.field || "amount";
        setError(field, { type: "server", message: err.response.data?.error?.message || "Invalid value." });
        return;
      }
      addToast({ message: errMsg(err, "Could not save AutoPay."), type: "error" });
    }
  };

  const cancelAutopay = async () => {
    setCancelling(true);
    try {
      await api.delete(`/admin/users/${doctor.userId}/autopay`);
      addToast({ message: "AutoPay cancelled.", type: "success" });
      notifyChanged();
    } catch (err) {
      addToast({ message: errMsg(err, "Could not cancel AutoPay."), type: "error" });
    } finally {
      setCancelling(false);
    }
  };

  const pauseResume = async (paused) => {
    setPauseBusy(true);
    try {
      await api.post(`/admin/users/${doctor.userId}/autopay/${paused ? "pause" : "resume"}`);
      addToast({ message: `AutoPay ${paused ? "paused" : "resumed"}.`, type: "success" });
      notifyChanged();
    } catch (err) {
      addToast({ message: errMsg(err, "Could not update AutoPay."), type: "error" });
    } finally {
      setPauseBusy(false);
    }
  };

  const payableInvoices = invoices.filter((inv) => !inv.portalPaid);
  const canPause = enrollment?.enabled && enrollment.status === "active";
  const canResume = enrollment?.enabled && enrollment.status === "paused";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-surface-50 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-surface-300/50 bg-white px-6 py-5">
          <div>
            <h3 className="font-heading text-lg font-bold text-navy">{doctor.name || doctor.email || "Doctor"}</h3>
            <p className="mt-0.5 text-xs text-navy/50">
              {doctor.email}
              {doctor.accountNumber && <span className="ml-2 font-mono text-navy/30">#{doctor.accountNumber}</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-navy/30 hover:text-navy">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-4 p-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-navy/40">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : loadError ? (
            <div className="py-16 text-center">
              <AlertCircle size={28} className="mx-auto mb-2 text-red-500/40" />
              <p className="text-sm text-navy/60">{loadError}</p>
              <button
                type="button"
                onClick={load}
                className="mt-3 rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {cardsUnavailable && (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
                  <div className="flex-1">
                    We couldn't reach the payment system to list this doctor's cards. This is usually
                    temporary — it does <strong>not</strong> mean they have no cards on file.
                  </div>
                  <button type="button" onClick={load} className="flex items-center gap-1 whitespace-nowrap font-semibold text-amber-900 hover:underline">
                    <RefreshCw size={11} /> Retry
                  </button>
                </div>
              )}

              {/* ── Saved cards ── */}
              <SectionCard title="Saved cards" icon={CreditCard}>
                {cards.length === 0 && !cardsUnavailable && (
                  <p className="mb-2 text-xs text-navy/40">No cards on file.</p>
                )}
                <div className="space-y-2">
                  {cards.map((card) => (
                    <div key={card.paymentProfileId}>
                      <div className="flex items-center justify-between rounded-xl border border-surface-300/50 px-3 py-2">
                        <div className="flex items-center gap-2 text-sm text-navy/80">
                          <CreditCard size={14} className="text-navy/30" />
                          {card.cardType || "Card"} ****{card.cardNumber?.slice(-4)}
                          {card.isDefault && (
                            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                              Default
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {!card.isDefault && (
                            <button
                              type="button"
                              title="Set as default"
                              onClick={() => setDefaultCard(card.paymentProfileId)}
                              disabled={cardBusy === card.paymentProfileId}
                              className="rounded-lg p-1.5 text-navy/30 hover:bg-brand-50 hover:text-brand-600 disabled:opacity-50"
                            >
                              {cardBusy === card.paymentProfileId ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}
                            </button>
                          )}
                          <button
                            type="button"
                            title="Delete card"
                            onClick={() => deleteCard(card.paymentProfileId)}
                            disabled={cardBusy === card.paymentProfileId}
                            className="rounded-lg p-1.5 text-navy/30 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                          >
                            {cardBusy === card.paymentProfileId ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      </div>
                      {cardRowError?.profileId === card.paymentProfileId && (
                        <p className="mt-1 px-1 text-xs text-red-600">{cardRowError.message}</p>
                      )}
                    </div>
                  ))}
                </div>

                {!showAddCard ? (
                  <button
                    type="button"
                    onClick={() => setShowAddCard(true)}
                    disabled={cardsUnavailable}
                    className="mt-3 flex items-center gap-1.5 rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy/70 hover:bg-surface-200 disabled:opacity-50"
                  >
                    <Plus size={12} /> Add card
                  </button>
                ) : (
                  <div className="mt-3">
                    <p className="mb-2 text-xs text-navy/50">
                      The doctor's card is entered directly on Authorize.net's secure form below — it
                      never touches this admin session.
                    </p>
                    <HostedAddCardForm
                      tokenEndpoint={`/admin/users/${doctor.userId}/saved-cards/hosted-token`}
                      onComplete={() => {
                        setShowAddCard(false);
                        load();
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

              {/* ── Charge a card ── */}
              <SectionCard title="Charge a card" icon={Banknote}>
                {!doctor.accountNumber ? (
                  <p className="text-xs text-navy/40">This doctor isn't linked to a Seazona client — nothing to charge.</p>
                ) : invoicesLoading ? (
                  <div className="flex items-center gap-2 py-4 text-xs text-navy/40">
                    <Loader2 size={14} className="animate-spin" /> Loading invoices…
                  </div>
                ) : invoicesUnavailable ? (
                  <p className="text-xs text-amber-700">Seazona is unreachable — the invoice list may be incomplete.</p>
                ) : payableInvoices.length === 0 ? (
                  <p className="text-xs text-navy/40">No open invoices for this doctor.</p>
                ) : (
                  <ChargePanel
                    key={`${doctor.userId}:${invoiceGen}`}
                    invoices={payableInvoices}
                    cards={cards}
                    cardsUnavailable={cardsUnavailable}
                    doctorUserId={doctor.userId}
                    onSuccess={() => {
                      notifyChanged();
                      loadInvoices();
                    }}
                  />
                )}
              </SectionCard>

              {/* ── Offline payment ── */}
              <SectionCard title="Record offline payment" icon={Banknote}>
                <p className="mb-2 text-xs text-navy/50">
                  For a payment staff already entered directly in Seazona — reflects the portal balance
                  only, no charge is made.
                </p>
                {invoicesLoading ? (
                  <div className="flex items-center gap-2 py-4 text-xs text-navy/40">
                    <Loader2 size={14} className="animate-spin" /> Loading invoices…
                  </div>
                ) : invoicesUnavailable ? (
                  <p className="text-xs text-amber-700">
                    Seazona is unreachable — can't tell whether this doctor has open invoices. This is
                    not the same as owing nothing; try again shortly.
                  </p>
                ) : payableInvoices.length === 0 ? (
                  <p className="text-xs text-navy/40">No open invoices to record against.</p>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={offlineInvoiceId}
                      onChange={(e) => setOfflineInvoiceId(e.target.value)}
                      className={`${INPUT} flex-1`}
                    >
                      <option value="">Select an invoice…</option>
                      {payableInvoices.map((inv) => (
                        <option key={idOf(inv)} value={idOf(inv)}>
                          #{inv.invoiceNumber || idOf(inv)} — {formatUSD(balanceOf(inv))} due
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!offlineInvoiceId}
                      onClick={() => setOfflineModalInvoice(payableInvoices.find((inv) => idOf(inv) === offlineInvoiceId))}
                      className="whitespace-nowrap rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy/70 hover:bg-surface-200 disabled:opacity-50"
                    >
                      Record
                    </button>
                  </div>
                )}
              </SectionCard>

              {/* ── AutoPay ── */}
              <SectionCard title="AutoPay" icon={Repeat}>
                {enrollment && (
                  <div className="mb-3 flex items-center justify-between rounded-xl bg-surface-100 px-3 py-2 text-xs">
                    <span className="font-semibold text-navy/70">
                      {!enrollment.enabled
                        ? "Disabled"
                        : enrollment.status === "paused"
                          ? `Paused${enrollment.pausedReason ? ` — ${enrollment.pausedReason}` : ""}`
                          : enrollment.status === "completed"
                            ? "Completed"
                            : "Active"}
                      {enrollment.consecutiveFailures > 0 && (
                        <span className="ml-2 text-red-600">{enrollment.consecutiveFailures} consecutive failure(s)</span>
                      )}
                    </span>
                    {(canPause || canResume) && (
                      <button
                        type="button"
                        onClick={() => pauseResume(canPause)}
                        disabled={pauseBusy}
                        className="flex items-center gap-1 font-semibold text-navy/60 hover:text-navy disabled:opacity-50"
                      >
                        {pauseBusy ? <Loader2 size={11} className="animate-spin" /> : canPause ? <PauseCircle size={11} /> : <PlayCircle size={11} />}
                        {canPause ? "Pause" : "Resume"}
                      </button>
                    )}
                  </div>
                )}

                {gatewayError && (
                  <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>
                      Could not reach the card processor — this wasn't a problem with what was entered.
                      Please try again shortly.
                    </span>
                  </div>
                )}

                <form onSubmit={handleSubmit(onSubmitAutopay)} className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-navy/40">
                      Monthly amount{minAmount != null && ` (lab minimum ${formatUSD(minAmount)})`}
                    </label>
                    <input type="number" step="0.01" min="0" className={INPUT} {...register("amount", { valueAsNumber: true })} />
                    {errors.amount?.message && <p className="mt-1 text-xs text-red-600">{errors.amount.message}</p>}
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-navy/40">
                      Floor override (admin only — optional)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={minAmount != null ? `Defaults to ${formatUSD(minAmount)}` : "Defaults to the lab minimum"}
                      value={overrideStr}
                      onChange={(e) => setOverrideStr(e.target.value)}
                      className={INPUT}
                    />
                    <p className="mt-1 text-[11px] text-navy/40">
                      Lets this doctor enroll below the standard minimum. Leave blank to use the lab default.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-navy/40">Day of month</label>
                    <input type="number" min={1} max={31} className={INPUT} {...register("dayOfMonth", { valueAsNumber: true })} />
                    {errors.dayOfMonth?.message && <p className="mt-1 text-xs text-red-600">{errors.dayOfMonth.message}</p>}
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-navy/40">Card</label>
                    <select className={INPUT} disabled={cards.length === 0} {...register("paymentProfileId")}>
                      {cards.length === 0 && (
                        <option value="">{cardsUnavailable ? "Couldn't check — try again" : "No cards on file"}</option>
                      )}
                      {cards.map((c) => (
                        <option key={c.paymentProfileId} value={c.paymentProfileId}>
                          {c.cardType || "Card"} ****{c.cardNumber?.slice(-4)} — exp {c.expirationDate}
                        </option>
                      ))}
                    </select>
                    {errors.paymentProfileId?.message && <p className="mt-1 text-xs text-red-600">{errors.paymentProfileId.message}</p>}
                  </div>

                  <label className="flex cursor-pointer items-center gap-2 text-sm text-navy/70">
                    <input
                      type="checkbox"
                      checked={enabledChecked}
                      onChange={(e) => setEnabledChecked(e.target.checked)}
                      className="accent-brand-600"
                    />
                    Enabled
                  </label>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={isSubmitting || cards.length === 0}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white transition-all hover:bg-brand-600 disabled:opacity-50"
                    >
                      {isSubmitting && <Loader2 size={12} className="animate-spin" />}
                      {enrollment ? "Save AutoPay" : "Enroll in AutoPay"}
                    </button>
                    {enrollment && (
                      <button
                        type="button"
                        onClick={cancelAutopay}
                        disabled={cancelling}
                        className="flex items-center justify-center gap-1.5 rounded-full bg-surface-100 px-4 py-2.5 text-xs font-semibold text-navy/60 transition-all hover:bg-surface-200 disabled:opacity-50"
                      >
                        {cancelling && <Loader2 size={12} className="animate-spin" />}
                        Cancel AutoPay
                      </button>
                    )}
                  </div>
                </form>
              </SectionCard>
            </>
          )}
        </div>
      </div>

      {offlineModalInvoice && (
        <OfflinePaymentModal
          invoice={offlineModalInvoice}
          onClose={() => setOfflineModalInvoice(null)}
          onRecorded={() => {
            notifyChanged();
            loadInvoices();
            setOfflineInvoiceId("");
          }}
        />
      )}
    </div>
  );
}
