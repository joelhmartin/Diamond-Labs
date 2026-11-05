import { useEffect, useState } from "react";
import { LAB_DELIVERY_METHODS, LAB_DELIVERY_LABELS, LAB_PAN_MAX } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { errorText, isStale } from "../../lib/requests.js";
import { INPUT } from "./form-styles.js";
import { EnclosedFields } from "./order-entry/EnclosedFields.jsx";

const enclosuresKey = (list) => JSON.stringify(list ?? []);

/**
 * Pan number, delivery method and enclosed items for one lab order. Each
 * saves through PATCH /lab/orders/:id with the order's version; a STALE reply
 * toasts and calls `onChanged` so the page reloads the latest.
 */
export function ProductionPanel({ order, onChanged }) {
  const { addToast } = useToast();
  const closed = order.status === "shipped" || order.status === "cancelled";
  const [busy, setBusy] = useState(false);
  const [pan, setPan] = useState(order.panNumber ?? "");
  const [enclosures, setEnclosures] = useState(order.enclosures ?? []);

  // Reset an input only when the server's value (or the order) changed, so a half-typed pan survives unrelated saves.
  useEffect(() => setPan(order.panNumber ?? ""), [order.id, order.panNumber]);
  const serverEnclosures = enclosuresKey(order.enclosures);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized list, not its identity
  useEffect(() => setEnclosures(order.enclosures ?? []), [order.id, serverEnclosures]);

  const save = async (field, value, success) => {
    setBusy(true);
    try {
      await api.patch(`/lab/orders/${order.id}`, { field, value, expectedVersion: order.version });
      addToast({ message: success, type: "success" });
      await onChanged?.();
    } catch (err) {
      addToast({ message: isStale(err) ? `${errorText(err)} The latest version has been loaded.` : errorText(err), type: "error" });
      if (isStale(err)) await onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const panDirty = pan.trim() !== (order.panNumber ?? "");
  const enclosuresDirty = enclosuresKey(enclosures) !== serverEnclosures;

  return (
    <div className="space-y-3 text-sm">
      <div>
        <span className="text-xs text-navy/50">Pan number</span>
        <div className="flex gap-2">
          <input aria-label="Pan number" className={INPUT} maxLength={LAB_PAN_MAX} disabled={busy || closed} value={pan} onChange={(e) => setPan(e.target.value)} />
          <button type="button" disabled={busy || closed || !panDirty} onClick={() => save("pan", pan.trim() || null, "Pan number saved.")} className="rounded-lg bg-surface-100 px-3 text-xs font-semibold text-navy disabled:opacity-40">
            Save
          </button>
        </div>
      </div>
      <label className="block">
        <span className="text-xs text-navy/50">Delivery method</span>
        <select
          className={INPUT}
          disabled={busy || closed}
          value={order.deliveryMethod ?? ""}
          onChange={(e) => save("delivery", e.target.value || null, "Delivery method saved.")}
        >
          <option value="">Not set</option>
          {LAB_DELIVERY_METHODS.map((m) => <option key={m} value={m}>{LAB_DELIVERY_LABELS[m]}</option>)}
        </select>
      </label>
      <div>
        <span className="text-xs text-navy/50">Enclosed items</span>
        <div className="mt-1">
          <EnclosedFields value={enclosures} onChange={setEnclosures} disabled={busy || closed} />
        </div>
        <button
          type="button"
          disabled={busy || closed || !enclosuresDirty}
          onClick={() => save("enclosures", enclosures, "Enclosed items saved.")}
          className="mt-2 rounded-full bg-navy px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Save enclosed items
        </button>
      </div>
    </div>
  );
}
