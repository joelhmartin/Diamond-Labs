import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { autopayEnrollSchema } from "@my-app/shared";
import {
  Loader2,
  CreditCard,
  CheckCircle2,
  PauseCircle,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { ROUTES } from "../../config/routes.js";
import api from "../../config/api.js";

function formatUSD(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function AutoPayPage() {
  const { addToast } = useToast();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  // Distinct from field-level validation errors surfaced by the resolver —
  // this is for failures that are not about what the doctor typed (a gateway
  // outage on submit). Keeping it separate means a 502 never gets rendered
  // next to a field as if their input was the problem.
  const [gatewayError, setGatewayError] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(autopayEnrollSchema) });

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/autopay");
      setState(data.data);
      if (data.data.enrollment) {
        reset({
          amount: data.data.enrollment.amount,
          dayOfMonth: data.data.enrollment.dayOfMonth,
          paymentProfileId: data.data.enrollment.paymentProfileId,
        });
      } else if (data.data.cards?.length > 0) {
        // Nothing to enroll yet — default the card picker to their first card
        // on file so submitting doesn't require touching every field.
        reset({ paymentProfileId: data.data.cards[0].paymentProfileId });
      }
    } catch {
      addToast({ message: "Could not load AutoPay settings.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (form) => {
    setGatewayError(false);
    try {
      await api.put("/autopay", {
        ...form,
        amount: Number(form.amount),
        dayOfMonth: Number(form.dayOfMonth),
        enabled: true,
      });
      addToast({ message: "AutoPay saved.", type: "success" });
      load();
    } catch (err) {
      // A 502 here means Authorize.net itself was unreachable, not that the
      // doctor's input was invalid — see gatewayErrorResponse() in
      // autopay.routes.js. Route it to a distinct transient-failure state
      // instead of the generic "could not save" validation-flavored toast.
      if (err.response?.status === 502) {
        setGatewayError(true);
        addToast({
          message: err.response?.data?.error?.message || "Could not reach the card processor. Please try again shortly.",
          type: "error",
        });
        return;
      }
      addToast({ message: err.response?.data?.error?.message || "Could not save AutoPay.", type: "error" });
    }
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      await api.delete("/autopay");
      addToast({ message: "AutoPay cancelled.", type: "success" });
      load();
    } catch (err) {
      addToast({ message: err.response?.data?.error?.message || "Could not cancel AutoPay.", type: "error" });
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // Authorize.net was unreachable when we tried to list cards — this is not
  // the same as "no cards on file" and must not send a doctor with a good
  // card into the add-a-card flow. Offer a retry instead.
  if (state.cardsUnavailable) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900">AutoPay</h1>
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          <p className="font-medium text-amber-900">We couldn't reach the payment system</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-amber-700">
            We weren't able to check your cards on file just now. This is usually temporary —
            try again in a moment.
          </p>
          <Button variant="secondary" className="mt-4" onClick={load}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // A card on file is a hard requirement, enforced server-side too.
  if (!state.canEnroll) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900">AutoPay</h1>
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-12 text-center">
          <CreditCard className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-gray-500">AutoPay needs a card on file. Add one and come back.</p>
          <Link to={ROUTES.DOCTOR_SAVED_CARDS} className="mt-4 inline-block">
            <Button>Add a card</Button>
          </Link>
        </div>
      </div>
    );
  }

  const e = state.enrollment;
  const isPaused = e?.enabled && e.status === "paused";
  const isActive = e?.enabled && e.status === "active";
  const nextRun = formatDate(e?.nextRunDate);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900">AutoPay</h1>
      <p className="mt-1 text-sm text-gray-500">
        Pay a set amount each month toward your open invoices, oldest first, until they're paid
        off. If your balance is less than your AutoPay amount, we charge only the balance.
      </p>

      {isActive && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="font-medium text-emerald-900">
              Active — {formatUSD(e.amount)} on day {e.dayOfMonth}
            </p>
            {nextRun && <p className="mt-0.5 text-emerald-700">Next payment {nextRun}.</p>}
          </div>
        </div>
      )}

      {isPaused && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-amber-900">AutoPay is paused</p>
            <p className="mt-0.5 text-amber-700">
              {e.pausedReason || "AutoPay was paused automatically after repeated charge failures."}
            </p>
            <p className="mt-1 text-amber-700">
              Update the card below to a valid one, or contact the lab if you need help.
            </p>
          </div>
        </div>
      )}

      {gatewayError && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div>
            <p className="font-medium text-red-900">Could not reach the card processor</p>
            <p className="mt-0.5 text-red-700">
              This wasn't a problem with what you entered — the payment gateway didn't respond.
              Please try again shortly.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <Input
          label={`Monthly amount (minimum ${formatUSD(state.minAmount)})`}
          type="number"
          step="0.01"
          min={state.minAmount}
          error={errors.amount?.message}
          {...register("amount", { valueAsNumber: true })}
        />
        <Input
          label="Day of month"
          type="number"
          min={1}
          max={31}
          error={errors.dayOfMonth?.message}
          {...register("dayOfMonth", { valueAsNumber: true })}
        />
        <p className="-mt-2 text-xs text-gray-500">
          Days after the 28th are charged on the last day of shorter months.
        </p>
        <label className="block text-sm font-medium text-gray-700">
          Card
          <select
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            {...register("paymentProfileId")}
          >
            {state.cards.map((c) => (
              <option key={c.paymentProfileId} value={c.paymentProfileId}>
                {c.cardType} {c.cardNumber} — exp {c.expirationDate}
              </option>
            ))}
          </select>
          {errors.paymentProfileId?.message && (
            <p className="mt-1 text-sm text-red-600">{errors.paymentProfileId.message}</p>
          )}
        </label>
        <div className="flex gap-3">
          <Button type="submit" loading={isSubmitting}>
            {e ? "Update AutoPay" : "Enroll in AutoPay"}
          </Button>
          {e && (
            <Button type="button" variant="secondary" loading={cancelling} onClick={cancel}>
              Cancel AutoPay
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
