import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import api from "../../config/api.js";
import { RX_DEVICES } from "../../data/rx-devices.js";
import {
  RECORDS_METHODS,
  PHYSICAL_BITE,
  FIRST_DEVICE,
  RUSH_TIERS,
} from "../../data/rx-records.js";
import { DeviceOptionsPanel } from "../../components/rx/DeviceOptionsPanel.jsx";

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

// ── Default case fields ──────────────────────────────────────────────────────

const DEFAULT_CASE_FIELDS = {
  patientFirst:    "Test",
  patientLast:     "Patient",
  dob:             "",
  recordsMethod:   "itero",
  physicalBite:    PHYSICAL_BITE[0].value,      // "no_digital"
  firstDevice:     FIRST_DEVICE[0],              // "Yes"
  dueDate:         "",
  rush:            false,
  rushTier:        Object.keys(RUSH_TIERS)[0],  // "nylon"
  generalComments: "",
};

// ── Shared input class for case-details fields ───────────────────────────────

const CF_INPUT =
  "w-full px-3 py-2 rounded-xl bg-surface-50 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

// ── Lookup: deviceKey → RX_DEVICES entry (category etc.) ────────────────────

const RX_DEVICE_BY_KEY = Object.fromEntries(RX_DEVICES.map((d) => [d.key, d]));

// ── Sub-components ───────────────────────────────────────────────────────────

