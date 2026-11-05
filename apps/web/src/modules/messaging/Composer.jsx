import { useState } from "react";
import { Paperclip, Send, X } from "lucide-react";
import { MESSAGE_BODY_MAX, MESSAGE_FILES_MAX, MESSAGE_FILE_MAX_BYTES } from "@my-app/shared";
import { errorText } from "../../lib/requests.js";
import { FileDrop, checkFiles, fileSizeLabel } from "../record-files/index.js";

const COUNTER_FROM = Math.floor(MESSAGE_BODY_MAX * 0.9);

/** The chosen files, each removable before sending. */
function FileChips({ files, onRemove, disabled }) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} data-testid="composer-file" className="flex items-center gap-1.5 rounded-full border border-surface-300/60 bg-surface-100 px-3 py-1 text-xs text-navy">
          <Paperclip size={12} aria-hidden="true" />
          <span className="max-w-[16rem] truncate">{f.name}</span>
          <span className="text-navy/40">{fileSizeLabel(f.size)}</span>
          <button type="button" disabled={disabled} aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)} className="rounded-full p-0.5 text-navy/50 hover:text-navy">
            <X size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A message box with optional attachments. `onSend({ body, files? })`
 * returns a promise; the box (text and files) clears when it resolves and
 * keeps everything (with the error) when it rejects. `files` is only present
 * when files were chosen. Count and size are checked here, before any request.
 */
export function Composer({ onSend, placeholder = "Write a message…", sendLabel = "Send", autoFocus = false }) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fileError, setFileError] = useState(null);
  const text = body.trim();

  const addFiles = (picked) => {
    const next = [...files, ...picked];
    const problem = next.length > MESSAGE_FILES_MAX
      ? `A message can carry up to ${MESSAGE_FILES_MAX} files.`
      : checkFiles(next, { maxFiles: MESSAGE_FILES_MAX, maxBytes: MESSAGE_FILE_MAX_BYTES });
    setFileError(problem);
    if (!problem) setFiles(next);
  };
  const removeFile = (index) => {
    setFiles((fs) => fs.filter((_, i) => i !== index));
    setFileError(null);
  };

  const send = async () => {
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(files.length ? { body: text, files } : { body: text });
      setBody("");
      setFiles([]);
      setFileError(null);
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
      <FileChips files={files} onRemove={removeFile} disabled={busy} />
      <FileDrop
        maxFiles={MESSAGE_FILES_MAX}
        maxBytes={MESSAGE_FILE_MAX_BYTES}
        onFiles={addFiles}
        disabled={busy || files.length >= MESSAGE_FILES_MAX}
        label={`Attach files: drop here or click (up to ${MESSAGE_FILES_MAX}, ${MESSAGE_FILE_MAX_BYTES / (1024 * 1024)} MB each)`}
      />
      {fileError && <p role="alert" className="text-xs text-red-600">{fileError}</p>}
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
