import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertCircle } from "lucide-react";
import { useToast } from "../../components/ui/Toast.jsx";
import { errorText } from "../../lib/requests.js";
import { formatWhen } from "../notifications/format.js";
import { fetchThread, postMessage, setThreadFlag } from "./api.js";
import { Composer } from "./Composer.jsx";

// What each side can do to the thread as a whole: [label shown, flag to set, label when already set].
const HEADER_ACTIONS = {
  host: { on: "completedAt", set: ["Complete", "complete"], unset: ["Reopen", "reopen"] },
  party: { on: "archivedAt", set: ["Archive", "archive"], unset: ["Unarchive", "unarchive"] },
};

function Bubble({ message, own, timeZone }) {
  return (
    <div
      data-side={message.authorSide}
      data-own={own ? "true" : "false"}
      className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${own ? "ml-auto bg-brand-500/10 text-navy" : "mr-auto bg-surface-100 text-navy"}`}
    >
      <div className="mb-1 flex items-baseline gap-2 text-[11px] text-navy/50">
        <span className="font-semibold">{message.authorName || "—"}</span>
        <span>{formatWhen(message.createdAt, timeZone)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words">{message.body}</p>
    </div>
  );
}

/**
 * One conversation: header (record link, party, subject), messages oldest
 * first, and the reply box. `side` is the viewer's side ("host" | "party");
 * it decides which messages sit on the right and which folder action shows.
 * `onChanged()` fires after a reply or folder change (refresh nav badges).
 */
export function ThreadView({ threadId, side = "party", timeZone, onChanged }) {
  const { addToast } = useToast();
  const [state, setState] = useState({ thread: null, messages: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setState(await fetchThread(threadId));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [threadId]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const send = async (message) => {
    await postMessage(threadId, message);
    await load();
    onChanged?.();
  };

  const flag = async (action) => {
    try {
      await setThreadFlag(threadId, action);
      await load();
      onChanged?.();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-navy/40"><Loader2 size={18} className="mr-2 animate-spin" /> Loading…</div>;
  if (error || !state.thread) {
    return <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={14} /> {error || "Thread not found."}</div>;
  }

  const { thread, messages } = state;
  const cfg = HEADER_ACTIONS[side] ?? HEADER_ACTIONS.party;
  const [label, action] = thread[cfg.on] ? cfg.unset : cfg.set;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-navy">{thread.subject || "Conversation"}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-navy/60">
            {thread.recordLabel && (thread.recordPath
              ? <Link to={thread.recordPath} className="font-medium text-brand-600 hover:underline">{thread.recordLabel}</Link>
              : <span className="font-medium">{thread.recordLabel}</span>)}
            {side === "host" && thread.partyLabel && <span>{thread.partyLabel}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => flag(action)}
          className="rounded-full border border-navy/20 bg-white px-4 py-1.5 text-sm font-semibold text-navy hover:border-navy/40"
        >
          {label}
        </button>
      </header>

      <div className="flex flex-col gap-3">
        {messages.map((m) => <Bubble key={m.id} message={m} own={m.authorSide === side} timeZone={timeZone} />)}
      </div>

      <Composer onSend={send} />
    </div>
  );
}
