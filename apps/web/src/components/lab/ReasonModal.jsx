import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal.jsx";
import { INPUT } from "./form-styles.js";

/** One free-text "why" dialog (hold / cancel). `request` is `{ title, submit(reason) }` or null. */
export function ReasonModal({ request, onClose }) {
  const [text, setText] = useState("");
  useEffect(() => { if (request) setText(""); }, [request]);
  const confirm = async () => {
    const reason = text.trim();
    if (!reason) return;
    onClose();
    await request.submit(reason);
  };
  return (
    <Modal open={!!request} onClose={onClose} title={request?.title}>
      <textarea autoFocus className={`${INPUT} min-h-[90px]`} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-full bg-surface-100 px-4 py-2 text-sm font-semibold text-navy hover:bg-surface-200">
          Never mind
        </button>
        <button type="button" disabled={!text.trim()} onClick={confirm} className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-40">
          Confirm
        </button>
      </div>
    </Modal>
  );
}
