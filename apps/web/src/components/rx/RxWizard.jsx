import { useState, useEffect, useRef } from "react";
import gsap from "gsap";
import {
  Upload,
  FileText,
  X,
  Check,
  ChevronRight,
  ChevronLeft,
  Pencil,
  Loader2,
  Send,
  Clock,
  Package,
  Search,
} from "lucide-react";
import { RX_DEVICES, CATEGORY_LABELS, CATEGORY_ORDER } from "../../data/rx-devices";
import { RECORDS_METHODS, PHYSICAL_BITE, FIRST_DEVICE, RUSH_TIERS } from "../../data/rx-records";
import { DeviceOptionsPanel } from "./DeviceOptionsPanel";
import { Signature } from "./Signature";
import { DueDatePicker } from "./DueDatePicker";

/* ════════════════════════════════════════════════════════════════
   CONSTANTS
   ════════════════════════════════════════════════════════════════ */

const STEPS = [
  "Practice & Patient",
  "Select Device",
  "Device Options",
  "Files & Signature",
  "Review",
];

const INITIAL_FORM = {
  // Practice (will be overridden by prefill)
  doctorName: "",
  practiceName: "",
  email: "",
  phone: "",
  npi: "",
  // Ship To (optional — all empty = not sent)
  shipTo: { office: "", street: "", city: "", state: "", zip: "", country: "US" },
  // Patient
  patientFirst: "",
  patientLast: "",
  dob: "",
  gender: "",
  firstDevice: "",     // one of FIRST_DEVICE strings
  physicalBite: "",    // one of PHYSICAL_BITE[].value
  // Timing
  dueDate: "",
  rush: false,
  rushTier: "",        // key from RUSH_TIERS ("nylon" | "biomedPmtAcrylic")
  // Records
  recordsMethod: "",   // one of RECORDS_METHODS[].value
  // Device
  device: null,
  deviceOptions: {},
  // Files
  scanFiles: [],
  photos: [],
  prescription: [],
  sleepStudy: [],
  artboardFiles: [],
  // Signature + misc
  signature: "",
  generalComments: "",
};

const INPUT =
  "w-full px-4 py-3 rounded-xl bg-surface-50 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

/* ════════════════════════════════════════════════════════════════
   SHARED SUB-COMPONENTS
   ════════════════════════════════════════════════════════════════ */

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-navy/40 uppercase tracking-wider mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

