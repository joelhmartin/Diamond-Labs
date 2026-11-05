import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MessageSquarePlus } from "lucide-react";
import { errorText } from "../../lib/requests.js";
import { formatWhen } from "../notifications/format.js";
import { fetchRecordThreads } from "./api.js";
import { NewThreadModal } from "./NewThreadModal.jsx";

/**
 * A record's conversations: every thread about (recordType, recordId) with a
 * "New message" button that starts one on the record and opens it.
 * `side` is the viewer's side; `threadPath(id)` is a thread's page.
 */
export function RecordThreads({ recordType, recordId, side = "party", threadPath, newThreadLabel = "New message", title = "Messages", timeZone }) {
  const navigate = useNavigate();
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      setThreads(await fetchRecordThreads({ recordType, recordId, side }));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [recordType, recordId, side]);
  useEffect(() => { setThreads(null); load(); }, [load]);

  return (
    <section className="rounded-2xl border border-surface-300/50 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-heading text-sm font-bold text-navy">{title}</h2>
        <button type="button" onClick={() => setComposing(true)} className="flex items-center gap-1.5 rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/90">
          <MessageSquarePlus size={12} /> {newThreadLabel}
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && threads == null && <p className="text-xs text-navy/40">Loading…</p>}
      {threads?.length === 0 && <p className="text-xs text-navy/40">No messages yet.</p>}
      {threads?.length > 0 && (
        <ul className="divide-y divide-surface-300/40">
          {threads.map((t) => (
            <li key={t.id}>
              <Link to={threadPath(t.id)} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-brand-600">
                <span className="flex items-center gap-2">
                  {t.unread && <span aria-label="Unread" role="img" className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                  <span className={t.unread ? "font-semibold text-navy" : "text-navy/70"}>{t.subject || "(no subject)"}</span>
                </span>
                <span className="whitespace-nowrap text-xs text-navy/50">{t.messageCount} · {formatWhen(t.lastMessageAt, timeZone)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewThreadModal
        open={composing}
        onClose={() => setComposing(false)}
        title={newThreadLabel}
        record={{ recordType, recordId }}
        onCreated={(thread) => { setComposing(false); load(); navigate(threadPath(thread.id)); }}
      />
    </section>
  );
}
