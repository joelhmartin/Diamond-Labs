import { useEffect, useState, useCallback, useRef } from "react";
import { X, Loader2, AlertCircle, AlertTriangle, RefreshCw } from "lucide-react";
import api from "../../config/api.js";
import { AdminCardsSection } from "./AdminCardsSection.jsx";
import { AdminChargeSection } from "./AdminChargeSection.jsx";
import { AdminRecordPaymentSection } from "./AdminRecordPaymentSection.jsx";
import { AdminAutopaySection } from "./AdminAutopaySection.jsx";
import { apiErrorMessage } from "../../lib/requests.js";

/**
 * One-place parity surface for a single doctor: saved cards, a charge on
 * behalf of them, a recorded (check/cash/ACH) payment, and full AutoPay
 * control (including the admin-only floor override). Opened from
 * AdminAutoPayPage's "Manage" row action and AdminUsersPage's "Payments" row
 * action. This file is the shell: it owns the loads; each panel is its own
 * component (Admin*Section).
 *
 * `doctor` — { userId, name, email, accountNumber }; invoices load from GET /admin/clients/:userId/invoices.
 */
export function DoctorPaymentDrawer({ doctor, onClose, onChanged, minAmount: minAmountProp }) {
  // Floor shown in the AutoPay form: the caller's value when it has one (the
  // AutoPay list page), else the one the per-doctor read returns (Users page).
  const [serverMinAmount, setServerMinAmount] = useState(null);
  const minAmount = minAmountProp ?? serverMinAmount;
  const panelRef = useRef(null);

  // Keyboard access: Escape closes, and focus moves into the dialog on open.
  // Runs once per mount (onClose read through a ref) — callers pass an inline
  // onClose, and re-running on every render would yank focus out of inputs.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardsUnavailable, setCardsUnavailable] = useState(false);
  const [enrollment, setEnrollment] = useState(null);

  const [invoices, setInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [invoicesUnavailable, setInvoicesUnavailable] = useState(false);
  // Bumped every time invoices are (re)fetched: remounts the charge panel with
  // a fresh allocation instead of holding balances from before a charge or a
  // recorded payment. This is money math; a stale allocation must not survive.
  const [invoiceGen, setInvoiceGen] = useState(0);

  // Combined enrollment + cards load: one snapshot for the cards, charge and AutoPay panels.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/users/${doctor.userId}/autopay`);
      setCards(data.data.cards || []);
      setCardsUnavailable(Boolean(data.data.cardsUnavailable));
      setEnrollment(data.data.enrollment || null);
      if (data.data.minAmount != null) setServerMinAmount(Number(data.data.minAmount));
      setLoadError(null);
    } catch (err) {
      setLoadError(apiErrorMessage(err, "Could not load this doctor's payment setup."));
    } finally {
      setLoading(false);
    }
  }, [doctor.userId]);

  // This doctor's open invoices, from our ledger.
  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    try {
      const { data } = await api.get(`/admin/clients/${doctor.userId}/invoices`, { params: { open: "true" } });
      setInvoices(data.data || []);
      setInvoicesUnavailable(false);
    } catch {
      setInvoicesUnavailable(true);
    } finally {
      setInvoicesLoading(false);
      setInvoiceGen((n) => n + 1);
    }
  }, [doctor.userId]);

  useEffect(() => {
    load();
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctor.userId]);

  const notifyChanged = () => {
    load();
    onChanged?.();
  };
  const afterMoneyMoved = () => {
    notifyChanged();
    loadInvoices();
  };

  const payableInvoices = invoices.filter((inv) => inv.balanceCents > 0);
  const invoiceProps = { invoices: payableInvoices, invoicesLoading, invoicesUnavailable };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Payments for ${doctor.name || doctor.email || "doctor"}`}
        tabIndex={-1}
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-surface-50 shadow-2xl focus:outline-none"
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
          <button type="button" onClick={onClose} className="text-navy/30 hover:text-navy" aria-label="Close">
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
              <button type="button" onClick={load} className="mt-3 rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600">
                Retry
              </button>
            </div>
          ) : (
            <>
              {cardsUnavailable && (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
                  <div className="flex-1">
                    We couldn't reach the payment system to list this doctor's cards. This is usually temporary — it does{" "}
                    <strong>not</strong> mean they have no cards on file.
                  </div>
                  <button type="button" onClick={load} className="flex items-center gap-1 whitespace-nowrap font-semibold text-amber-900 hover:underline">
                    <RefreshCw size={11} /> Retry
                  </button>
                </div>
              )}

              <AdminCardsSection doctorUserId={doctor.userId} cards={cards} cardsUnavailable={cardsUnavailable} onChanged={load} />
              <AdminChargeSection
                doctorUserId={doctor.userId}
                {...invoiceProps}
                invoiceGen={invoiceGen}
                cards={cards}
                cardsUnavailable={cardsUnavailable}
                onCharged={afterMoneyMoved}
              />
              <AdminRecordPaymentSection doctor={doctor} {...invoiceProps} onRecorded={afterMoneyMoved} />
              <AdminAutopaySection
                doctorUserId={doctor.userId}
                enrollment={enrollment}
                cards={cards}
                cardsUnavailable={cardsUnavailable}
                minAmount={minAmount}
                onChanged={notifyChanged}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
