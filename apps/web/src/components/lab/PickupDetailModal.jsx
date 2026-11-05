import { formatUsDate } from "@my-app/shared";
import { Modal } from "../ui/Modal.jsx";
import { addressLine, isOpenPickup, statusLabel, timePreferenceLabel, windowLabel } from "../../lib/pickups.js";

const Row = ({ label, children }) => (
  <div className="flex gap-3 text-sm">
    <dt className="w-28 shrink-0 text-navy/50">{label}</dt>
    <dd className="text-navy">{children}</dd>
  </div>
);

const BTN = "rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-navy hover:bg-surface-200";

/** One pickup in full (address snapshot, notes, driver) with the lab's row actions. `actions` = { schedule, complete, cancel }, each taking the pickup. */
export function PickupDetailModal({ pickup, onClose, actions }) {
  if (!pickup) return null;
  const open = isOpenPickup(pickup);
  return (
    <Modal open onClose={onClose} title={`Pickup #${pickup.pickupNumber}`} className="max-w-lg">
      <dl className="space-y-2">
        <Row label="Client">{pickup.companyName || pickup.clientName || "—"}</Row>
        <Row label="Status">{statusLabel(pickup.status)}</Row>
        <Row label="Window">{windowLabel(pickup)} · {timePreferenceLabel(pickup.timePreference)}</Row>
        <Row label="Scheduled">{pickup.scheduledDate ? formatUsDate(pickup.scheduledDate) : "—"}</Row>
        <Row label="Driver">{pickup.assigneeName || "—"}</Row>
        <Row label="Boxes">{pickup.boxCount}</Row>
        <Row label="Address">{addressLine(pickup.address)}</Row>
        {pickup.notes && <Row label="Notes">{pickup.notes}</Row>}
        {pickup.cancelReason && <Row label="Cancel reason">{pickup.cancelReason}</Row>}
      </dl>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onClose} className="text-sm font-medium text-navy/50 hover:text-navy">Close</button>
        {open && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN} onClick={() => actions.schedule(pickup)}>{pickup.status === "scheduled" ? "Reschedule…" : "Schedule…"}</button>
            {pickup.status === "scheduled" && <button type="button" className={BTN} onClick={() => actions.complete(pickup)}>Mark collected</button>}
            <button type="button" className="rounded-full px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50" onClick={() => actions.cancel(pickup)}>Cancel pickup…</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