function CoverageBadge({ mapped, total }) {
  const full = total > 0 && mapped === total;
  return (
    <span
      className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono tabular-nums ${
        full
          ? "bg-emerald-500/10 text-emerald-700"
          : "bg-amber-500/10 text-amber-700"
      }`}
    >
      {mapped}/{total}
    </span>
  );
}

/** Grouped device list section with label header. */
function DeviceGroup({ label, devices, selectedKey, onSelect }) {
  if (devices.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-[9px] font-mono uppercase tracking-widest text-navy/30 px-1 pt-3 pb-0.5">
        {label}
      </div>
      {devices.map((d) => {
        const active = selectedKey === d.deviceKey;
        return (
          <button
            key={d.deviceKey}
            type="button"
            onClick={() => onSelect(d.deviceKey)}
            className={`w-full text-left flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border transition-all ${
              active
                ? "bg-brand-50 border-brand-300/60"
                : "bg-white border-surface-300/50 hover:border-brand-300/40 hover:bg-surface-50"
            }`}
          >
            <div className="min-w-0">
              <div className="font-semibold text-sm text-navy truncate">
                {d.name}
              </div>
              <div className="font-mono text-[10px] text-navy/40 truncate mt-0.5">
                {d.deviceKey}
              </div>
            </div>
            <CoverageBadge
              mapped={d.coverage?.mapped ?? 0}
              total={d.coverage?.total ?? 0}
            />
          </button>
        );
      })}
    </div>
  );
}

/** Fake case-details form — gives the mapping tester full doctor-form context. */
function CaseDetailsForm({ fields, onChange }) {
  const rushTierEntries = Object.entries(RUSH_TIERS);

  const set = (key) => (e) => {
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    onChange({ ...fields, [key]: val });
  };

  return (
    <div className="rounded-2xl border border-dashed border-surface-300/60 bg-surface-50/40 p-5 space-y-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-navy/40">
        Case details — fake test input
      </div>

      {/* Patient name */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-navy/40 uppercase tracking-wider mb-1.5">
            First name
          </label>
          <input
            type="text"
            className={CF_INPUT}
            value={fields.patientFirst}
            onChange={set("patientFirst")}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-navy/40 uppercase tracking-wider mb-1.5">
            Last name
          </label>
          <input
            type="text"
            className={CF_INPUT}
            value={fields.patientLast}
            onChange={set("patientLast")}
          />
        </div>
      </div>

      {/* DOB */}
      <div>
        <label className="block text-[11px] font-semibold text-navy/40 uppercase tracking-wider mb-1.5">
          Date of birth{" "}
          <span className="font-normal normal-case text-navy/25">(optional)</span>
        </label>
        <input
          type="date"
          className={CF_INPUT}
          value={fields.dob}
          onChange={set("dob")}
        />
      </div>

      {/* Records method */}
      <div>
        <label className="block text-[11px] font-semibold text-navy/40 uppercase tracking-wider mb-1.5">
          Records method
        </label>
        <select
          className={CF_INPUT}
          value={fields.recordsMethod}
          onChange={set("recordsMethod")}
        >
          {RECORDS_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Physical bite */}
      <div>
        <label className="block text-[11px] font-semibold text-navy/40 uppercase tracking-wider mb-1.5">
          Physical bite
        </label>
        <select
          className={CF_INPUT}
          value={fields.physicalBite}
          onChange={set("physicalBite")}
        >
          {PHYSICAL_BITE.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      {/* First device */}
      <div>
        <label className="block text-[11px] font-semibold text-navy/40 uppercase tracking-wider mb-1.5">
          First device for this patient?
        </label>
        <select
          className={CF_INPUT}
          value={fields.firstDevice}
          onChange={set("firstDevice")}
        >
          {FIRST_DEVICE.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {/* Due date */}
      <div>
        <label className="block text-[11px] font-semibold text-navy/40 uppercase tracking-wider mb-1.5">
          Due date{" "}
          <span className="font-normal normal-case text-navy/25">(optional)</span>
        </label>
        <input
          type="date"
          className={CF_INPUT}
          value={fields.dueDate}
          onChange={set("dueDate")}
        />
      </div>

      {/* Rush */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={fields.rush}
            onChange={set("rush")}
            className="h-4 w-4 rounded border-surface-300 text-brand-500 focus:ring-brand-500/20 cursor-pointer"
          />
          <span className="text-sm text-navy/70">Rush order</span>
        </label>
        {fields.rush && (
          <select
            className={`${CF_INPUT} flex-1 min-w-[180px]`}
            value={fields.rushTier}
            onChange={set("rushTier")}
          >
            {rushTierEntries.map(([k, v]) => (
              <option key={k} value={k}>
                {v.label} (+${v.price})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* General comments */}
      <div>
        <label className="block text-[11px] font-semibold text-navy/40 uppercase tracking-wider mb-1.5">
          General comments{" "}
          <span className="font-normal normal-case text-navy/25">(optional)</span>
        </label>
        <textarea
          className={`${CF_INPUT} resize-none`}
          rows={2}
          placeholder="e.g. Patient has severe TMJ on right side…"
          value={fields.generalComments}
          onChange={set("generalComments")}
        />
      </div>
    </div>
  );
}

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
function PreviewModal({ deviceKey, deviceOptions, caseFields, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving]   = useState(null); // mapKey currently being saved

  const runPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = {
        deviceKey,
        deviceOptions,
        patientFirst:    caseFields.patientFirst,
        patientLast:     caseFields.patientLast,
        recordsMethod:   caseFields.recordsMethod,
        physicalBite:    caseFields.physicalBite,
        firstDevice:     caseFields.firstDevice,
        rush:            caseFields.rush,
        generalComments: caseFields.generalComments,
      };
      if (caseFields.dob)     body.dob     = caseFields.dob;
      if (caseFields.dueDate) body.dueDate = caseFields.dueDate;
      if (caseFields.rush)    body.rushTier = caseFields.rushTier;

      const res = await api.post("/admin/rx-mapping/preview", body);
      setPreview(res.data.data);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [deviceKey, deviceOptions, caseFields]);

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
            <p className="text-xs font-mono text-navy/40 mt-0.5">{deviceKey}</p>
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

              {/* Lines table */}
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
                    {(preview.lines || []).map((line) => (
                      <tr
                        key={line.mapKey}
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
        <div className="flex justify-end px-6 py-4 border-t border-surface-300/40">
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
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [devices, setDevices]         = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [opts, setOpts]               = useState({});
  const [caseFields, setCaseFields]   = useState(DEFAULT_CASE_FIELDS);
  const [showModal, setShowModal]     = useState(false);
  const [refreshing, setRefreshing]   = useState(false);

  const load = async () => {
    try {
      setRefreshing(true);
      const res = await api.get("/admin/rx-mapping/devices");
      setDevices(res.data.data || []);
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectDevice = (key) => {
    if (selectedKey === key) return;
    setSelectedKey(key);
    setOpts({});
    setCaseFields(DEFAULT_CASE_FIELDS);
    setShowModal(false);
  };

  // Partition devices by source form:
  //   category "ortho" → Diamond Orthodontic Rx
  //   everything else (tmd/sleep/guard/sport/remake + unknown) → Diamond Orthotic Lab Rx 2025
  const rx2025Devices = devices.filter(
    (d) => RX_DEVICE_BY_KEY[d.deviceKey]?.category !== "ortho"
  );
  const orthoDevices = devices.filter(
    (d) => RX_DEVICE_BY_KEY[d.deviceKey]?.category === "ortho"
  );

  // Prefer the full RX_DEVICES entry for the schema; the API list provides
  // name + coverage only (no options schema).
  const selectedDevice = RX_DEVICES.find((d) => d.key === selectedKey);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-heading font-bold text-3xl text-navy tracking-tight">
            Rx Mapping Tester
          </h1>
          <p className="mt-1 text-sm text-navy/50">
            Select a device, fill in fake case details, then preview the full
            Seazona product line mapping. Assign overrides inline to fix
            placeholder or unmapped lines.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-red-500" />
          <div className="text-sm text-red-700">
            <p className="font-semibold">Failed to load devices</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-20 flex items-center justify-center text-navy/40">
          <Loader2 size={18} className="animate-spin mr-2" />
          Loading devices…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* ── Device list (grouped by source form) ── */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-navy/40 px-1 mb-1">
              Devices ({devices.length})
            </div>
            {devices.length === 0 && (
              <p className="text-sm text-navy/40 px-1 mt-3">No devices returned.</p>
            )}
            <DeviceGroup
              label="Diamond Orthotic Lab Rx 2025"
              devices={rx2025Devices}
              selectedKey={selectedKey}
              onSelect={selectDevice}
            />
            <DeviceGroup
              label="Diamond Orthodontic Rx"
              devices={orthoDevices}
              selectedKey={selectedKey}
              onSelect={selectDevice}
            />
          </div>

          {/* ── Right panel: case details + device options ── */}
          <div className="lg:col-span-2">
            {!selectedKey ? (
              <div className="py-20 text-center text-navy/30">
                <p className="text-3xl mb-3 select-none">⟵</p>
                <p className="text-sm">Select a device to configure its options</p>
              </div>
            ) : (
              <div className="bg-white rounded-3xl border border-surface-300/50 p-6 space-y-6">
                {/* Device header */}
                <div>
                  <h2 className="font-heading font-semibold text-xl text-navy">
                    {selectedDevice?.fullName ||
                      selectedDevice?.name ||
                      selectedKey}
                  </h2>
                  {selectedDevice?.tagline && (
                    <p className="mt-1 text-xs text-navy/50">
                      {selectedDevice.tagline}
                    </p>
                  )}
                </div>

                {/* Fake doctor-submission fields */}
                <CaseDetailsForm
                  fields={caseFields}
                  onChange={setCaseFields}
                />

                {/* Device-specific option schema */}
                {selectedDevice?.options ? (
                  <DeviceOptionsPanel
                    schema={selectedDevice.options}
                    values={opts}
                    onChange={(key, val) =>
                      setOpts((prev) => ({ ...prev, [key]: val }))
                    }
                  />
                ) : (
                  <p className="text-sm text-amber-700 bg-amber-50 rounded-xl px-4 py-3">
                    No option schema found for{" "}
                    <span className="font-mono">{selectedKey}</span> in{" "}
                    <span className="font-mono">rx-devices.js</span>. Preview will
                    use empty options.
                  </p>
                )}

                {/* Preview trigger */}
                <div className="pt-2 border-t border-surface-300/30">
                  <button
                    type="button"
                    onClick={() => setShowModal(true)}
                    className="px-6 py-3 rounded-full bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-all"
                  >
                    Preview mapping
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preview modal */}
      {showModal && selectedKey && (
        <PreviewModal
          deviceKey={selectedKey}
          deviceOptions={opts}
          caseFields={caseFields}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
