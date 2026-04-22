import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
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
  CheckCircle,
  Send,
  Clock,
  Package,
  Image as ImageIcon,
  Search,
} from "lucide-react";
import { RX_DEVICES, CATEGORY_LABELS, CATEGORY_ORDER } from "../../data/rx-devices";
import { DeviceOptionsPanel } from "../../components/rx/DeviceOptionsPanel";
import { Signature } from "../../components/rx/Signature";
import { DueDatePicker } from "../../components/rx/DueDatePicker";

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
  // Practice
  doctorName: "",
  practiceName: "",
  email: "",
  phone: "",
  npi: "",
  // Patient
  patientFirst: "",
  patientLast: "",
  dob: "",
  gender: "",
  firstDevice: "",   // Yes / No — drives remake flow
  // Case-level
  dueDate: "",
  rush: false,
  physicalBite: "",  // Yes / No
  // Device
  device: null,
  deviceOptions: {},
  // Files
  scanFiles: [],
  photos: [],
  prescription: [],
  sleepStudy: [],
  // Signature + misc
  signature: "",
  generalComments: "",
};

const INPUT =
  "w-full px-4 py-3 rounded-xl bg-surface-50 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

/* ════════════════════════════════════════════════════════════════
   SHARED COMPONENTS
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

/* ════════════════════════════════════════════════════════════════
   DEVICE PICKER (category chips + grid)
   ════════════════════════════════════════════════════════════════ */

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
      {/* Search + category chips */}
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
                <p className="text-[11px] text-navy/40 leading-relaxed">
                  {d.tagline}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CategoryChip({ label, color, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 ${
        active
          ? "bg-navy text-white"
          : `${color} hover:bg-navy/15`
      }`}
    >
      {label}
    </button>
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
   HERO
   ════════════════════════════════════════════════════════════════ */

function CaseHero() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-ch]", {
        y: 30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.08,
        ease: "power3.out",
        delay: 0.2,
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative bg-gradient-to-b from-navy via-brand-900 to-surface-100 pt-32 pb-24"
    >
      <div className="section-pad text-center max-w-2xl mx-auto">
        <span
          data-ch
          className="font-mono text-xs text-white/40 uppercase tracking-widest"
        >
          Digital Rx
        </span>
        <h1
          data-ch
          className="mt-4 font-heading font-bold text-3xl md:text-5xl text-white tracking-tight"
        >
          Submit a New Case
        </h1>
        <p
          data-ch
          className="mt-3 text-white/50 text-sm md:text-base max-w-lg mx-auto"
        >
          HIPAA-compliant digital submission for every Diamond-fabricated
          device. Pick the device, configure it, upload your scans and
          records, sign — we begin fabrication within one business day.
        </p>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════════════════════════════════ */

export function CaseSubmissionPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState([]);
  const [deviceQuery, setDeviceQuery] = useState("");
  const [deviceCat, setDeviceCat] = useState("all");
  const contentRef = useRef(null);

  const update = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

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
      // Enforce required device-option fields
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

  const handleSubmit = () => {
    if (!validate()) return;
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setSubmitted(true);
    }, 1500);
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }
      );
    }
  }, [step]);

  const errClass = (field) =>
    errors.includes(field) ? "border-red-400 ring-2 ring-red-400/10" : "";

  const allFiles = [
    ...form.scanFiles,
    ...form.photos,
    ...form.prescription,
    ...form.sleepStudy,
  ];

  /* ── SUCCESS ── */
  if (submitted) {
    return (
      <div>
        <CaseHero />
        <section className="relative z-10 section-pad -mt-8 pb-20">
          <div className="max-w-xl mx-auto text-center">
            <div className="bg-white card-radius p-10 md:p-14 border border-surface-300/50 shadow-xl shadow-navy/5">
              <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-6">
                <CheckCircle size={32} className="text-white" />
              </div>
              <h2 className="font-heading font-bold text-2xl text-navy">
                Case Submitted!
              </h2>
              <p className="mt-1 font-mono text-xs text-navy/30">
                DOL-2026-{String(Math.floor(Math.random() * 9000) + 1000)}
              </p>
              <p className="mt-4 text-sm text-navy/50 max-w-sm mx-auto leading-relaxed">
                Your case has been received and queued for fabrication.
                We&apos;ll notify you at each milestone via email.
              </p>

              {form.device && (
                <div className="mt-6 inline-flex items-center gap-3 px-4 py-2 rounded-xl bg-surface-50 border border-surface-300/30">
                  {form.device.image && (
                    <img
                      src={form.device.image}
                      alt=""
                      className="w-10 h-10 rounded-lg object-contain bg-white p-1 border border-surface-300/20"
                      onError={(e) => {
                        e.target.style.display = "none";
                      }}
                    />
                  )}
                  <div className="text-left">
                    <span className="text-xs font-semibold text-navy">
                      {form.device.name}
                    </span>
                    <span className="block text-[10px] text-navy/30">
                      {form.patientFirst} {form.patientLast}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-8 flex items-center justify-center gap-3">
                <button
                  onClick={() => {
                    setSubmitted(false);
                    setStep(0);
                    setForm(INITIAL_FORM);
                  }}
                  className="px-6 py-3 rounded-full text-sm font-semibold border border-surface-300/50 text-navy/60 hover:text-navy hover:border-brand-500/30 transition-all"
                >
                  Submit Another
                </button>
                <Link
                  to="/"
                  className="px-6 py-3 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
                >
                  Back to Home
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  /* ── FORM ── */
  return (
    <div>
      <CaseHero />

      <section className="relative z-10 section-pad -mt-8 pb-20">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white rounded-[2rem] border border-surface-300/50 shadow-xl shadow-navy/5 overflow-hidden">
            <StepHeader current={step} total={STEPS.length} labels={STEPS} />

            <div ref={contentRef}>
              {/* ─── STEP 0: PRACTICE & PATIENT ─── */}
              {step === 0 && (
                <div className="space-y-8 p-6 md:p-8">
                  <div>
                    <h3 className="font-heading font-semibold text-base text-navy mb-4">
                      Practice Information
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Doctor Name" required>
                        <input
                          className={`${INPUT} ${errClass("doctorName")}`}
                          value={form.doctorName}
                          onChange={(e) => update("doctorName", e.target.value)}
                          placeholder="Dr. Jane Smith"
                        />
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
                        <input
                          type="email"
                          className={`${INPUT} ${errClass("email")}`}
                          value={form.email}
                          onChange={(e) => update("email", e.target.value)}
                          placeholder="doctor@practice.com"
                        />
                      </Field>
                      <Field label="Phone">
                        <input
                          type="tel"
                          className={INPUT}
                          value={form.phone}
                          onChange={(e) => update("phone", e.target.value)}
                          placeholder="(555) 123-4567"
                        />
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
                          <option>Yes</option>
                          <option>No</option>
                        </select>
                      </Field>
                      <Field label="Will you send a physical bite?">
                        <select
                          className={INPUT}
                          value={form.physicalBite}
                          onChange={(e) => update("physicalBite", e.target.value)}
                        >
                          <option value="">Select...</option>
                          <option>Yes</option>
                          <option>No</option>
                        </select>
                      </Field>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-surface-300/30">
                    <h3 className="font-heading font-semibold text-base text-navy mb-4">
                      Timing
                    </h3>
                    <DueDatePicker
                      value={form.dueDate}
                      onChange={(v) => update("dueDate", v)}
                      rush={form.rush}
                      onRushChange={(v) => update("rush", v)}
                    />
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
                      />
                    </>
                  ) : (
                    <div className="text-center py-12 text-sm text-navy/40">
                      Go back and select a device first.
                    </div>
                  )}
                </div>
              )}

              {/* ─── STEP 3: FILES + SIGNATURE ─── */}
              {step === 3 && (
                <div className="space-y-6 p-6 md:p-8">
                  <FileUploadZone
                    label="Digital Scans *"
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
                      <ReviewField label="Physical bite" value={form.physicalBite} />
                      <ReviewField label="Due date" value={form.dueDate} />
                      {form.rush && (
                        <ReviewField label="Rush" value="Yes (+$75)" />
                      )}
                    </div>
                  </ReviewSection>

                  <ReviewSection title="Device" onEdit={() => setStep(1)}>
                    {form.device ? (
                      <DeviceThumb
                        device={form.device}
                        onEdit={() => setStep(1)}
                      />
                    ) : (
                      <span className="text-xs text-navy/25 italic">
                        No device selected
                      </span>
                    )}
                  </ReviewSection>

                  <ReviewSection
                    title="Device Options"
                    onEdit={() => setStep(2)}
                  >
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

            {/* Navigation */}
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
                  disabled={submitting || !form.signature}
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

            {errors.length > 0 && (
              <div className="px-6 md:px-8 pb-4 -mt-2">
                <p className="text-xs text-red-400 font-medium">
                  Please fill in the required fields highlighted above.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-center gap-6 text-navy/25">
            <div className="flex items-center gap-2">
              <Clock size={14} />
              <span className="text-xs font-mono">&lt; 2 week turnaround</span>
            </div>
            <div className="flex items-center gap-2">
              <Package size={14} />
              <span className="text-xs font-mono">Ships nationwide</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
