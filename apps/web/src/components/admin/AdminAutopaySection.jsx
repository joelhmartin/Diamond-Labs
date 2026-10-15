import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { autopayEnrollSchema } from "@my-app/shared";
import { Loader2, AlertTriangle, PauseCircle, PlayCircle, Repeat } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { SectionCard, DRAWER_INPUT as INPUT } from "./PaymentSectionCard.jsx";
import { apiErrorMessage as errMsg, isGatewayError } from "../../lib/requests.js";

// AutoPay's enrollment amounts are still dollars (numeric columns); invoice money is cents.
const formatUSD = (n) => Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const LABEL = "mb-1 block text-[10px] font-mono uppercase tracking-widest text-navy/40";

function EnrollmentStatus({ enrollment, busy, onPauseResume }) {
  const canPause = enrollment.enabled && enrollment.status === "active";
  const canResume = enrollment.enabled && enrollment.status === "paused";
  const word = !enrollment.enabled
    ? "Disabled"
    : enrollment.status === "paused"
      ? `Paused${enrollment.pausedReason ? ` — ${enrollment.pausedReason}` : ""}`
      : enrollment.status === "completed" ? "Completed" : "Active";
  return (
    <div className="mb-3 flex items-center justify-between rounded-xl bg-surface-100 px-3 py-2 text-xs">
      <span className="font-semibold text-navy/70">
        {word}
        {enrollment.consecutiveFailures > 0 && <span className="ml-2 text-red-600">{enrollment.consecutiveFailures} consecutive failure(s)</span>}
      </span>
      {(canPause || canResume) && (
        <button type="button" onClick={() => onPauseResume(canPause)} disabled={busy}
          className="flex items-center gap-1 font-semibold text-navy/60 hover:text-navy disabled:opacity-50">
          {busy ? <Loader2 size={11} className="animate-spin" /> : canPause ? <PauseCircle size={11} /> : <PlayCircle size={11} />}
          {canPause ? "Pause" : "Resume"}
        </button>
      )}
    </div>
  );
}

