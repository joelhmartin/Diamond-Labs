import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Search,
  X,
} from "lucide-react";
import api from "../../config/api.js";
import { FormRenderer } from "../../components/rx/FormRenderer.jsx";
import { FORM_LIST, getForm } from "../../data/forms/index.js";
import { formAnswersToCaseInput } from "../../data/forms/form-to-case.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function errMsg(err) {
  return (
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    "Unexpected error"
  );
}

// ── Status chip config ───────────────────────────────────────────────────────

const STATUS_CHIP = {
  confirmed:   "bg-emerald-500/10 text-emerald-700",
  placeholder: "bg-amber-500/10  text-amber-700",
  unmapped:    "bg-red-500/10    text-red-600",
};

const ROW_TINT = {
  confirmed:   "",
  placeholder: "bg-amber-50/40",
  unmapped:    "bg-red-50/40",
};

// ── Sub-components ───────────────────────────────────────────────────────────

/**
 * Inline catalog search + optional note field, rendered inside a table row's
 * action cell for placeholder/unmapped lines.
 */
function CatalogSearchRow({ mapKey, onAssign, busy }) {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen]       = useState(false);
  const [searching, setSearching] = useState(false);
  const [note, setNote]       = useState("");
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

  const pick = (code) => {
    onAssign(mapKey, code, note);
    setQuery("");
    setResults([]);
    setOpen(false);
    setNote("");
  };

  return (
    <div className="flex flex-col gap-1.5 min-w-[200px]">
      {/* Code search */}
      <div className="relative">
        <Search
          size={11}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy/30 pointer-events-none"
        />
        <input
          type="text"
          className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-surface-300/60 bg-white text-xs text-navy focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/10 placeholder:text-navy/25 disabled:opacity-50"
          placeholder="Search catalog…"
          disabled={busy}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            doSearch(e.target.value);
          }}
        />
        {searching && (
          <Loader2
            size={10}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-navy/40"
          />
        )}
      </div>

      {/* Dropdown results */}
      {open && results.length > 0 && (
        <div className="rounded-lg border border-surface-300/60 bg-white shadow-sm divide-y divide-surface-200/60 max-h-36 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.code}
              type="button"
              disabled={busy}
              onClick={() => pick(r.code)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-surface-50 transition-colors"
            >
              <span className="font-mono text-navy/60 mr-1.5">{r.code}</span>
              <span className="text-navy/80">{r.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Optional note */}
      <input
        type="text"
        className="w-full px-2.5 py-1.5 rounded-lg border border-surface-300/40 bg-surface-50 text-xs text-navy placeholder:text-navy/25 focus:outline-none focus:border-brand-500 disabled:opacity-50"
        placeholder="Note (optional)"
        disabled={busy}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </div>
  );
}

/** Modal that runs the preview and lets you assign / clear overrides. */
function PreviewModal({ devices, caseFields, onClose }) {
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [preview, setPreview]       = useState(null);
  const [saving, setSaving]         = useState(null); // mapKey currently being saved
  const [sending, setSending]       = useState(false);
  const [sendResult, setSendResult] = useState(null); // { seazonaOrderId, itemCount, droppedLines }
  const [sendError, setSendError]   = useState(null); // string

  /** Build the shared request body used by both preview and send-test. */
  const buildBody = useCallback(() => {
    const body = {
      devices: (devices || []).map((d) => ({
        deviceKey:     d.deviceKey,
        deviceOptions: d.deviceOptions,
        label:         d.label,
      })),
      patientFirst:    caseFields.patientFirst,
      patientLast:     caseFields.patientLast,
      recordsMethod:   caseFields.recordsMethod,
      physicalBite:    caseFields.physicalBite,
      firstDevice:     caseFields.firstDevice,
      rush:            caseFields.rush,
    };
    if (caseFields.generalComments) body.generalComments = caseFields.generalComments;
    if (caseFields.dob)     body.dob      = caseFields.dob;
    if (caseFields.dueDate) body.dueDate  = caseFields.dueDate;
    if (caseFields.rush)    body.rushTier = caseFields.rushTier;
    return body;
  }, [devices, caseFields]);

  const runPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    // A re-preview supersedes any prior send result/error — clear stale banners.
    setSendResult(null);
    setSendError(null);
    // Drop the stale preview so the real-send button (disabled on !preview) can't
    // fire against outdated mapping output while a re-preview is in flight or fails.
    setPreview(null);
    try {
      const res = await api.post("/admin/rx-mapping/preview", buildBody());
      setPreview(res.data.data);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [buildBody]);

  const handleSendTest = async () => {
    const ok = window.confirm(
      "This creates a REAL order in Seazona under the Matt Rago test account (no sandbox exists). Only do this for testing, and cancel the order in Seazona afterward. Continue?"
    );
    if (!ok) return;
    setSending(true);
    setSendResult(null);
    setSendError(null);
    try {
      const res = await api.post("/admin/rx-mapping/send-test", {
        ...buildBody(),
        confirm: true,
      });
      setSendResult(res.data.data);
    } catch (err) {
      // The 422 "no valid items" path returns meta.warnings (the unmapped/no-code
      // lines) — surface them so the admin sees exactly what to confirm first.
      const dropped = err.response?.data?.meta?.warnings;
      const msg = errMsg(err);
      setSendError(
        Array.isArray(dropped) && dropped.length
          ? `${msg} — unresolved: ${dropped.join(", ")}`
          : msg
      );
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    runPreview();
  }, [runPreview]);

  const handleAssign = async (mapKey, seazonaCode, note) => {
    setSaving(mapKey);
    try {
      await api.put("/admin/rx-mapping/override", {
        mapKey,
        seazonaCode,
        ...(note ? { note } : {}),
      });
      await runPreview();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(null);
    }
  };

  const handleClear = async (mapKey) => {
    setSaving(mapKey);
    try {
      await api.delete(
        `/admin/rx-mapping/override/${encodeURIComponent(mapKey)}`
      );
      await runPreview();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(null);
    }
  };

  const cov = preview?.coverage;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-navy/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-300/40">
          <div>
            <h2 className="font-heading font-bold text-lg text-navy">
              Mapping Preview
            </h2>
            <p className="text-xs font-mono text-navy/40 mt-0.5">
              {(devices || []).map((d) => d.label || d.deviceKey).join(", ") || "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-navy/30 hover:text-navy hover:bg-surface-100 transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading && (
            <div className="py-16 flex items-center justify-center text-navy/40">
              <Loader2 size={18} className="animate-spin mr-2" />
              Running preview…
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
              <AlertCircle
                size={16}
                className="mt-0.5 flex-shrink-0 text-red-500"
              />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Send-test result banners (visible whenever a result/error exists) */}
          {sendResult && (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <CheckCircle2
                size={16}
                className="mt-0.5 flex-shrink-0 text-emerald-600"
              />
              <div className="text-sm text-emerald-800 space-y-2">
                <p className="font-semibold">
                  Test order created in Seazona — Order {sendResult.seazonaOrderId} (
                  {sendResult.itemCount} line item
                  {sendResult.itemCount !== 1 ? "s" : ""})
                </p>
                {sendResult.droppedLines?.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 text-xs">
                    <span className="font-semibold">
                      {sendResult.droppedLines.length} line
                      {sendResult.droppedLines.length !== 1 ? "s" : ""} were not sent
                      (no confirmed code):
                    </span>{" "}
                    {sendResult.droppedLines.join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}
          {sendError && (
            <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
              <AlertCircle
                size={16}
                className="mt-0.5 flex-shrink-0 text-red-500"
              />
              <p className="text-sm text-red-700">{sendError}</p>
            </div>
          )}

          {!loading && preview && (
            <>
              {/* Patient + Due */}
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 pb-3 border-b border-surface-300/30">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-navy/40 mr-2">
                    Patient
                  </span>
                  <span className="text-sm font-semibold text-navy">
                    {preview.patientName || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-navy/40 mr-2">
                    Due
                  </span>
                  <span className="text-sm text-navy/70">
                    {preview.due || "—"}
                  </span>
                </div>
              </div>

              {/* Coverage summary */}
              {cov && (
                <p className="text-sm font-mono text-navy/60">
                  <span className="text-emerald-700 font-semibold">
                    {cov.confirmed} confirmed
                  </span>
                  {" · "}
                  <span className="text-amber-700 font-semibold">
                    {cov.placeholder} placeholder
                  </span>
                  {" · "}
                  <span className="text-red-600 font-semibold">
                    {cov.unmapped} unmapped
                  </span>
                  {" of "}
                  <span className="text-navy font-semibold">{cov.total}</span>
                </p>
              )}

              {/* Lines, grouped by device */}
              <div className="space-y-5">
                {(preview.devices || []).map((grp) => {
                  const groupLines = (preview.lines || []).filter(
                    (l) => l.device === grp.label
                  );
                  return (
                    <div key={`${grp.deviceKey}:${grp.label}`}>
                      {/* Group header */}
                      <div className="flex items-center justify-between mb-2 px-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-navy">
                            {grp.label}
                          </span>
                          <span className="text-[10px] font-mono text-navy/30">
                            {grp.deviceKey}
                          </span>
                        </div>
                        <span className="text-xs font-mono text-navy/60">
                          <span className="text-emerald-700 font-semibold">{grp.confirmed}</span>
                          {" · "}
                          <span className="text-amber-700 font-semibold">{grp.placeholder}</span>
                          {" · "}
                          <span className="text-red-600 font-semibold">{grp.unmapped}</span>
                        </span>
                      </div>

                      <div className="rounded-2xl border border-surface-300/50 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-surface-100">
                              {["Map Key", "Name", "Code", "Arch", "Status", "Action"].map(
                                (h) => (
                                  <th
                                    key={h}
                                    className="text-left px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal whitespace-nowrap"
                                  >
                                    {h}
                                  </th>
                                )
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {groupLines.map((line, idx) => (
                              <tr
                                key={`${line.device}:${line.mapKey}:${idx}`}
                                className={`border-t border-surface-300/30 align-top ${ROW_TINT[line.status] || ""}`}
                              >
                                <td className="px-4 py-3 font-mono text-[11px] text-navy/50 whitespace-nowrap">
                                  {line.mapKey}
                                </td>
                                <td className="px-4 py-3 text-sm text-navy/80">
                                  {line.name || "—"}
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-navy/60 whitespace-nowrap">
                                  {line.code || "—"}
                                </td>
                                <td className="px-4 py-3 text-xs text-navy/60 whitespace-nowrap">
                                  {line.arch || "—"}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span
                                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                      STATUS_CHIP[line.status] || "bg-gray-200 text-gray-700"
                                    }`}
                                  >
                                    {line.status}
                                  </span>
                                  {line.overridden && (
                                    <span className="ml-1.5 text-[10px] font-mono text-navy/30">
                                      override
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {(line.status === "placeholder" ||
                                    line.status === "unmapped") && (
                                    <CatalogSearchRow
                                      mapKey={line.mapKey}
                                      onAssign={handleAssign}
                                      busy={saving === line.mapKey}
                                    />
                                  )}
                                  {line.status === "confirmed" &&
                                    line.overridden && (
                                      <button
                                        type="button"
                                        disabled={saving === line.mapKey}
                                        onClick={() => handleClear(line.mapKey)}
                                        className="text-[11px] font-mono text-red-400 hover:text-red-600 hover:underline transition-colors disabled:opacity-50"
                                      >
                                        {saving === line.mapKey ? "…" : "Clear override"}
                                      </button>
                                    )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Notes block — full output incl. records/bite/occlusal/design/mods/rush/comments */}
              {preview.notes && (
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-navy/40 mb-2">
                    Notes
                  </div>
                  <pre className="rounded-xl bg-surface-50 border border-surface-300/40 px-4 py-3 text-xs font-mono text-navy/60 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                    {preview.notes}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-surface-300/40">
          <button
            type="button"
            onClick={handleSendTest}
            disabled={sending || loading || !preview}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-all disabled:opacity-40"
          >
            {sending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Sending…
              </>
            ) : (
              "Send test order to Seazona (Matt Rago)"
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-full text-sm font-semibold bg-surface-100 text-navy hover:bg-surface-200 transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function AdminRxMappingPage() {
  // Selected source form (default: first in the chooser).
  const [slug, setSlug]             = useState(FORM_LIST[0]?.slug || "digital");
  // Computed case input handed to PreviewModal once a form is completed.
  const [caseInput, setCaseInput]   = useState(null); // { devices, caseFields }
  const [showModal, setShowModal]   = useState(false);

  const form = getForm(slug);

  const chooseForm = (nextSlug) => {
    if (nextSlug === slug) return;
    setSlug(nextSlug);
    setShowModal(false);
    setCaseInput(null);
  };

  // Final validated submit from FormRenderer → compute case input + open preview.
  const handleComplete = (answers) => {
    const { devices, caseFields } = formAnswersToCaseInput(slug, form, answers);
    setCaseInput({ devices, caseFields });
    setShowModal(true);
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="font-heading font-bold text-3xl text-navy tracking-tight">
          Rx Mapping Tester
        </h1>
        <p className="mt-1 text-sm text-navy/50">
          Fill out a full Rx form exactly as a doctor would, then preview the
          Seazona order it generates and optionally send a test order.
        </p>
      </div>

      {/* ── Form chooser ── */}
      <div className="mb-8">
        <div className="text-[10px] font-mono uppercase tracking-widest text-navy/40 px-1 mb-2">
          Select a form
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {FORM_LIST.map((f) => {
            const active = f.slug === slug;
            return (
              <button
                key={f.slug}
                type="button"
                onClick={() => chooseForm(f.slug)}
                className={`text-left px-5 py-4 rounded-2xl border transition-all ${
                  active
                    ? "bg-brand-50 border-brand-300/60"
                    : "bg-white border-surface-300/50 hover:border-brand-300/40 hover:bg-surface-50"
                }`}
              >
                <div className="font-semibold text-sm text-navy">{f.title}</div>
                <div className="font-mono text-[10px] text-navy/40 mt-1">
                  {f.slug}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Full faithful form ── */}
      {form ? (
        <FormRenderer key={slug} form={form} onComplete={handleComplete} />
      ) : (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-xl px-4 py-3">
          No form definition found for <span className="font-mono">{slug}</span>.
        </p>
      )}

      {/* Preview modal */}
      {showModal && caseInput && (
        <PreviewModal
          devices={caseInput.devices}
          caseFields={caseInput.caseFields}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
