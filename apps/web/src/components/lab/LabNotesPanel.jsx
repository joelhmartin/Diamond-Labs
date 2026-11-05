import { useEffect, useState } from "react";
import { Panel } from "./Panel.jsx";
import { INPUT } from "./form-styles.js";

/** Staff-only notes; the text resets only when the server value (or the order) changes. */
export function LabNotesPanel({ order, busy, onSave }) {
  const [notes, setNotes] = useState(order.labNotes ?? "");
  useEffect(() => { setNotes(order.labNotes ?? ""); }, [order.id, order.labNotes]);
  return (
    <Panel title="Lab notes (staff only)">
      <textarea className={`${INPUT} min-h-[100px]`} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button type="button" disabled={busy || notes === (order.labNotes ?? "")} onClick={() => onSave(notes)} className="mt-2 rounded-full bg-navy px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
        Save notes
      </button>
    </Panel>
  );
}
