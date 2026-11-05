import { useEffect, useState } from "react";
import { MESSAGE_SUBJECT_MAX } from "@my-app/shared";
import { Modal } from "../../components/ui/Modal.jsx";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { Composer } from "./Composer.jsx";
import { createThread, fetchParties } from "./api.js";

const FIELD = "w-full rounded-lg border border-surface-300/60 bg-white px-3 py-2 text-sm text-navy focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/10";

function PartyPicker({ value, onChange }) {
  const [q, setQ] = useState("");
  const [parties, setParties] = useState([]);
  const debounced = useDebouncedValue(q, 250);
  useEffect(() => {
    let live = true;
    fetchParties(debounced).then((rows) => { if (live) setParties(rows); }).catch(() => { if (live) setParties([]); });
    return () => { live = false; };
  }, [debounced]);

  return (
    <div className="space-y-2">
      <input aria-label="Find who to message" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className={FIELD} />
      <select aria-label="To" value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        <option value="">Choose…</option>
        {parties.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
    </div>
  );
}

/**
 * Starts a thread. With `record` ({ recordType, recordId }) it is about that
 * record; with `pickParty` (host only) the sender first chooses who to write
 * to. `onCreated(thread)` receives the new thread.
 */
export function NewThreadModal({ open, onClose, title = "New message", record = null, pickParty = false, onCreated }) {
  const [party, setParty] = useState("");
  const [subject, setSubject] = useState("");

  const send = async ({ body }) => {
    if (pickParty && !record && !party) throw new Error("Choose who to message.");
    const payload = {
      ...(record ? { recordType: record.recordType, recordId: record.recordId } : {}),
      ...(pickParty && !record ? { party } : {}),
      ...(subject.trim() ? { subject: subject.trim() } : {}),
      body,
    };
    const thread = await createThread(payload);
    setParty("");
    setSubject("");
    onCreated?.(thread);
  };

  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-lg">
      <div className="space-y-3">
        {pickParty && !record && <PartyPicker value={party} onChange={setParty} />}
        <input aria-label="Subject" placeholder="Subject (optional)" maxLength={MESSAGE_SUBJECT_MAX} value={subject} onChange={(e) => setSubject(e.target.value)} className={FIELD} />
        <Composer onSend={send} autoFocus />
        <div className="flex justify-start">
          <button type="button" onClick={onClose} className="text-sm font-medium text-navy/50 hover:text-navy">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
