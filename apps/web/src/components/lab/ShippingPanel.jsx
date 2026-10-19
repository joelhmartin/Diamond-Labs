import { useState } from "react";
import { Truck, Printer, ExternalLink, PackageCheck, RefreshCw } from "lucide-react";
import { formatCents, trackingUrl, isTerminalShipmentStatus } from "@my-app/shared";
import api from "../../config/api.js";
import { ConfirmButton } from "../ui/ConfirmButton.jsx";
import { useToast } from "../ui/Toast.jsx";
import { shipmentPrintPath } from "../../config/routes.js";
import { shipmentLine, shipmentStatusLabel } from "../../lib/shipping.js";
import { errorText, isStale } from "../../lib/requests.js";
import { ShipModal } from "./ShipModal.jsx";

const BTN = "flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40";

/**
 * The order page's Shipping panel. It owns its own state and calls the API
 * itself; the page passes the order, the current shipment and a reload
 * callback. Ready and unlabelled: Ship (opens the Ship form). Labelled: the
 * label's facts, Print (new tab), Mark shipped, Refresh tracking and Void
 * (two clicks, while the label is unused). The server enforces every rule.
 */
export function ShippingPanel({ order, shipment, onChanged }) {
  const { addToast } = useToast();
  const [shipOpen, setShipOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) addToast({ message: success, type: "success" });
      await onChanged();
    } catch (err) {
      addToast({ message: isStale(err) ? `${errorText(err)} The latest version has been loaded.` : errorText(err), type: "error" });
      if (isStale(err)) await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const modal = (
    <ShipModal open={shipOpen} orderId={order.id} onClose={() => setShipOpen(false)} onBought={() => { setShipOpen(false); onChanged(); }} />
  );

  if (!shipment) {
    if (order.status !== "ready_to_ship") return null;
    return (
      <section className="rounded-2xl border border-surface-300/50 bg-white p-5">
        <h2 className="mb-3 font-heading text-sm font-bold text-navy">Shipping</h2>
        <button type="button" disabled={busy} onClick={() => setShipOpen(true)} className={`${BTN} bg-brand-500 text-white hover:bg-brand-600`}>
          <Truck size={14} /> Ship
        </button>
        {modal}
      </section>
    );
  }

  const url = trackingUrl(shipment.carrier, shipment.trackingNumber);
  const waiting = order.status === "ready_to_ship" && !shipment.shippedAt;
  const trackable = shipment.carrier !== "manual" && Boolean(shipment.trackingNumber) && !isTerminalShipmentStatus(shipment.status);
  return (
    <section className="rounded-2xl border border-surface-300/50 bg-white p-5">
      <h2 className="mb-2 font-heading text-sm font-bold text-navy">Shipping</h2>
      <p className="text-sm text-navy">{shipmentLine(shipment)}</p>
      <p className="mt-0.5 text-xs text-navy/50">{shipmentStatusLabel(shipment.status)} · {formatCents(shipment.chargeCents)}</p>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
          <ExternalLink size={11} /> Track
        </a>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {shipment.hasLabel && (
          <a href={shipmentPrintPath(shipment.id)} target="_blank" rel="noreferrer" className={`${BTN} bg-navy text-white hover:bg-navy/90`}>
            <Printer size={14} /> Print label
          </a>
        )}
        {waiting && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => api.post(`/lab/shipments/${shipment.id}/mark-shipped`), "Marked shipped")}
            className={`${BTN} bg-brand-500 text-white hover:bg-brand-600`}
          >
            <PackageCheck size={14} /> Mark shipped
          </button>
        )}
        {trackable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => api.post(`/lab/shipments/${shipment.id}/refresh-tracking`), "Tracking refreshed")}
            className={`${BTN} bg-surface-100 text-navy hover:bg-surface-200`}
          >
            <RefreshCw size={14} /> Refresh tracking
          </button>
        )}
        {waiting && shipment.status === "label_created" && (
          <ConfirmButton
            onConfirm={() => act(() => api.post(`/lab/shipments/${shipment.id}/void`), "Label voided")}
            disabled={busy}
            confirmLabel="Click again to void the label"
            className={`${BTN} bg-red-50 text-red-700 hover:bg-red-100`}
          >
            Void label
          </ConfirmButton>
        )}
      </div>
    </section>
  );
}
