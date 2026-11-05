import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "../../components/ui/Toast.jsx";
import { errorText } from "../../lib/requests.js";
import { fetchPreferences, savePreference } from "./api.js";

const CHANNEL_LABELS = { in_app: "In-app", email: "Email" };
const COLUMNS = Object.keys(CHANNEL_LABELS);

/** A grid of switches: one row per event the user is offered, In-app and Email columns. */
export function PreferencesPanel() {
  const { addToast } = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    fetchPreferences().then((r) => { if (live) setRows(r); }).catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, []);

  const set = (event, channel, enabled) => setRows((list) => list.map((r) => (r.event === event ? { ...r, channels: { ...r.channels, [channel]: enabled } } : r)));

  const toggle = async (row, channel) => {
    const next = !row.channels[channel];
    set(row.event, channel, next);
    try {
      await savePreference({ event: row.event, channel, enabled: next });
    } catch (err) {
      set(row.event, channel, !next);
      addToast({ message: errorText(err), type: "error" });
    }
  };

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!rows) return <Loader2 size={18} className="animate-spin text-navy/40" />;
  if (rows.length === 0) return <p className="text-sm text-navy/50">There is nothing to configure.</p>;

  return (
    <div className="overflow-hidden rounded-2xl border border-surface-300/50 bg-white">
      <div role="grid" className="divide-y divide-surface-300/40">
        <div role="row" className="grid grid-cols-[1fr_6rem_6rem] px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-navy/40">
          <span role="columnheader">Alert</span>
          {COLUMNS.map((c) => <span key={c} role="columnheader" className="text-center">{CHANNEL_LABELS[c]}</span>)}
        </div>
        {rows.map((row) => (
          <div role="row" key={row.event} className="grid grid-cols-[1fr_6rem_6rem] items-center px-4 py-3">
            <span role="gridcell" className="text-sm text-navy">{row.label}</span>
            {COLUMNS.map((c) => (
              <span role="gridcell" key={c} className="text-center">
                {c in row.channels ? (
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`${row.label}: ${CHANNEL_LABELS[c]}`}
                    checked={Boolean(row.channels[c])}
                    onChange={() => toggle(row, c)}
                    className="accent-brand-500"
                  />
                ) : <span className="text-navy/20">n/a</span>}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
