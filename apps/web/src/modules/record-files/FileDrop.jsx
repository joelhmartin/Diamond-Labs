import { useRef, useState } from "react";
import { MAX_FILE_SIZE_BYTES, RECORD_FILES_MAX_COUNT } from "@my-app/shared";

/** Returns an inline message for the first problem with `files`, or null. */
export function checkFiles(files, { maxFiles = RECORD_FILES_MAX_COUNT, maxBytes = MAX_FILE_SIZE_BYTES } = {}) {
  if (files.length > maxFiles) return `Choose up to ${maxFiles} files at a time.`;
  const big = files.find((f) => f.size > maxBytes);
  if (big) return `"${big.name}" is over ${Math.round(maxBytes / (1024 * 1024))} MB.`;
  return null;
}

/**
 * A drop zone / file picker. Validates size and count, shows problems inline,
 * and hands accepted files to `onFiles(files[])`. `maxBytes` defaults to the
 * record-files limit; a caller with a tighter one (message attachments) passes it.
 */
export function FileDrop({ accept, maxFiles = RECORD_FILES_MAX_COUNT, maxBytes = MAX_FILE_SIZE_BYTES, onFiles, disabled = false, label = "Drop files here or click to choose" }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState("");

  const take = (list) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    const problem = checkFiles(files, { maxFiles, maxBytes });
    setMessage(problem || "");
    if (!problem) onFiles(files);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && input.current?.click()}
        onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer?.files); }}
        className={`rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm cursor-pointer ${over ? "border-brand-500 bg-brand-50" : "border-gray-300 text-gray-600"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        {label}
        <input
          ref={input}
          type="file"
          multiple={maxFiles > 1}
          accept={accept}
          hidden
          data-testid="file-drop-input"
          onChange={(e) => { take(e.target.files); e.target.value = ""; }}
        />
      </div>
      {message && <p role="alert" className="mt-1 text-sm text-red-600">{message}</p>}
    </div>
  );
}
