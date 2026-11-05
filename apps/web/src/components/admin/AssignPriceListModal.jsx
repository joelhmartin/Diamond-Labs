import { useEffect, useState } from "react";
import api from "../../config/api.js";
import { Modal } from "../ui/Modal.jsx";
import { ConfirmButton } from "../ui/ConfirmButton.jsx";
import { CONTROL } from "../ui/data-table/FilterControl.jsx";
import { errorText } from "../../lib/requests.js";

const MODES = [
  { value: "add", label: "Add to their lists (lowest precedence)" },
  { value: "replace", label: "Replace their lists with this one" },
];

/**
 * Pick a price list and add it to, or replace, the lists of the given clients.
 * `onDone({ ok, failed })` receives the server's result (non-clients land in
 * `failed`); the caller toasts it. Reused wherever clients are bulk-selected.
 */
export function AssignPriceListModal({ clientUserIds, onDone, onClose }) {
  const [lists, setLists] = useState(null);
  const [listId, setListId] = useState("");
  const [mode, setMode] = useState("add");
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    api.get("/admin/price-lists")
      .then((res) => live && setLists(res.data.data))
      .catch((err) => live && setError(errorText(err)));
    return () => { live = false; };
  }, []);

  async function assign() {
    setError(null);
    try {
      const res = await api.post("/admin/price-lists/assign", { listId, clientUserIds, mode });
      onDone?.(res.data.data);
    } catch (err) {
      setError(errorText(err));
    }
  }

  const n = clientUserIds.length;
  return (
    <Modal open onClose={onClose} title="Assign price list">
      <div className="space-y-4">
        <label className="block text-xs text-navy/60">
          Price list
          <select aria-label="Price list" value={listId} onChange={(e) => setListId(e.target.value)} className={`${CONTROL} mt-1 w-full`}>
            <option value="">{lists ? "Choose a list…" : "Loading…"}</option>
            {(lists ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <fieldset className="space-y-1.5 text-sm text-navy">
          {MODES.map((m) => (
            <label key={m.value} className="flex items-center gap-2">
              <input type="radio" name="assign-mode" checked={mode === m.value} onChange={() => setMode(m.value)} className="accent-brand-500" />
              {m.label}
            </label>
          ))}
        </fieldset>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-4 text-xs font-semibold text-navy/60 hover:bg-surface-100">Cancel</button>
          <ConfirmButton
            onConfirm={assign}
            disabled={!listId}
            confirmLabel={`Click again to assign to ${n} ${n === 1 ? "client" : "clients"}`}
            className="h-9 rounded-xl bg-brand-500 px-4 text-xs font-semibold text-white hover:bg-brand-600"
          >
            Assign to {n} {n === 1 ? "user" : "users"}
          </ConfirmButton>
        </div>
      </div>
    </Modal>
  );
}
