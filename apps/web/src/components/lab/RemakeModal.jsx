import { useEffect, useState } from "react";
import api from "../../config/api.js";
import { Modal } from "../ui/Modal.jsx";
import { errorText } from "../../lib/requests.js";
import { INPUT } from "./form-styles.js";

/**
 * Why a shipped order is being remade: pick a reason from the lab's list (each carries a
 * default percent off that prices the remake's draft; "100%" is free) and/or type a note.
 * Either one is enough. `onSubmit({ reasonId?, reason? })` does the post.
 */
export function RemakeModal({ open, onClose, onSubmit }) {
  const [reasons, setReasons] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [reasonId, setReasonId] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    setReasonId("");
    setText("");
    let live = true;
    api.get("/lab/adjustment-reasons", { params: { appliesTo: "remake" } })
      .then((res) => { if (live) { setReasons(res.data.data.reasons ?? []); setLoadError(null); } })
      .catch((err) => { if (live) setLoadError(errorText(err)); });
    return () => { live = false; };
  }, [open]);

  const ready = Boolean(reasonId) || Boolean(text.trim());
  const submit = () => onSubmit({ ...(reasonId ? { reasonId } : {}), ...(text.trim() ? { reason: text.trim() } : {}) });

  return (
    <Modal open={open} onClose={onClose} title="Why is this order being remade?">
      <label className="mb-1 block text-xs font-semibold text-navy/60" htmlFor="remake-reason">Reason</label>
      <select id="remake-reason" className={INPUT} value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
        <option value="">Choose a reason…</option>
        {reasons.map((r) => (
          <option key={r.id} value={r.id}>{r.label}{r.discountPercent != null ? ` (${r.discountPercent}% off)` : ""}</option>
        ))}
      </select>
      {loadError && <p className="mt-1 text-xs text-red-700">Couldn't load the reasons ({loadError}). You can still type one below.</p>}
      <label className="mb-1 mt-3 block text-xs font-semibold text-navy/60" htmlFor="remake-note">Note (optional with a reason)</label>
      <textarea id="remake-note" className={`${INPUT} min-h-[80px]`} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-full bg-surface-100 px-4 py-2 text-sm font-semibold text-navy hover:bg-surface-200">
          Never mind
        </button>
        <button type="button" disabled={!ready} onClick={submit} className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-40">
          Confirm
        </button>
      </div>
    </Modal>
  );
}