/** "AutoPay" card of the admin payment drawer: enroll or change, pause/resume, cancel, and the admin-only floor override. */
export function AdminAutopaySection({ doctorUserId, enrollment, cards, cardsUnavailable, minAmount, onChanged }) {
  const { addToast } = useToast();
  const [gatewayError, setGatewayError] = useState(false);
  const [overrideStr, setOverrideStr] = useState("");
  const [enabledChecked, setEnabledChecked] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(autopayEnrollSchema) });

  // Prefill whenever the enrollment/cards snapshot changes.
  useEffect(() => {
    if (enrollment) {
      reset({ amount: Number(enrollment.amount), dayOfMonth: enrollment.dayOfMonth, paymentProfileId: enrollment.paymentProfileId });
      setOverrideStr(enrollment.minAmountOverride != null ? String(Number(enrollment.minAmountOverride)) : "");
      setEnabledChecked(Boolean(enrollment.enabled));
    } else if (cards.length > 0) {
      reset({ paymentProfileId: (cards.find((c) => c.isDefault) || cards[0]).paymentProfileId });
      setOverrideStr("");
      setEnabledChecked(false);
    }
  }, [enrollment, cards, reset]);

  const onSubmit = async (form) => {
    setGatewayError(false);
    const override = overrideStr.trim() === "" ? null : Number(overrideStr);
    if (override != null && (!(override > 0) || Number.isNaN(override))) {
      addToast({ message: "Floor override must be a positive number.", type: "error" });
      return;
    }
    try {
      await api.put(`/admin/users/${doctorUserId}/autopay`, {
        amount: Number(form.amount),
        dayOfMonth: Number(form.dayOfMonth),
        paymentProfileId: form.paymentProfileId,
        minAmountOverride: override,
        enabled: enabledChecked,
      });
      addToast({ message: "AutoPay saved.", type: "success" });
      onChanged();
    } catch (err) {
      // A 502 means Authorize.net itself was unreachable — not that anything
      // the admin entered was invalid. Keep it out of the field-error path.
      if (isGatewayError(err)) {
        setGatewayError(true);
        addToast({ message: errMsg(err, "Could not reach the card processor. Please try again shortly."), type: "error" });
        return;
      }
      // Only a 422 that names a field lands on that field (service-layer floor
      // violations do; validate()'s Zod errors emit `details`, not `field`).
      if (err.response?.status === 422 && err.response?.data?.error?.field) {
        setError(err.response.data.error.field, { type: "server", message: err.response.data.error.message || "Invalid value." });
        return;
      }
      addToast({ message: errMsg(err, "Could not save AutoPay."), type: "error" });
    }
  };

  const cancelAutopay = async () => {
    setCancelling(true);
    try {
      await api.delete(`/admin/users/${doctorUserId}/autopay`);
      addToast({ message: "AutoPay cancelled.", type: "success" });
      onChanged();
    } catch (err) {
      addToast({ message: errMsg(err, "Could not cancel AutoPay."), type: "error" });
    } finally {
      setCancelling(false);
    }
  };

  const pauseResume = async (pause) => {
    setPauseBusy(true);
    try {
      await api.post(`/admin/users/${doctorUserId}/autopay/${pause ? "pause" : "resume"}`);
      addToast({ message: `AutoPay ${pause ? "paused" : "resumed"}.`, type: "success" });
      onChanged();
    } catch (err) {
      addToast({ message: errMsg(err, "Could not update AutoPay."), type: "error" });
    } finally {
      setPauseBusy(false);
    }
  };

  return (
    <SectionCard title="AutoPay" icon={Repeat}>
      {enrollment && <EnrollmentStatus enrollment={enrollment} busy={pauseBusy} onPauseResume={pauseResume} />}

      {gatewayError && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>Could not reach the card processor — this wasn't a problem with what was entered. Please try again shortly.</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div>
          <label className={LABEL}>Monthly amount{minAmount != null && ` (lab minimum ${formatUSD(minAmount)})`}</label>
          <input type="number" step="0.01" min="0" className={INPUT} {...register("amount", { valueAsNumber: true })} />
          {errors.amount?.message && <p className="mt-1 text-xs text-red-600">{errors.amount.message}</p>}
        </div>

        <div>
          <label className={LABEL}>Floor override (admin only — optional)</label>
          <input
            type="number" step="0.01" min="0" value={overrideStr} onChange={(e) => setOverrideStr(e.target.value)} className={INPUT}
            placeholder={minAmount != null ? `Defaults to ${formatUSD(minAmount)}` : "Defaults to the lab minimum"}
          />
          <p className="mt-1 text-[11px] text-navy/40">Lets this doctor enroll below the standard minimum. Leave blank to use the lab default.</p>
        </div>

        <div>
          <label className={LABEL}>Day of month</label>
          <input type="number" min={1} max={31} className={INPUT} {...register("dayOfMonth", { valueAsNumber: true })} />
          {errors.dayOfMonth?.message && <p className="mt-1 text-xs text-red-600">{errors.dayOfMonth.message}</p>}
        </div>

        <div>
          <label className={LABEL}>Card</label>
          <select className={INPUT} disabled={cards.length === 0} {...register("paymentProfileId")}>
            {cards.length === 0 && <option value="">{cardsUnavailable ? "Couldn't check — try again" : "No cards on file"}</option>}
            {cards.map((c) => (
              <option key={c.paymentProfileId} value={c.paymentProfileId}>
                {c.cardType || "Card"} ****{c.cardNumber?.slice(-4)} — exp {c.expirationDate}
              </option>
            ))}
          </select>
          {errors.paymentProfileId?.message && <p className="mt-1 text-xs text-red-600">{errors.paymentProfileId.message}</p>}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-navy/70">
          <input type="checkbox" checked={enabledChecked} onChange={(e) => setEnabledChecked(e.target.checked)} className="accent-brand-600" />
          Enabled
        </label>

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={isSubmitting || cards.length === 0}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white transition-all hover:bg-brand-600 disabled:opacity-50">
            {isSubmitting && <Loader2 size={12} className="animate-spin" />}
            {enrollment ? "Save AutoPay" : "Enroll in AutoPay"}
          </button>
          {enrollment && (
            <button type="button" onClick={cancelAutopay} disabled={cancelling}
              className="flex items-center justify-center gap-1.5 rounded-full bg-surface-100 px-4 py-2.5 text-xs font-semibold text-navy/60 transition-all hover:bg-surface-200 disabled:opacity-50">
              {cancelling && <Loader2 size={12} className="animate-spin" />}
              Cancel AutoPay
            </button>
          )}
        </div>
      </form>
    </SectionCard>
  );
}
