import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Send,
  RotateCcw,
  Plus,
  Trash2,
  Pencil,
  Search,
  X,
  FileText,
  Download,
  ClipboardList,
  History as HistoryIcon,
  FileStack,
  Info,
  Tag,
} from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { useAuth } from "../../hooks/useAuth.js";
import { LAB_STATUS_LABELS } from "@my-app/shared";
import { Modal } from "../../components/ui/Modal.jsx";
import { ROUTES, labOrderPath } from "../../config/routes.js";
import { caseStatusLabel, resolutionLabel } from "../../lib/rx-case-labels.js";

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/**
 * Why the release button is disabled, in words. A greyed-out button with no
 * explanation is the thing staff will complain about; naming the selection
 * that blocks it turns a dead end into a next action.
 *
 * Mirrors the server's canRelease gate (case-gates.js): a case with nothing to
 * release is refused the same as a case with an unresolved line — both read
 * "This case has no lines to release." / "Needs a product code for: …" rather
 * than a generic disabled state.
 */
export function releaseBlockedReason(lines = []) {
  const emitting = lines.filter((l) => !l.noteOnly);
  if (emitting.length === 0) {
    return "This case has no lines to release.";
  }
  // Both halves of the server's rule, deliberately. canRelease blocks a line with
  // no seazonaCode REGARDLESS of what its status claims — it was made
  // self-sufficient precisely so a stale "confirmed" can't wave a codeless line
  // through. Mirroring only the status half would light up Release for a case the
  // server then refuses with a 422, which is the dead end this helper exists to
  // prevent.
  const blocking = emitting.filter((l) => l.status === "open" || !l.seazonaCode);
  if (blocking.length === 0) return null;
  const names = blocking.map((l) => l.sourceLabel || l.mapKey).filter(Boolean);
  return `Needs a product code for: ${names.join(", ")}`;
}

const STATUS_COLORS = {
  new: "bg-blue-500/10 text-blue-700",
  in_review: "bg-violet-500/10 text-violet-700",
  awaiting_doctor: "bg-amber-500/10 text-amber-700",
  failed: "bg-red-500/10 text-red-600",
  released: "bg-emerald-500/10 text-emerald-700",
  pushed: "bg-emerald-500/10 text-emerald-700",
  cancelled: "bg-gray-200 text-gray-700",
};

function statusColor(s) {
  return STATUS_COLORS[s] || "bg-gray-200 text-gray-700";
}

function errMsg(err) {
  return (
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    "Something went wrong."
  );
}

function formatDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatBytes(b) {
  const n = Number(b);
  if (!n || Number.isNaN(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** "patientFirstName" / "patient_first_name" -> "Patient First Name" */
function humanizeKey(key) {
  const spaced = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Render an arbitrary form-answer value (string, array, {first,last}, object) as text. */
function formatAnswer(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const parts = value.map(formatAnswer).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    if ("first" in value || "last" in value) {
      const full = [value.first, value.last].filter(Boolean).join(" ");
      return full || null;
    }
    const parts = Object.entries(value)
      .map(([k, v]) => {
        const fv = formatAnswer(v);
        return fv ? `${humanizeKey(k)}: ${fv}` : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// ── Small UI atoms ───────────────────────────────────────────────────────────

function Field({ label, value, className = "" }) {
  return (
    <div className={className}>
      <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest">{label}</div>
      <div className="mt-1 text-sm text-navy break-words">{value || "—"}</div>
    </div>
  );
}

function Banner({ tone = "info", icon: Icon = Info, children, action }) {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    error: "border-red-200 bg-red-50 text-red-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
  };
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${tones[tone]}`}>
      <Icon size={16} className="mt-0.5 flex-shrink-0" />
      <div className="flex-1 text-sm">{children}</div>
      {action}
    </div>
  );
}

function LineStatusBadge({ line }) {
  if (line.noteOnly) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-500/10 text-slate-600">
        Note only
      </span>
    );
  }
  if (line.status === "confirmed") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-700">
        Confirmed
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-600">
      Needs code
    </span>
  );
}

// ── Catalog search (shared by the line editor + add-line form) ─────────────

function CatalogPicker({ onPick, disabled }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);

  const doSearch = useCallback((q) => {
    clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get("/admin/rx-mapping/catalog", { params: { q } });
        setResults(res.data.data || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="relative">
      <div className="relative">
        <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy/30 pointer-events-none" />
        <input
          type="text"
          className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-surface-300/60 bg-white text-xs text-navy focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/10 placeholder:text-navy/25 disabled:opacity-50"
          placeholder="Search catalog by code or name…"
          disabled={disabled}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            doSearch(e.target.value);
          }}
        />
        {searching && (
          <Loader2 size={10} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-navy/40" />
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-surface-300/60 bg-white shadow-md divide-y divide-surface-200/60 max-h-40 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.code}
              type="button"
              disabled={disabled}
              onClick={() => {
                onPick(r);
                setQuery("");
                setResults([]);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-surface-50 transition-colors"
            >
              <span className="font-mono text-navy/60 mr-1.5">{r.code}</span>
              <span className="text-navy/80">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Line resolution editor: catalog search + once/always + Assign, or note-only ──

function LineEditor({ caseId, line, onSaved, onCancel }) {
  const [selected, setSelected] = useState(null); // { code, name }
  const [scope, setScope] = useState("once");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async (body, opts = {}) => {
    // scope: "always" writes a PERMANENT mapping override — every future
    // prescription with this same selection resolves this way. That is
    // deliberate and far-reaching, so it gets its own confirmation instead
    // of riding along on the same click as an ordinary once-off fix.
    if (body.scope === "always" && !opts.confirmed) {
      const ok = window.confirm(
        "This also changes how every FUTURE prescription resolves this same selection, not just this case. Continue?"
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.put(`/admin/rx-cases/${caseId}/lines/${line.id}`, body);
      onSaved(res.data.data);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const assign = () => {
    if (!selected) return;
    save({ seazonaCode: selected.code, name: selected.name, noteOnly: false, scope });
  };

  const markNoteOnly = () => {
    save({ noteOnly: true, scope });
  };

  return (
    <div className="mt-2 p-3 rounded-xl border border-surface-300/60 bg-surface-50 space-y-2.5">
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <CatalogPicker disabled={busy} onPick={(r) => setSelected(r)} />

      {selected && (
        <div className="text-xs text-navy/70 bg-white rounded-lg border border-surface-300/50 px-2.5 py-1.5">
          Selected: <span className="font-mono text-navy/60">{selected.code}</span> — {selected.name}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-navy/70">
        <span className="font-mono uppercase tracking-widest text-[10px] text-navy/40">Scope</span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name={`scope-${line.id}`} checked={scope === "once"} onChange={() => setScope("once")} disabled={busy} />
          This case only
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name={`scope-${line.id}`} checked={scope === "always"} onChange={() => setScope("always")} disabled={busy} />
          <span className="text-amber-700 font-semibold">Always (future cases too)</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={busy || !selected}
          onClick={assign}
          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Saving…" : "Assign"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={markNoteOnly}
          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-surface-300/60 text-navy/70 hover:text-navy hover:border-navy/30 transition-colors disabled:opacity-40"
        >
          Not a line item — send as a note
        </button>
        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3 py-1.5 rounded-full text-xs font-semibold text-navy/40 hover:text-navy transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── One order line row ───────────────────────────────────────────────────────

function LineRow({ caseId, line, locked, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(line.status === "open" && !line.noteOnly);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const del = async () => {
    const ok = window.confirm(`Remove "${line.name || line.sourceLabel || "this line"}" from the order?`);
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/admin/rx-cases/${caseId}/lines/${line.id}`);
      onDeleted(line.id);
    } catch (err) {
      setError(errMsg(err));
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 border-b border-surface-300/30 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-navy">{line.name || line.sourceLabel || "Unnamed line"}</span>
            <LineStatusBadge line={line} />
            {line.origin === "manual" && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-700">
                Edited
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-navy/50">
            {line.seazonaCode && <span className="font-mono">Code {line.seazonaCode}</span>}
            {line.arch && <span>{line.arch}</span>}
            {line.sourceLabel && line.sourceLabel !== line.name && (
              <span>From: {line.sourceLabel}</span>
            )}
          </div>
        </div>

        {!locked && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {!(line.status === "open" && !line.noteOnly) && (
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-navy/30 hover:text-navy hover:bg-surface-100 transition-all"
                title="Edit this line"
              >
                <Pencil size={13} />
              </button>
            )}
            <button
              type="button"
              disabled={deleting}
              onClick={del}
              className="w-7 h-7 rounded-full flex items-center justify-center text-navy/30 hover:text-red-600 hover:bg-red-50 transition-all disabled:opacity-40"
              title="Delete this line"
            >
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!locked && editing && (
        <LineEditor
          caseId={caseId}
          line={line}
          onSaved={(updated) => {
            onSaved(updated);
            setEditing(updated.status === "open" && !updated.noteOnly);
          }}
          onCancel={line.status !== "open" || line.noteOnly ? () => setEditing(false) : undefined}
        />
      )}
    </div>
  );
}

// ── Add-line form ────────────────────────────────────────────────────────────

function AddLineForm({ caseId, onAdded, onClose }) {
  const [name, setName] = useState("");
  const [arch, setArch] = useState("");
  const [noteOnly, setNoteOnly] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/admin/rx-cases/${caseId}/lines`, {
        name: name.trim(),
        arch: arch || null,
        noteOnly,
        seazonaCode: noteOnly ? null : selected?.code || null,
        sourceLabel: name.trim(),
      });
      onAdded(res.data.data);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 rounded-2xl border border-dashed border-surface-300/70 bg-surface-50 space-y-3 mb-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono uppercase tracking-widest text-navy/50">Add a line the resolver missed</h3>
        <button type="button" onClick={onClose} className="text-navy/30 hover:text-navy">
          <X size={14} />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          type="text"
          className="px-3 py-2 rounded-lg border border-surface-300/60 bg-white text-sm text-navy focus:outline-none focus:border-brand-500"
          placeholder="Name (required)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <select
          className="px-3 py-2 rounded-lg border border-surface-300/60 bg-white text-sm text-navy focus:outline-none focus:border-brand-500"
          value={arch}
          onChange={(e) => setArch(e.target.value)}
          disabled={busy}
        >
          <option value="">Arch (optional)</option>
          <option value="Upper">Upper</option>
          <option value="Lower">Lower</option>
          <option value="Both">Both</option>
        </select>
      </div>

      <label className="flex items-center gap-2 text-xs text-navy/70 cursor-pointer">
        <input type="checkbox" checked={noteOnly} onChange={(e) => setNoteOnly(e.target.checked)} disabled={busy} />
        This is a build instruction, not a charged product (send as a note)
      </label>

      {!noteOnly && (
        <div>
          <CatalogPicker disabled={busy} onPick={(r) => setSelected(r)} />
          {selected && (
            <div className="mt-1.5 text-xs text-navy/70 bg-white rounded-lg border border-surface-300/50 px-2.5 py-1.5">
              Selected: <span className="font-mono text-navy/60">{selected.code}</span> — {selected.name}
              {" "}
              <button type="button" className="text-navy/30 hover:text-red-600 ml-1" onClick={() => setSelected(null)}>
                <X size={11} className="inline" />
              </button>
            </div>
          )}
          <p className="mt-1 text-[11px] text-navy/40">
            Leave this blank if you don't have a code yet — you can resolve it after adding.
          </p>
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="px-4 py-2 rounded-full text-xs font-semibold bg-navy text-white hover:bg-navy/90 transition-colors disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add line"}
      </button>
    </div>
  );
}

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

function FileRow({ caseId, file }) {
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

// ── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "order", label: "Order", icon: ClipboardList },
  { key: "prescription", label: "Prescription", icon: FileText },
  { key: "files", label: "Files", icon: FileStack },
  { key: "history", label: "History", icon: HistoryIcon },
];

// ── Main page ────────────────────────────────────────────────────────────────

export function AdminRxCaseDetailPage() {
  const { id } = useParams();
  const { addToast } = useToast();
  const { user } = useAuth();
  const canEdit = user?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [caseRow, setCaseRow] = useState(null);
  const [lines, setLines] = useState([]);
  const [files, setFiles] = useState([]);
  const [prescription, setPrescription] = useState(null);

  const [tab, setTab] = useState("order");
  const [addingLine, setAddingLine] = useState(false);

  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState(null);
  const [confirmLegacyOpen, setConfirmLegacyOpen] = useState(false);
  const [labOrder, setLabOrder] = useState(null);
  const [reResolving, setReResolving] = useState(false);
  const [reResolveError, setReResolveError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/rx-cases/${id}`);
      const { case: c, lines: l, files: f, prescription: p, labOrder: lo } = res.data.data;
      setCaseRow(c);
      setLines(l || []);
      setFiles(f || []);
      setPrescription(p || {});
      setLabOrder(lo || null);
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="py-20 flex items-center justify-center text-navy/40">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading case…
      </div>
    );
  }

  if (error || !caseRow) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <Link to={ROUTES.ADMIN_RX_CASES} className="inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy mb-6">
          <ArrowLeft size={12} /> Back to queue
        </Link>
        <div className="py-20 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500/40" />
          <p className="text-sm text-navy/60">{error || "Case not found."}</p>
        </div>
      </div>
    );
  }

  const locked = caseRow.status === "pushed" || caseRow.status === "released";
  const readOnly = locked || !canEdit;
  const legacyPushUnconfirmed = caseRow.seazonaPushStatus === "pushing";
  const blockedReason = releaseBlockedReason(lines);
  const resolution = resolutionLabel(caseRow.seazonaPushStatus);
  const patientName = `${caseRow.patientFirst || ""} ${caseRow.patientLast || ""}`.trim();

  const applyCaseUpdate = (patch) => setCaseRow((prev) => ({ ...prev, ...patch }));

  const handleLineSaved = (updated) => {
    setLines((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
  };
  const handleLineDeleted = (lineId) => {
    setLines((prev) => prev.filter((l) => l.id !== lineId));
  };
  const handleLineAdded = (created) => {
    setLines((prev) => [...prev, created]);
  };

  // A legacy case stuck at seazonaPushStatus "pushing" may already be in Seazona.
  // Staff must confirm they checked before the server will release it.
  const startRelease = () => (legacyPushUnconfirmed ? setConfirmLegacyOpen(true) : doRelease(false));

  const doRelease = async (confirmNotInSeazona) => {
    setConfirmLegacyOpen(false);
    setReleasing(true);
    setReleaseError(null);
    try {
      const res = await api.post(`/admin/rx-cases/${id}/release`, { confirmNotInSeazona });
      const { labOrder: lo, unknownCodes } = res.data.data;
      addToast({
        message: `Released as order #${lo.orderNumber}.${unknownCodes.length ? ` Not in the catalog yet: ${unknownCodes.join(", ")}.` : ""}`,
        type: "success",
      });
      await load();
    } catch (err) {
      setReleaseError(errMsg(err));
    } finally {
      setReleasing(false);
    }
  };

  const doReResolve = async () => {
    const ok = window.confirm(
      "This recomputes lines from the prescription. Staff-edited lines are kept as-is; only untouched auto lines are replaced. Continue?"
    );
    if (!ok) return;
    setReResolving(true);
    setReResolveError(null);
    try {
      const res = await api.post(`/admin/rx-cases/${id}/re-resolve`);
      setLines(res.data.data.lines || []);
      addToast({
        message: `Re-resolved: ${res.data.data.replaced} replaced, ${res.data.data.kept} kept.`,
        type: "info",
      });
    } catch (err) {
      setReResolveError(errMsg(err));
    } finally {
      setReResolving(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <Link to={ROUTES.ADMIN_RX_CASES} className="inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy mb-6">
        <ArrowLeft size={12} /> Back to queue
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-navy/40 uppercase tracking-widest">
            <ClipboardList size={12} />
            Rx Case
          </div>
          <h1 className="mt-2 font-heading font-bold text-3xl text-navy tracking-tight">
            {caseRow.caseNumber || "Case"}
          </h1>
          <div className="mt-2 text-sm text-navy/50">
            {patientName && <span>Patient: <span className="text-navy">{patientName}</span></span>}
            {caseRow.practiceName && <span className="ml-3">Practice: <span className="text-navy">{caseRow.practiceName}</span></span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {resolution && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-700">
              <Tag size={11} /> {resolution}
            </span>
          )}
          <span className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${statusColor(caseRow.status)}`}>
            {caseStatusLabel(caseRow.status)}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-surface-300/50">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-all ${
                active ? "border-navy text-navy" : "border-transparent text-navy/40 hover:text-navy/70"
              }`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Order tab ─────────────────────────────────────────────────── */}
      {tab === "order" && (
        <div className="space-y-5">
          {!locked && canEdit && (
            <div className="bg-white rounded-2xl border border-surface-300/50 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-heading font-bold text-sm text-navy mb-1">Release to the lab</h2>
                  <p className="text-xs text-navy/50 max-w-md">
                    Puts this case on the production board as a lab order, with its lines exactly as they are now.
                    {legacyPushUnconfirmed && " A Seazona push for this case was started and never confirmed — check Seazona for an order before releasing."}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <button
                    type="button"
                    disabled={releasing || !!blockedReason}
                    onClick={startRelease}
                    title={blockedReason || undefined}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-bold bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send size={14} /> {releasing ? "Releasing…" : "Release to lab"}
                  </button>
                  {blockedReason && <span className="text-[11px] text-red-600 max-w-xs text-right">{blockedReason}</span>}
                </div>
              </div>
              {releaseError && (
                <div className="mt-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                  <span>{releaseError}</span>
                </div>
              )}
            </div>
          )}

          {locked && (
            <Banner tone="success" icon={CheckCircle2}>
              {caseRow.status === "released" ? (
                <>
                  On the production board
                  {labOrder && (
                    <>
                      {" "}as{" "}
                      <Link to={labOrderPath(labOrder.id)} className="font-mono font-semibold underline">order #{labOrder.orderNumber}</Link>
                      {" "}({LAB_STATUS_LABELS[labOrder.status]})
                    </>
                  )}
                  . Its lines are locked — change the lab order instead.
                </>
              ) : (
                <>
                  {resolution || "Sent to Seazona (legacy)"} — sent before the lab moved to the portal. Its lines are locked; correct it in Seazona.
                  {caseRow.seazonaOrderId && <span className="block mt-1 font-mono text-xs">Seazona order #{caseRow.seazonaOrderId}</span>}
                </>
              )}
            </Banner>
          )}

          {caseRow.status === "failed" && caseRow.seazonaPushError && (
            <Banner tone="error" icon={AlertCircle}>
              Legacy Seazona push failed: {caseRow.seazonaPushError}. Releasing to the lab replaces that push.
            </Banner>
          )}

          {/* Lines */}
          <div className="bg-white rounded-2xl border border-surface-300/50 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-300/40">
              <h2 className="font-heading font-bold text-sm text-navy">
                Order lines <span className="text-navy/30 font-normal">({lines.length})</span>
              </h2>
              {!readOnly && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={reResolving}
                    onClick={doReResolve}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all disabled:opacity-50"
                  >
                    <RotateCcw size={12} className={reResolving ? "animate-spin" : ""} /> Re-resolve
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingLine((v) => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all"
                  >
                    <Plus size={12} /> Add line
                  </button>
                </div>
              )}
            </div>

            {reResolveError && (
              <div className="mx-5 mt-4 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                <span>{reResolveError}</span>
              </div>
            )}

            {addingLine && !readOnly && (
              <div className="p-4">
                <AddLineForm caseId={id} onAdded={handleLineAdded} onClose={() => setAddingLine(false)} />
              </div>
            )}

            {lines.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-navy/40">No lines on this case yet.</p>
            ) : (
              <div>
                {lines.map((line) => (
                  <LineRow
                    key={line.id}
                    caseId={id}
                    line={line}
                    locked={readOnly}
                    onSaved={handleLineSaved}
                    onDeleted={handleLineDeleted}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Prescription tab ──────────────────────────────────────────── */}
      {tab === "prescription" && (
        <div className="space-y-5">
          <Banner tone="info" icon={Info}>
            This is the doctor's original submission. It is a clinical record and is never editable here —
            correct the derived order on the Order tab instead.
          </Banner>

          <div className="bg-white rounded-2xl border border-surface-300/50 p-6">
            <h2 className="font-heading font-bold text-sm text-navy mb-4">Patient &amp; case</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
              <Field label="Patient" value={patientName} />
              <Field label="DOB" value={caseRow.dob} />
              <Field label="Gender" value={caseRow.gender} />
              <Field label="Contact phone" value={caseRow.contactPhone} />
              <Field label="Records method" value={caseRow.recordsMethod} />
              <Field label="Physical bite" value={caseRow.physicalBite} />
              <Field label="Device" value={caseRow.deviceKey} />
              <Field label="Device category" value={caseRow.deviceCategory} />
              <Field label="Due date" value={caseRow.dueDate} />
              <Field label="Rush" value={caseRow.rush ? (caseRow.rushTier || "Yes") : "No"} />
              <Field label="Ship to" value={formatAnswer(caseRow.shipTo)} className="sm:col-span-2 md:col-span-3" />
            </div>
            {caseRow.generalComments && (
              <div className="mt-5 pt-5 border-t border-surface-300/40">
                <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest mb-1.5">General comments</div>
                <p className="text-sm text-navy/70 whitespace-pre-wrap leading-relaxed">{caseRow.generalComments}</p>
              </div>
            )}
          </div>

          {caseRow.deviceOptions?.devices?.length > 0 && (
            <div className="bg-white rounded-2xl border border-surface-300/50 p-6">
              <h2 className="font-heading font-bold text-sm text-navy mb-4">Device selections</h2>
              <div className="space-y-3">
                {caseRow.deviceOptions.devices.map((d, i) => (
                  <div key={`${d.deviceKey || d.label || i}`} className="p-3 rounded-xl bg-surface-50 border border-surface-300/40">
                    <div className="text-sm font-semibold text-navy mb-1">{d.label || d.deviceKey}</div>
                    <div className="text-xs text-navy/60">{formatAnswer(d) || "—"}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {prescription && Object.keys(prescription).length > 0 && (
            <div className="bg-white rounded-2xl border border-surface-300/50 p-6">
              <h2 className="font-heading font-bold text-sm text-navy mb-4">Full submission</h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(prescription)
                  .map(([k, v]) => [k, formatAnswer(v)])
                  .filter(([, v]) => v !== null)
                  .map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-3 px-3 py-2 bg-surface-50 rounded-lg">
                      <dt className="text-xs text-navy/50 flex-shrink-0">{humanizeKey(k)}</dt>
                      <dd className="text-sm font-medium text-navy text-right break-words">{v}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
        </div>
      )}

      {/* ── Files tab ─────────────────────────────────────────────────── */}
      {tab === "files" && (
        <div className="bg-white rounded-2xl border border-surface-300/50 p-6">
          <h2 className="font-heading font-bold text-sm text-navy mb-4">Files</h2>
          {files.length === 0 ? (
            <p className="text-sm text-navy/40">No files were uploaded with this case.</p>
          ) : (
            <div className="space-y-2">
              {files.map((f) => (
                <FileRow key={f.id} caseId={id} file={f} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History tab ───────────────────────────────────────────────── */}
      {tab === "history" && (
        <div className="bg-white rounded-2xl border border-surface-300/50 p-6">
          <h2 className="font-heading font-bold text-sm text-navy mb-4">History</h2>
          <dl className="space-y-3">
            <div className="flex items-center justify-between px-3 py-2.5 bg-surface-50 rounded-lg">
              <dt className="text-xs text-navy/50">Submitted</dt>
              <dd className="text-sm font-medium text-navy">{formatDateTime(caseRow.createdAt)}</dd>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5 bg-surface-50 rounded-lg">
              <dt className="text-xs text-navy/50">Last updated</dt>
              <dd className="text-sm font-medium text-navy">{formatDateTime(caseRow.updatedAt)}</dd>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5 bg-surface-50 rounded-lg">
              <dt className="text-xs text-navy/50">Current status</dt>
              <dd className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusColor(caseRow.status)}`}>
                {caseStatusLabel(caseRow.status)}
              </dd>
            </div>
            {resolution && (
              <div className="flex items-center justify-between px-3 py-2.5 bg-surface-50 rounded-lg">
                <dt className="text-xs text-navy/50">Resolution</dt>
                <dd className="text-sm font-medium text-navy">{resolution}</dd>
              </div>
            )}
            {caseRow.seazonaOrderId && (
              <div className="flex items-center justify-between px-3 py-2.5 bg-surface-50 rounded-lg">
                <dt className="text-xs text-navy/50">Seazona order # (legacy)</dt>
                <dd className="text-sm font-mono text-navy">{caseRow.seazonaOrderId}</dd>
              </div>
            )}
            {caseRow.seazonaPushError && (
              <div className="px-3 py-2.5 bg-red-50 rounded-lg">
                <dt className="text-xs text-red-600/70 mb-0.5">Legacy push error</dt>
                <dd className="text-sm text-red-700">{caseRow.seazonaPushError}</dd>
              </div>
            )}
          </dl>
          <p className="mt-4 text-[11px] text-navy/30">
            This reflects the case's current state. A full step-by-step audit log isn't exposed to this page yet.
          </p>
        </div>
      )}

      <Modal open={confirmLegacyOpen} onClose={() => setConfirmLegacyOpen(false)} title="Check Seazona first">
        <p className="text-sm text-navy/70">
          A Seazona push for this case started and was never confirmed, so an order for it may already exist there.
          Only continue if you checked Seazona and there is no order for this case — otherwise the lab will build it twice.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmLegacyOpen(false)} className="px-4 py-2 rounded-full text-sm font-semibold text-navy/50 hover:text-navy">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => doRelease(true)}
            className="px-4 py-2 rounded-full text-sm font-bold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
          >
            No Seazona order exists — release
          </button>
        </div>
      </Modal>
    </div>
  );
}
