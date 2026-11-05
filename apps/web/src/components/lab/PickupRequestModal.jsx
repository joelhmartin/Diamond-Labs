import { useEffect, useState } from "react";
import { PICKUP_BOXES_MAX, PICKUP_BOXES_MIN, PICKUP_NOTES_MAX, TIME_PREFERENCES } from "@my-app/shared";
import { Modal } from "../ui/Modal.jsx";
import { useToast } from "../ui/Toast.jsx";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { errorText } from "../../lib/requests.js";
import { initialPickupForm, pickupBody, pickupFormErrors, requestPickup, searchPickupClients, timePreferenceLabel } from "../../lib/pickups.js";
import { INPUT } from "./form-styles.js";

function Field({ label, error, children }) {
  return (
    <label className="block text-xs font-medium text-navy/70">
      {label}
      <div className="mt-1">{children}</div>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </label>
  );
}

function ClientPicker({ value, error, onChange }) {
  const [q, setQ] = useState("");
  const [clients, setClients] = useState([]);
  const debounced = useDebouncedValue(q, 250);
  useEffect(() => {
    let live = true;
    searchPickupClients(debounced).then((rows) => { if (live) setClients(rows); }).catch(() => { if (live) setClients([]); });
    return () => { live = false; };
  }, [debounced]);
  return (
    <div className="space-y-2">
      <input aria-label="Find a client" placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} className={INPUT} />
      <Field label="Client" error={error}>
        <select aria-label="Client" value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
          <option value="">Choose…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
    </div>
  );
}

/**
 * Request a pickup. A practice asks for its own; with `staff` the lab enters one for a client
 * (a client picker is added and the request goes to /lab/pickups). The form checks the shared
 * schema's rules before posting; the API stays the authority. `onCreated(pickup)` after success.
 */
export function PickupRequestModal({ open, onClose, onCreated, staff = false }) {
  const { addToast } = useToast();
  const [form, setForm] = useState(() => initialPickupForm());
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setForm(initialPickupForm()); setErrors({}); }
  }, [open]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    const found = pickupFormErrors(form, { staff });
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const pickup = await requestPickup(pickupBody(form, { staff }), { staff });
      addToast({ message: `Pickup #${pickup.pickupNumber} requested`, type: "success" });
      onCreated?.(pickup);
      onClose();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={staff ? "New pickup" : "Request a pickup"} className="max-w-lg">
      <form onSubmit={submit} noValidate className="space-y-3">
        {staff && <ClientPicker value={form.clientUserId} error={errors.clientUserId} onChange={(clientUserId) => set({ clientUserId })} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Earliest date" error={errors.earliestDate}>
            <input type="date" value={form.earliestDate} onChange={(e) => set({ earliestDate: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Latest date" error={errors.latestDate}>
            <input type="date" value={form.latestDate} onChange={(e) => set({ latestDate: e.target.value })} className={INPUT} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Time" error={errors.timePreference}>
            <select value={form.timePreference} onChange={(e) => set({ timePreference: e.target.value })} className={INPUT}>
              {TIME_PREFERENCES.map((t) => <option key={t} value={t}>{timePreferenceLabel(t)}</option>)}
            </select>
          </Field>
          <Field label="Boxes" error={errors.boxCount}>
            <input type="number" min={PICKUP_BOXES_MIN} max={PICKUP_BOXES_MAX} value={form.boxCount} onChange={(e) => set({ boxCount: e.target.value })} className={INPUT} />
          </Field>
        </div>
        <Field label="Notes (optional)" error={errors.notes}>
          <textarea rows={3} maxLength={PICKUP_NOTES_MAX} value={form.notes} onChange={(e) => set({ notes: e.target.value })} className={INPUT} />
        </Field>
        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={onClose} className="text-sm font-medium text-navy/50 hover:text-navy">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-full bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-50">
            {busy ? "Sending…" : staff ? "Create pickup" : "Request pickup"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
