import { useState } from "react";
import { AlertCircle, Download, FileText, Loader2 } from "lucide-react";
import api from "../../../config/api.js";
import { errMsg, formatBytes } from "./helpers.js";

// ── File row: fetch a short-lived signed URL on click, never link the raw
// stored pointer ─────────────────────────────────────────────────────────────
//
// files[].gcsUrl is the raw stored object pointer (gs://... in production,
// file://... in dev) — no browser can resolve either scheme directly, and
// even if one could, HIPAA rules out serving PHI files via a public or
// long-lived link. GET /admin/rx-cases/:id/files/:fileId (mirroring the
// doctor-facing route) mints a short-lived signed URL and audits the access;
// this component calls it lazily on click and opens the result immediately —
// the URL is never stored in component state beyond the moment it's used, so
// it can't leak into localStorage, a URL query string, or a console log.

export function FileRow({ caseId, file }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.get(`/admin/rx-cases/${caseId}/files/${file.id}`);
      const url = res.data?.data?.url;
      if (!url) {
        setError("No file link was returned.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="w-full flex items-center gap-3 p-3 bg-surface-50 rounded-lg hover:bg-surface-100 transition-colors text-left disabled:opacity-60"
      >
        <FileText size={14} className="text-navy/40 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-navy truncate">{file.originalName || file.kind}</div>
          <div className="text-[10px] font-mono text-navy/40">
            {file.kind}
            {file.contentType ? ` · ${file.contentType}` : ""}
            {formatBytes(file.size) ? ` · ${formatBytes(file.size)}` : ""}
          </div>
        </div>
        {busy ? (
          <Loader2 size={14} className="animate-spin text-navy/40 flex-shrink-0" />
        ) : (
          <Download size={14} className="text-brand-500 flex-shrink-0" />
        )}
      </button>
      {error && (
        <div className="mt-1.5 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
