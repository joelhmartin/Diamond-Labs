import { useState } from "react";
import { Send } from "lucide-react";
import { MESSAGE_BODY_MAX } from "@my-app/shared";
import { errorText } from "../../lib/requests.js";

const COUNTER_FROM = Math.floor(MESSAGE_BODY_MAX * 0.9);

/**
 * A message box. `onSend({ body })` returns a promise; the box clears when it
 * resolves and keeps the text (with the error) when it rejects. The object
 * argument leaves room for more fields later.
 */
export function Composer({ onSend, placeholder = "Write a message…", sendLabel = "Send", autoFocus = false }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const text = body.trim();

  const send = async () => {
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend({ body: text });
      setBody("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        aria-label="Message"
        autoFocus={autoFocus}
        value={body}
        maxLength={MESSAGE_BODY_MAX}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
        className="min-h-[96px] w-full rounded-xl border border-surface-300/60 bg-white px-3 py-2 text-sm text-navy focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/10"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-navy/50">
          {body.length >= COUNTER_FROM && <span className="font-mono">{`${body.length} / ${MESSAGE_BODY_MAX}`}</span>}
          {error && <span role="alert" className="ml-2 text-red-600">{error}</span>}
        </span>
        <button
          type="button"
          disabled={!text || busy}
          onClick={send}
          className="flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
        >
          <Send size={14} /> {sendLabel}
        </button>
      </div>
    </div>
  );
}