function StepHeader({ current, total, labels }) {
  return (
    <div className="px-6 md:px-8 pt-6 pb-5 border-b border-surface-300/30">
      <div className="h-1.5 rounded-full bg-surface-200 mb-5">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-700 ease-out"
          style={{ width: `${((current + 1) / total) * 100}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <span className="font-mono text-[10px] text-navy/30 uppercase tracking-wider">
            Step {current + 1} of {total}
          </span>
          <h2 className="font-heading font-bold text-lg text-navy tracking-tight mt-0.5">
            {labels[current]}
          </h2>
        </div>
        {current < total - 1 && (
          <span className="hidden sm:block font-mono text-[10px] text-navy/20 uppercase tracking-wider">
            Next: {labels[current + 1]}
          </span>
        )}
      </div>
    </div>
  );
}

function FileUploadZone({ label, hint, accept, files, onAdd, onRemove }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  return (
    <div>
      <label className="block text-xs font-semibold text-navy/40 uppercase tracking-wider mb-2">
        {label}
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files?.length) onAdd(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300 ${
          drag
            ? "border-brand-500 bg-brand-500/5"
            : "border-surface-300/50 bg-surface-50/50 hover:border-brand-500/30"
        }`}
      >
        <Upload
          size={24}
          className={`mx-auto mb-2 transition-colors ${
            drag ? "text-brand-500" : "text-navy/20"
          }`}
        />
        <p className="text-sm text-navy/50">
          Drag & drop files here, or{" "}
          <span className="text-brand-500 font-medium">browse</span>
        </p>
        {hint && <p className="mt-1 text-[11px] text-navy/25">{hint}</p>}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onAdd(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2.5 pl-2 pr-1.5 py-1.5 rounded-xl bg-surface-50 border border-surface-300/30"
            >
              {f.preview ? (
                <img
                  src={f.preview}
                  alt=""
                  className="w-8 h-8 rounded-lg object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-surface-200/60 flex items-center justify-center">
                  <FileText size={14} className="text-navy/30" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-navy/70 truncate max-w-[110px]">
                  {f.name}
                </p>
                <p className="text-[10px] text-navy/25">
                  {(f.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(f.id);
                }}
                className="w-6 h-6 rounded-full flex items-center justify-center text-navy/20 hover:text-red-400 hover:bg-red-50 transition-all"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecordsMethodPicker({ value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-navy/40 uppercase tracking-wider mb-3">
        Records Method
      </label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {RECORDS_METHODS.map((m) => {
          const active = value === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => onChange(active ? "" : m.value)}
              className={`relative flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all ${
                active
                  ? "border-brand-500 bg-brand-500/5"
                  : "border-surface-300/30 hover:border-brand-500/20"
              }`}
            >
              {active && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center">
                  <Check size={10} className="text-white" />
                </div>
              )}
              <div className="w-14 h-14 rounded-xl overflow-hidden bg-surface-50 flex items-center justify-center">
                <img
                  src={m.img}
                  alt={m.label}
                  className="w-full h-full object-contain p-1"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
              <span className="text-[10px] font-semibold text-navy/60 text-center leading-tight">
                {m.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PhysicalBitePicker({ value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-navy/40 uppercase tracking-wider mb-3">
        Physical Bite
      </label>
      <div className="space-y-2">
        {PHYSICAL_BITE.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(value === opt.value ? "" : opt.value)}
            className={`w-full flex items-start gap-3 p-3 text-left rounded-2xl border transition-all ${
              value === opt.value
                ? "border-brand-500 bg-brand-500/5"
                : "border-surface-300/50 hover:border-brand-500/30"
            }`}
          >
            <div
              className={`flex-shrink-0 w-4 h-4 mt-0.5 rounded-full border-2 flex items-center justify-center ${
                value === opt.value
                  ? "border-brand-500 bg-brand-500"
                  : "border-surface-400"
              }`}
            >
              {value === opt.value && (
                <div className="w-1.5 h-1.5 rounded-full bg-white" />
              )}
            </div>
            <span className="text-sm text-navy/70 leading-snug">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   DEVICE PICKER (category chips + grid)
   ════════════════════════════════════════════════════════════════ */

function CategoryChip({ label, color, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 ${
        active ? "bg-navy text-white" : `${color} hover:bg-navy/15`
      }`}
    >
      {label}
    </button>
  );
}

function DevicePicker({ selected, onSelect, query, setQuery, activeCat, setActiveCat }) {
  const filtered = RX_DEVICES.filter((d) => {
    if (activeCat !== "all" && d.category !== activeCat) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      d.name.toLowerCase().includes(q) ||
      d.fullName.toLowerCase().includes(q) ||
      d.tagline.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-navy/30"
          />
          <input
            type="text"
            placeholder="Search devices…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-full bg-surface-50 border border-surface-300/50 text-sm focus:outline-none focus:border-brand-500/50"
          />
        </div>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-2">
        <CategoryChip
          label="All"
          color="bg-navy/10 text-navy/70"
          active={activeCat === "all"}
          onClick={() => setActiveCat("all")}
        />
        {CATEGORY_ORDER.map((c) => (
          <CategoryChip
            key={c}
            label={CATEGORY_LABELS[c].label}
            color={CATEGORY_LABELS[c].color}
            active={activeCat === c}
            onClick={() => setActiveCat(c)}
          />
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-navy/40">
          No devices match that search.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map((d) => {
            const active = selected?.key === d.key;
            const catMeta = CATEGORY_LABELS[d.category];
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => onSelect(d)}
                className={`group relative p-4 rounded-2xl border-2 transition-all duration-300 text-left hover:shadow-lg ${
                  active
                    ? "border-brand-500 bg-brand-500/5 shadow-md"
                    : "border-surface-300/30 hover:border-brand-500/20"
                }`}
              >
                {active && (
                  <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center z-10">
                    <Check size={12} className="text-white" />
                  </div>
                )}
                <div className="aspect-square rounded-xl bg-surface-50 overflow-hidden mb-3">
                  {d.image ? (
                    <img
                      src={d.image}
                      alt={d.name}
                      className="w-full h-full object-contain p-6 group-hover:scale-105 transition-transform duration-500"
                      onError={(e) => {
                        e.target.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-navy/20">
                      <Package size={32} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-heading font-bold text-sm text-navy">
                    {d.name}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${catMeta.color}`}
                  >
                    {catMeta.label}
                  </span>
                </div>
                <p className="text-[11px] text-navy/40 leading-relaxed">{d.tagline}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DeviceThumb({ device, onEdit }) {
  const catMeta = CATEGORY_LABELS[device.category];
  return (
    <button
      type="button"
      onClick={onEdit}
      className="group flex items-center gap-4 p-3 pr-5 rounded-2xl bg-surface-50 border border-surface-300/30 cursor-pointer hover:border-brand-500/30 hover:shadow-md transition-all duration-300 w-full text-left"
    >
      <div className="w-16 h-16 rounded-xl bg-white overflow-hidden flex-shrink-0 border border-surface-300/20">
        {device.image ? (
          <img
            src={device.image}
            alt={device.name}
            className="w-full h-full object-contain p-2"
            onError={(e) => {
              e.target.style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-navy/20">
            <Package size={20} />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-heading font-bold text-sm text-navy">
            {device.name}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${catMeta.color}`}
          >
            {catMeta.label}
          </span>
        </div>
        <p className="text-xs text-navy/40 truncate">{device.fullName}</p>
      </div>
      <Pencil
        size={14}
        className="text-navy/20 group-hover:text-brand-500 transition-colors flex-shrink-0"
      />
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════
   REVIEW HELPERS
   ════════════════════════════════════════════════════════════════ */

function ReviewSection({ title, onEdit, children }) {
  return (
    <div className="p-4 md:p-5 rounded-2xl bg-surface-50/50 border border-surface-300/20">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-heading font-semibold text-sm text-navy">{title}</h3>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600 font-medium transition-colors"
          >
            <Pencil size={11} /> Edit
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function ReviewField({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  const display = Array.isArray(value) ? value.join(", ") : String(value);
  return (
    <div className="flex items-start gap-3 py-0.5">
      <span className="text-[10px] font-semibold text-navy/25 uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm text-navy/70 flex-1">{display}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MAIN EXPORT
   ════════════════════════════════════════════════════════════════ */

export function RxWizard({ prefill = {}, onSubmit, submitting = false }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(() => ({
    ...INITIAL_FORM,
    doctorName: prefill.doctorName || "",
    practiceName: prefill.practiceName || "",
    email: prefill.email || "",
    phone: prefill.phone || "",
  }));
  const [errors, setErrors] = useState([]);
  const [deviceQuery, setDeviceQuery] = useState("");
  const [deviceCat, setDeviceCat] = useState("all");
  const contentRef = useRef(null);

  /* ── Handlers ── */
  const update = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const updateShipTo = (field, value) =>
    setForm((prev) => ({
      ...prev,
      shipTo: { ...prev.shipTo, [field]: value },
    }));

  const updateDeviceOption = (key, value) =>
    setForm((prev) => ({
      ...prev,
      deviceOptions: { ...prev.deviceOptions, [key]: value },
    }));

  const addFiles = (field, fileList) => {
    const newFiles = Array.from(fileList).map((file) => ({
      id: Math.random().toString(36).slice(2, 10),
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      preview: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : null,
    }));
    setForm((prev) => ({ ...prev, [field]: [...prev[field], ...newFiles] }));
  };

  const removeFile = (field, id) => {
    setForm((prev) => {
      const f = prev[field].find((x) => x.id === id);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return { ...prev, [field]: prev[field].filter((x) => x.id !== id) };
    });
  };

  const handleDeviceSelect = (device) => {
    setForm((prev) => ({ ...prev, device, deviceOptions: {} }));
  };

  /* ── Validation ── */
  const validate = () => {
    const errs = [];
    if (step === 0) {
      if (!form.doctorName.trim()) errs.push("doctorName");
      if (!form.practiceName.trim()) errs.push("practiceName");
      if (!form.email.trim()) errs.push("email");
      if (!form.patientFirst.trim()) errs.push("patientFirst");
      if (!form.patientLast.trim()) errs.push("patientLast");
    }
    if (step === 1 && !form.device) errs.push("device");
    if (step === 2 && form.device) {
      for (const [key, field] of Object.entries(form.device.options)) {
        if (!field.required) continue;
        const v = form.deviceOptions[key];
        const empty =
          v === undefined ||
          v === null ||
          v === "" ||
          (Array.isArray(v) && v.length === 0);
        if (empty) errs.push(`opt:${key}`);
      }
    }
    if (step === 3) {
      if (!form.signature) errs.push("signature");
    }
    setErrors(errs);
    return errs.length === 0;
  };

  const next = () => {
    if (!validate()) return;
    setErrors([]);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const prev = () => {
    setErrors([]);
    setStep((s) => Math.max(s - 1, 0));
  };

  /* ── Submit ── */
  const handleSubmit = () => {
    if (!validate()) return;
    onSubmit({
      patientFirst: form.patientFirst,
      patientLast: form.patientLast,
      dob: form.dob,
      gender: form.gender,
      firstDevice: form.firstDevice,
      contactPhone: form.phone,
      dueDate: form.dueDate,
      rush: form.rush,
      rushTier: form.rushTier,
      physicalBite: form.physicalBite,
      recordsMethod: form.recordsMethod,
      generalComments: form.generalComments,
      signatureUrl: form.signature,
      deviceKey: form.device?.key,
      deviceCategory: form.device?.category,
      deviceOptions: form.deviceOptions,
      shipTo: form.shipTo,
      scanFiles: form.scanFiles,
      photos: form.photos,
      prescription: form.prescription,
      sleepStudy: form.sleepStudy,
      artboardFiles: form.artboardFiles,
    });
  };

  /* ── GSAP step transition ── */
  useEffect(() => {
    if (contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }
      );
    }
  }, [step]);

  /* ── Helpers ── */
  const errClass = (field) =>
    errors.includes(field) ? "border-red-400 ring-2 ring-red-400/10" : "";

  const allFiles = [
    ...form.scanFiles,
    ...form.photos,
    ...form.prescription,
    ...form.sleepStudy,
    ...form.artboardFiles,
  ];

  const physicalBiteLabel =
    PHYSICAL_BITE.find((p) => p.value === form.physicalBite)?.label || "";

  const rushTierLabel =
    form.rushTier && RUSH_TIERS[form.rushTier]
      ? RUSH_TIERS[form.rushTier].label
      : "";

  const recordsMethodLabel =
    RECORDS_METHODS.find((m) => m.value === form.recordsMethod)?.label || "";

  const shipToFormatted =
    form.shipTo.street
      ? [
          form.shipTo.office,
          form.shipTo.street,
          [form.shipTo.city, form.shipTo.state, form.shipTo.zip]
            .filter(Boolean)
            .join(", "),
          form.shipTo.country !== "US" ? form.shipTo.country : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */
  return (
    <div className="bg-white rounded-[2rem] border border-surface-300/50 shadow-xl shadow-navy/5 overflow-hidden">
      <StepHeader current={step} total={STEPS.length} labels={STEPS} />

      <div ref={contentRef}>

        {/* ─── STEP 0: PRACTICE & PATIENT ─── */}
        {step === 0 && (
          <div className="space-y-8 p-6 md:p-8">

            {/* Practice */}
            <div>
              <h3 className="font-heading font-semibold text-base text-navy mb-4">
                Practice Information
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Doctor Name" required>
                  <div className="relative">
                    <input
                      className={`${INPUT} bg-surface-100/80 opacity-70 ${errClass("doctorName")}`}
                      value={form.doctorName}
                      disabled
                      placeholder="Dr. Jane Smith"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-mono text-navy/25 uppercase tracking-wider pointer-events-none">
                      pre-filled
                    </span>
                  </div>
                </Field>
                <Field label="Practice Name" required>
                  <input
                    className={`${INPUT} ${errClass("practiceName")}`}
                    value={form.practiceName}
                    onChange={(e) => update("practiceName", e.target.value)}
                    placeholder="Smile Dental Group"
                  />
                </Field>
                <Field label="Email (confirmation sent here)" required>
                  <div className="relative">
                    <input
                      type="email"
                      className={`${INPUT} bg-surface-100/80 opacity-70 ${errClass("email")}`}
                      value={form.email}
                      disabled
                      placeholder="doctor@practice.com"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-mono text-navy/25 uppercase tracking-wider pointer-events-none">
                      pre-filled
                    </span>
                  </div>
                </Field>
                <Field label="Phone">
                  <div className="relative">
                    <input
                      type="tel"
                      className={`${INPUT} bg-surface-100/80 opacity-70`}
                      value={form.phone}
                      disabled
                      placeholder="(555) 123-4567"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-mono text-navy/25 uppercase tracking-wider pointer-events-none">
                      pre-filled
                    </span>
                  </div>
                </Field>
                <Field label="NPI Number">
                  <input
                    className={INPUT}
                    value={form.npi}
                    onChange={(e) => update("npi", e.target.value)}
                    placeholder="1234567890"
                  />
                </Field>
              </div>
            </div>

            {/* Patient */}
            <div className="pt-6 border-t border-surface-300/30">
              <h3 className="font-heading font-semibold text-base text-navy mb-4">
                Patient Information
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="First Name" required>
                  <input
                    className={`${INPUT} ${errClass("patientFirst")}`}
                    value={form.patientFirst}
                    onChange={(e) => update("patientFirst", e.target.value)}
                    placeholder="John"
                  />
                </Field>
                <Field label="Last Name" required>
                  <input
                    className={`${INPUT} ${errClass("patientLast")}`}
                    value={form.patientLast}
                    onChange={(e) => update("patientLast", e.target.value)}
                    placeholder="Doe"
                  />
                </Field>
                <Field label="Date of Birth">
                  <input
                    type="date"
                    className={INPUT}
                    value={form.dob}
                    onChange={(e) => update("dob", e.target.value)}
                  />
                </Field>
                <Field label="Gender">
                  <select
                    className={INPUT}
                    value={form.gender}
                    onChange={(e) => update("gender", e.target.value)}
                  >
                    <option value="">Select...</option>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </Field>
                <Field label="First device for this patient?">
                  <select
                    className={INPUT}
                    value={form.firstDevice}
                    onChange={(e) => update("firstDevice", e.target.value)}
                  >
                    <option value="">Select...</option>
                    {FIRST_DEVICE.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="mt-4">
                <PhysicalBitePicker
                  value={form.physicalBite}
                  onChange={(v) => update("physicalBite", v)}
                />
              </div>
            </div>

            {/* Timing */}
            <div className="pt-6 border-t border-surface-300/30">
              <h3 className="font-heading font-semibold text-base text-navy mb-4">
                Timing
              </h3>
              <DueDatePicker
                value={form.dueDate}
                onChange={(v) => update("dueDate", v)}
                rush={form.rush}
                onRushChange={(v) => {
                  update("rush", v);
                  if (!v) update("rushTier", "");
                }}
              />
              {form.rush && (
                <div className="mt-3 space-y-2">
                  <label className="block text-xs font-semibold text-navy/40 uppercase tracking-wider">
                    Rush Tier
                  </label>
                  {Object.entries(RUSH_TIERS).map(([key, tier]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => update("rushTier", key)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                        form.rushTier === key
                          ? "border-accent-500 bg-accent-500/5"
                          : "border-surface-300/50 hover:border-accent-500/30"
                      }`}
                    >
                      <span className="text-sm text-navy/70">{tier.label}</span>
                      <span className="text-sm font-bold text-accent-500">
                        +${tier.price}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Ship To */}
            <div className="pt-6 border-t border-surface-300/30">
              <h3 className="font-heading font-semibold text-base text-navy mb-1">
                Ship To
              </h3>
              <p className="text-xs text-navy/35 mb-4">
                Optional — leave blank to ship to your practice on file.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Field label="Office / Attention">
                    <input
                      className={INPUT}
                      value={form.shipTo.office}
                      onChange={(e) => updateShipTo("office", e.target.value)}
                      placeholder="Suite 200 / Attn: Dr. Smith"
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Street Address">
                    <input
                      className={INPUT}
                      value={form.shipTo.street}
                      onChange={(e) => updateShipTo("street", e.target.value)}
                      placeholder="123 Main St"
                    />
                  </Field>
                </div>
                <Field label="City">
                  <input
                    className={INPUT}
                    value={form.shipTo.city}
                    onChange={(e) => updateShipTo("city", e.target.value)}
                    placeholder="Phoenix"
                  />
                </Field>
                <Field label="State">
                  <input
                    className={INPUT}
                    value={form.shipTo.state}
                    onChange={(e) => updateShipTo("state", e.target.value)}
                    placeholder="AZ"
                    maxLength={2}
                  />
                </Field>
                <Field label="ZIP / Postal Code">
                  <input
                    className={INPUT}
                    value={form.shipTo.zip}
                    onChange={(e) => updateShipTo("zip", e.target.value)}
                    placeholder="85001"
                  />
                </Field>
                <Field label="Country">
                  <input
                    className={INPUT}
                    value={form.shipTo.country}
                    onChange={(e) => updateShipTo("country", e.target.value)}
                    placeholder="US"
                  />
                </Field>
              </div>
            </div>
          </div>
        )}

        {/* ─── STEP 1: DEVICE SELECTION ─── */}
        {step === 1 && (
          <div className="p-6 md:p-8">
            {form.device && (
              <div className="mb-6">
                <p className="text-xs font-mono text-navy/40 uppercase tracking-wider mb-2">
                  Currently selected
                </p>
                <DeviceThumb
                  device={form.device}
                  onEdit={() => update("device", null)}
                />
              </div>
            )}
            {errors.includes("device") && (
              <p className="mb-4 text-xs text-red-400 font-medium">
                Please select a device to continue.
              </p>
            )}
            <DevicePicker
              selected={form.device}
              onSelect={handleDeviceSelect}
              query={deviceQuery}
              setQuery={setDeviceQuery}
              activeCat={deviceCat}
              setActiveCat={setDeviceCat}
            />
          </div>
        )}

        {/* ─── STEP 2: DEVICE OPTIONS ─── */}
        {step === 2 && (
          <div className="p-6 md:p-8">
            {form.device ? (
              <>
                <div className="mb-6">
                  <DeviceThumb
                    device={form.device}
                    onEdit={() => setStep(1)}
                  />
                </div>
                <DeviceOptionsPanel
                  schema={form.device.options}
                  values={form.deviceOptions}
                  onChange={updateDeviceOption}
                  errors={errors}
                />
              </>
            ) : (
              <div className="text-center py-12 text-sm text-navy/40">
                Go back and select a device first.
              </div>
            )}
          </div>
        )}

        {/* ─── STEP 3: FILES & SIGNATURE ─── */}
        {step === 3 && (
          <div className="space-y-6 p-6 md:p-8">
            <RecordsMethodPicker
              value={form.recordsMethod}
              onChange={(v) => update("recordsMethod", v)}
            />

            <FileUploadZone
              label="Digital Scans"
              hint=".stl, .ply, .obj — upper, lower, bite"
              accept=".stl,.ply,.obj"
              files={form.scanFiles}
              onAdd={(f) => addFiles("scanFiles", f)}
              onRemove={(id) => removeFile("scanFiles", id)}
            />
            <FileUploadZone
              label="Intraoral Photos"
              hint=".jpg, .png — occlusal, lateral, frontal views"
              accept="image/*"
              files={form.photos}
              onAdd={(f) => addFiles("photos", f)}
              onRemove={(id) => removeFile("photos", id)}
            />
            <FileUploadZone
              label="Prescription / Rx"
              hint=".pdf — signed Rx document"
              accept=".pdf"
              files={form.prescription}
              onAdd={(f) => addFiles("prescription", f)}
              onRemove={(id) => removeFile("prescription", id)}
            />
            {form.device?.category === "sleep" && (
              <FileUploadZone
                label="Sleep Study Report"
                hint=".pdf — required for sleep appliance cases"
                accept=".pdf"
                files={form.sleepStudy}
                onAdd={(f) => addFiles("sleepStudy", f)}
                onRemove={(id) => removeFile("sleepStudy", id)}
              />
            )}
            {form.device?.category === "ortho" && (
              <FileUploadZone
                label="Artboard / Design Files"
                hint=".pdf, .png, .jpg — occlusal design drawings"
                accept=".pdf,image/*"
                files={form.artboardFiles}
                onAdd={(f) => addFiles("artboardFiles", f)}
                onRemove={(id) => removeFile("artboardFiles", id)}
              />
            )}

            <Field label="General case notes (optional)">
              <textarea
                className={`${INPUT} resize-none`}
                rows={3}
                value={form.generalComments}
                onChange={(e) => update("generalComments", e.target.value)}
                placeholder="Anything we should know that isn't covered by the device-specific comments..."
              />
            </Field>

            <div
              className={
                errors.includes("signature")
                  ? "rounded-2xl ring-2 ring-red-400/20 p-0.5"
                  : ""
              }
            >
              <Signature
                value={form.signature}
                onChange={(v) => update("signature", v)}
                required
              />
            </div>
          </div>
        )}

        {/* ─── STEP 4: REVIEW ─── */}
        {step === 4 && (
          <div className="space-y-4 p-6 md:p-8">
            <ReviewSection
              title="Practice & Patient"
              onEdit={() => setStep(0)}
            >
              <div className="space-y-0.5">
                <ReviewField label="Doctor" value={form.doctorName} />
                <ReviewField label="Practice" value={form.practiceName} />
                <ReviewField label="Email" value={form.email} />
                <ReviewField label="Phone" value={form.phone} />
                <ReviewField label="NPI" value={form.npi} />
                <ReviewField
                  label="Patient"
                  value={`${form.patientFirst} ${form.patientLast}`.trim()}
                />
                <ReviewField label="DOB" value={form.dob} />
                <ReviewField label="Gender" value={form.gender} />
                <ReviewField label="First device" value={form.firstDevice} />
                <ReviewField label="Physical bite" value={physicalBiteLabel} />
                <ReviewField label="Records" value={recordsMethodLabel} />
                <ReviewField label="Due date" value={form.dueDate} />
                {form.rush && (
                  <ReviewField
                    label="Rush"
                    value={rushTierLabel ? `Yes — ${rushTierLabel} (+$${RUSH_TIERS[form.rushTier]?.price})` : "Yes"}
                  />
                )}
                {shipToFormatted && (
                  <ReviewField label="Ship to" value={shipToFormatted} />
                )}
              </div>
            </ReviewSection>

            <ReviewSection title="Device" onEdit={() => setStep(1)}>
              {form.device ? (
                <DeviceThumb device={form.device} onEdit={() => setStep(1)} />
              ) : (
                <span className="text-xs text-navy/25 italic">
                  No device selected
                </span>
              )}
            </ReviewSection>

            <ReviewSection title="Device Options" onEdit={() => setStep(2)}>
              {form.device && Object.keys(form.deviceOptions).length > 0 ? (
                <div className="space-y-0.5">
                  {Object.entries(form.deviceOptions).map(([key, value]) => {
                    const field = form.device.options[key];
                    if (!field) return null;
                    return (
                      <ReviewField
                        key={key}
                        label={field.label.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 28)}
                        value={
                          typeof value === "object" && !Array.isArray(value)
                            ? Object.entries(value)
                                .filter(([, v]) => v)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(" · ")
                            : value
                        }
                      />
                    );
                  })}
                </div>
              ) : (
                <span className="text-xs text-navy/25 italic">
                  No options set
                </span>
              )}
            </ReviewSection>

            <ReviewSection title="Files" onEdit={() => setStep(3)}>
              {allFiles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {allFiles.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-surface-300/30 text-xs"
                    >
                      {f.preview ? (
                        <img
                          src={f.preview}
                          alt=""
                          className="w-5 h-5 rounded object-cover"
                        />
                      ) : (
                        <FileText size={12} className="text-navy/30" />
                      )}
                      <span className="text-navy/60 truncate max-w-[100px]">
                        {f.name}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-navy/25 italic">
                  No files uploaded
                </span>
              )}
              {form.generalComments && (
                <div className="mt-3 pt-3 border-t border-surface-300/20">
                  <ReviewField label="Notes" value={form.generalComments} />
                </div>
              )}
            </ReviewSection>

            <ReviewSection title="Signature" onEdit={() => setStep(3)}>
              {form.signature ? (
                <img
                  src={form.signature}
                  alt="Doctor signature"
                  className="h-20 bg-white rounded-lg border border-surface-300/30 p-2"
                />
              ) : (
                <span className="text-xs text-red-400 italic">
                  Signature required before submission.
                </span>
              )}
            </ReviewSection>
          </div>
        )}
      </div>

      {/* ─── Navigation Footer ─── */}
      <div className="px-6 md:px-8 py-5 border-t border-surface-300/30 flex items-center justify-between">
        {step > 0 ? (
          <button
            type="button"
            onClick={prev}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-medium text-navy/50 hover:text-navy hover:bg-surface-100 transition-all"
          >
            <ChevronLeft size={16} /> Back
          </button>
        ) : (
          <div />
        )}

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={next}
            className="btn-magnetic flex items-center gap-1.5 px-6 py-2.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors"
          >
            <span className="relative z-10 flex items-center gap-1.5">
              Continue <ChevronRight size={16} />
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!form.signature || submitting}
            className="btn-magnetic flex items-center gap-1.5 px-6 py-2.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="relative z-10 flex items-center gap-1.5">
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  Submit Case <Send size={16} />
                </>
              )}
            </span>
          </button>
        )}
      </div>

      {/* ─── Inline error message ─── */}
      {errors.length > 0 && (
        <div className="px-6 md:px-8 pb-4 -mt-2">
          <p className="text-xs text-red-400 font-medium">
            Please fill in the required fields highlighted above.
          </p>
        </div>
      )}
    </div>
  );
}
