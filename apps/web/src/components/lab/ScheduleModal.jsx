import { useEffect, useState } from "react";
import { LAB_TIMEZONE, isoDateIn } from "@my-app/shared";
import { Modal } from "../ui/Modal.jsx";
import { ConfirmButton } from "../ui/ConfirmButton.jsx";
import { fetchAssignableStaff } from "../../lib/pickups.js";
import { INPUT } from "./form-styles.js";

/**
 * Collects a date and (optionally) a driver for scheduling one or more pickups, or a reason for
 * cancelling them (`mode="cancel"`). It only gathers the values: `onSubmit(values)` runs the
 * per-row calls and reports; the modal shows a busy state until that settles.
 */
export function ScheduleModal({ open, onClose, onSubmit, count = 1, mode = "schedule" }) {
  const [date, setDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState("");
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(false);
  const cancel = mode === "cancel";

  useEffect(() => {
    if (!open) return undefined;
    setDate(isoDateIn(LAB_TIMEZONE));
    setAssignee("");
    setReason("");
    if (cancel) return undefined;
    let live = true;
    fetchAssignableStaff().then((rows) => { if (live) setStaff(rows); }).catch(() => { if (live) setStaff([]); });
    return () => { live = false; };
  }, [open, cancel]);

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      // "Keep current" leaves assigneeUserId out; a chosen driver sets it.
      await onSubmit(cancel ? { reason } : { scheduledDate: date, ...(assignee ? { assigneeUserId: assignee } : {}) });
    } finally {
      setBusy(false);
    }
  };

  const noun = `${count} pickup${count === 1 ? "" : "s"}`;
  return (
    <Modal open={open} onClose={onClose} title={cancel ? `Cancel ${noun}` : `Schedule ${noun}`} className="max-w-sm">
      <form onSubmit={submit} className="space-y-3">
        {cancel ? (
          <label className="block text-xs font-medium text-navy/70">
            Reason
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={`${INPUT} mt-1`} />
          </label>
        ) : (
          <>
            <label className="block text-xs font-medium text-navy/70">
              Pickup date
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-navy/70">
              Driver
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={`${INPUT} mt-1`}>
                <option value="">Keep current</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </>
        )}
        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={onClose} className="text-sm font-medium text-navy/50 hover:text-navy">Back</button>
          {cancel ? (
            // Cancelling is outward-facing (the practice is told): the reason is required and the button asks twice.
            <ConfirmButton onConfirm={submit} confirmLabel="Click again to cancel" disabled={busy || !reason.trim()} className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              {busy ? "Working…" : `Cancel ${count === 1 ? "pickup" : "pickups"}`}
            </ConfirmButton>
          ) : (
            <button type="submit" disabled={busy || !date} className="rounded-full bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-50">
              {busy ? "Working…" : "Schedule"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
