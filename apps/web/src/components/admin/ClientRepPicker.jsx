import { useState } from "react";
import { X } from "lucide-react";
import api from "../../config/api.js";
import { useAuth } from "../../hooks/useAuth.js";
import { Drawer } from "../ui/Drawer.jsx";
import { useToast } from "../ui/Toast.jsx";
import { errorText } from "../../lib/requests.js";
import { TagPicker } from "../../modules/record-tags/index.js";

export const CLIENT_REP_TAG_TYPE = "client_rep";

/**
 * A client's sales rep: the record-tags picker for `client_rep`, single-select
 * (choosing a rep swaps the old one out). Admin only, like the server's apply
 * guard; anyone else gets nothing. `onChanged(tags)` fires after the save.
 */
export function ClientRepPicker({ client, onClose, onChanged }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [tags, setTags] = useState(client.repTags ?? []);
  const [busy, setBusy] = useState(false);
  if (user?.role !== "admin") return null;

  const change = async (nextIds) => {
    const current = tags.map((t) => t.id);
    // Single-select: when a new rep is toggled on, everything else comes off.
    const added = nextIds.filter((id) => !current.includes(id));
    const keep = added.length ? added : nextIds;
    const add = keep.filter((id) => !current.includes(id));
    const remove = current.filter((id) => !keep.includes(id));
    if (!add.length && !remove.length) return;
    setBusy(true);
    try {
      await api.post(`/tags/${CLIENT_REP_TAG_TYPE}/apply`, { ids: [client.id], add, remove });
      const label = client.name || client.email;
      addToast({ message: add.length ? `Rep saved for ${label}.` : `Rep cleared for ${label}.`, type: "success" });
      // The picker reports ids only; keep what we know of the applied tags so a retired rep stays visible.
      const known = new Map(tags.map((t) => [t.id, t]));
      setTags(keep.map((id) => known.get(id) ?? { id, label: "Rep", color: "slate", active: true }));
      onChanged?.();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer onClose={onClose} label="Sales rep" className="max-w-md space-y-4 bg-white p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-navy">Sales rep</h2>
          <p className="text-xs text-navy/50">{client.name || client.email}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-navy/50 hover:bg-surface-100"><X size={16} /></button>
      </div>
      <TagPicker recordType={CLIENT_REP_TAG_TYPE} value={tags.map((t) => t.id)} applied={tags} onChange={change} disabled={busy} />
      <p className="text-xs text-navy/40">Reps are set up under Labels › Sales reps. Click the chosen rep again to clear it.</p>
    </Drawer>
  );
}
