import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import api from "../../config/api.js";
import { Modal } from "../ui/Modal.jsx";
import { useToast } from "../ui/Toast.jsx";
import { useAttemptKey } from "../../hooks/useAttemptKey.js";
import { errorText } from "../../lib/requests.js";
import { initialShipForm, ratesBody, buyBody, buySignature, quoteKey, isUncertainPurchase } from "../../lib/shipping.js";
import { ShipToFields } from "./ShipToFields.jsx";
import { ParcelFields } from "./ParcelFields.jsx";
import { RateChooser } from "./RateChooser.jsx";

/**
 * The Ship form: other ready orders for the same client (ship together), the
 * ship-to for this shipment, the box, the service; then Buy. Buy sends ONE
 * Idempotency-Key per attempt (useAttemptKey), so a double click or a retry of
 * the same box can't buy two labels. An uncertain purchase keeps its key and
 * tells staff to check Admin › Shipments first.
 */
export function ShipModal({ open, orderId, onClose, onBought }) {
  const { addToast } = useToast();
  const attempt = useAttemptKey();
  const [context, setContext] = useState(null);
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [rates, setRates] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setContext(null);
    setForm(null);
    setRates(null);
    setUncertain(null);
    setLoadError(null);
    api.get(`/lab/orders/${orderId}/ship`)
      .then((res) => { if (live) { setContext(res.data.data); setForm(initialShipForm(res.data.data)); } })
      .catch((err) => { if (live) setLoadError(errorText(err)); });
    return () => { live = false; };
  }, [open, orderId]);

  const rated = useMemo(() => (form ? quoteKey(form) : null), [form]);
  const stale = Boolean(rates) && rates.key !== rated;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggle = (id) => set({ orderIds: form.orderIds.includes(id) ? form.orderIds.filter((x) => x !== id) : [...form.orderIds, id] });

  const getRates = async () => {
    setBusy(true);
    try {
      const res = await api.post("/lab/shipments/rates", ratesBody(form));
      setRates({ key: quoteKey(form), ...res.data.data });
      if (form.choice?.carrier !== "manual") set({ choice: null });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const buy = async () => {
    const body = buyBody(form);
    const key = attempt.keyFor(buySignature(body));
    setUncertain(null);
    setBusy(true);
    try {
      const res = await api.post("/lab/shipments", body, { headers: { "Idempotency-Key": key } });
      attempt.reset();
      addToast({ message: `Shipment recorded${res.data.data.trackingNumber ? `: ${res.data.data.trackingNumber}` : ""}`, type: "success" });
      onBought(res.data.data);
    } catch (err) {
      // Keep the key: retrying this attempt replays or waits, it never buys a second label.
      if (isUncertainPurchase(err)) setUncertain(errorText(err));
      else addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const manual = form?.choice?.carrier === "manual";
  const ready = Boolean(form?.orderIds.length) && Boolean(form?.choice) && (manual ? Boolean(form.manual.carrierName.trim()) : !stale);

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={context ? `Ship order #${context.order.orderNumber}` : "Ship"} className="max-w-2xl">
      {loadError && <p className="text-sm text-red-700">{loadError}</p>}
      {!form && !loadError && (
        <div className="flex items-center gap-2 py-8 text-sm text-navy/50"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      )}
      {form && (
        <div className="space-y-5">
          {context.siblings.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-xs font-bold uppercase tracking-wider text-navy/50">Ship together (same client, ready to ship)</legend>
              {context.siblings.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.orderIds.includes(s.id)} onChange={() => toggle(s.id)} disabled={busy} />
                  Order #{s.orderNumber}{s.isRemake ? " (remake)" : ""}
                </label>
              ))}
            </fieldset>
          )}
          <ShipToFields value={form.shipTo} onChange={(shipTo) => set({ shipTo })} hint={context.deliveryHint} disabled={busy} />
          <ParcelFields value={form.parcel} onChange={(parcel) => set({ parcel })} disabled={busy} />
          <RateChooser
            rates={rates} stale={stale} choice={form.choice} manual={form.manual} busy={busy} carriers={context.carriers}
            onGetRates={getRates} onChoose={(choice) => set({ choice })} onManual={(m) => set({ manual: m })}
          />
          {uncertain && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {uncertain}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-full bg-surface-100 px-4 py-2 text-sm font-semibold text-navy hover:bg-surface-200 disabled:opacity-40">
              Never mind
            </button>
            <button type="button" onClick={buy} disabled={!ready || busy} className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-40">
              {busy ? "Working…" : manual ? "Record shipment" : "Buy label"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
