import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import api from "../../config/api.js";
import { errorText } from "../../lib/requests.js";
import { useToast } from "../../components/ui/Toast.jsx";

/** The caller's own star on a record. `onChanged(starred)` fires after the server accepts it. */
export function StarToggle({ recordType, recordId, starred = false, onChanged, disabled = false }) {
  const { addToast } = useToast();
  const [on, setOn] = useState(Boolean(starred));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOn(Boolean(starred)); }, [starred, recordId]);

  const flip = async () => {
    const next = !on;
    setBusy(true);
    try {
      await (next ? api.put : api.delete)(`/tags/${recordType}/${recordId}/star`);
      setOn(next);
      onChanged?.(next);
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Unstar" : "Star"}
      disabled={disabled || busy}
      onClick={flip}
      className={`rounded-full p-1.5 transition-colors disabled:opacity-40 ${on ? "text-amber-500" : "text-navy/30 hover:text-navy/60"}`}
    >
      <Star size={16} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
