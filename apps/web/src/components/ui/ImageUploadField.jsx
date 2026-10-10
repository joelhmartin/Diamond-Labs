import { useId, useRef, useState, useEffect } from "react";
import { ImagePlus, Loader2, Trash2, Link2, AlertCircle } from "lucide-react";
import api from "../../config/api.js";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/** Client-side pre-check so a bad file fails instantly. The server re-checks by content. */
export function checkImageFile(file) {
  if (!file) return "No file selected.";
  if (!ACCEPT.split(",").includes(file.type)) return "Use a JPEG, PNG, WebP or GIF image.";
  if (file.size > MAX_BYTES) return "That image is over 5 MB. Export a smaller one and try again.";
  return null;
}

/**
 * Image picker that uploads to POST /admin/media and reports the stored URL.
 *
 * Controlled: `value` is the current image URL (or ""), `onChange(url)` is
 * called with the new URL, or "" when the image is removed. Pasting an
 * existing URL stays available as a fallback, but uploading is the default.
 */
export default function ImageUploadField({ value, onChange, label = "Image", onUploadingChange }) {
  const inputId = useId();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  // Optional: lets a parent form hold its own Save while a file is still uploading.
  useEffect(() => { onUploadingChange?.(uploading); }, [uploading, onUploadingChange]);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);

  async function upload(file) {
    setError(null);
    if (!file) return;
    const problem = checkImageFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    const body = new FormData();
    body.append("file", file);
    setUploading(true);
    try {
      const { data } = await api.post("/admin/media", body, { headers: { "Content-Type": undefined } });
      onChange(data.data.url);
      setPasteMode(false);
    } catch (err) {
      setError(err.response?.data?.error?.message || "Upload failed. Try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    upload(e.dataTransfer.files?.[0]);
  }

  return (
    <div>
      <label htmlFor={inputId} className="block text-[10px] font-mono text-navy/40 uppercase tracking-widest mb-1.5">
        {label}
      </label>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex items-center gap-3 rounded-lg border border-dashed p-3 transition-colors ${
          dragging ? "border-brand-500 bg-brand-500/5" : "border-surface-300/80 bg-white"
        }`}
      >
        <div className="w-16 h-16 flex-shrink-0 rounded-lg bg-surface-100 border border-surface-300/30 overflow-hidden flex items-center justify-center text-navy/20">
          {uploading ? (
            <Loader2 size={18} className="animate-spin text-navy/40" />
          ) : value ? (
            <img src={value} alt="" className="w-full h-full object-contain p-0.5" />
          ) : (
            <ImagePlus size={18} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy text-white text-xs font-semibold hover:bg-navy/90 disabled:opacity-50"
            >
              <ImagePlus size={13} />
              {uploading ? "Uploading…" : value ? "Replace image" : "Upload image"}
            </button>
            {value && !uploading && (
              <button
                type="button"
                onClick={() => { onChange(""); setError(null); }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-navy/60 hover:text-red-600"
              >
                <Trash2 size={13} /> Remove
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-navy/60">Or drop an image here. JPEG, PNG, WebP or GIF, up to 5 MB.</p>
          <button
            type="button"
            onClick={() => setPasteMode((v) => !v)}
            className="mt-1 inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy"
          >
            <Link2 size={12} /> {pasteMode ? "Hide URL field" : "Use an image URL instead"}
          </button>
        </div>

        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </div>

      {pasteMode && (
        <input
          className="mt-2 w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-navy/40"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… (an image that's already online)"
          aria-label={`${label} URL`}
        />
      )}

      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600">
          <AlertCircle size={13} /> {error}
        </p>
      )}
    </div>
  );
}
