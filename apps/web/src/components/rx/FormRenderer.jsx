import { useState, useEffect, useRef, useMemo } from "react";
import gsap from "gsap";
import {
  ChevronRight,
  ChevronLeft,
  Loader2,
  Send,
  AlertCircle,
} from "lucide-react";
import { FormField } from "./fields.jsx";
import {
  allFields,
  visibleFields,
  validateForm,
  shouldShow,
  buildSubmitFormData,
} from "../../data/forms/form-logic.js";

/* ════════════════════════════════════════════════════════════════
   Generic, definition-driven RX form renderer.

   Walks `form.sections`, paginating one step per section, plus a final
   Review step. Reuses the shared FormField renderer (fields.jsx) and the
   pure helpers (form-logic.js). Matches RxWizard's stepper UX + Tailwind.

   Props:
     form       — a form definition { slug, title, sections:[...] }
     prefill    — { doctorName, practiceName, email, phone }
     onSubmit   — (FormData) => Promise   (built via buildSubmitFormData)
     submitting — boolean
   ════════════════════════════════════════════════════════════════ */

/* Seed prefill values into matching identity fields by key/type. */
function seedPrefill(form, prefill = {}) {
  const answers = {};
  if (!prefill || Object.keys(prefill).length === 0) return answers;
  for (const field of allFields(form)) {
    const key = (field.key || "").toLowerCase();
    if (field.type === "fullname") {
      // Seed a doctor name field (not patient) from prefill.doctorName.
      if (prefill.doctorName && /doctor|provider|physician|dds|dentist/.test(key)) {
        const parts = String(prefill.doctorName).trim().split(/\s+/);
        const last = parts.length > 1 ? parts.pop() : "";
        answers[field.key] = { first: parts.join(" "), last };
      }
    } else if (field.type === "email" && prefill.email) {
      answers[field.key] = prefill.email;
    } else if (field.type === "phone" && prefill.phone) {
      answers[field.key] = prefill.phone;
    } else if (field.type === "text") {
      if (prefill.doctorName && /(doctor|provider|physician|dds|dentist).*name|^name$|doctorname/.test(key)) {
        answers[field.key] = prefill.doctorName;
      } else if (prefill.practiceName && /(practice|office|clinic|company)/.test(key)) {
        answers[field.key] = prefill.practiceName;
      } else if (prefill.email && /email/.test(key)) {
        answers[field.key] = prefill.email;
      } else if (prefill.phone && /phone|tel|mobile|cell/.test(key)) {
        answers[field.key] = prefill.phone;
      }
    }
  }
  return answers;
}

/* ── Step progress header (mirrors RxWizard.StepHeader) ── */
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

/* ── Review value formatting ── */
function formatReviewValue(field, value) {
  if (value == null || value === "") return null;
  switch (field.type) {
    case "fullname":
      return [value.first, value.last].filter(Boolean).join(" ") || null;
    case "address":
      return (
        [
          value.office,
          value.street,
          [value.city, value.state, value.zip].filter(Boolean).join(", "),
          value.country,
        ]
          .filter(Boolean)
          .join(" · ") || null
      );
    case "checkbox":
      return Array.isArray(value) && value.length ? value.join(", ") : null;
    case "fileUpload":
      if (!Array.isArray(value) || value.length === 0) return null;
      return value.map((f) => f.name || "file").join(", ");
    case "signature":
    case "artboard":
      return typeof value === "string" && value.startsWith("data:")
        ? "Captured"
        : null;
    case "matrix": {
      if (!value || typeof value !== "object") return null;
      const cells = Object.entries(value).filter(
        ([, v]) => v != null && v !== ""
      );
      return cells.length
        ? cells.map(([k, v]) => `${k.replace("__", ": ")} = ${v}`).join(" · ")
        : null;
    }
    default:
      return Array.isArray(value) ? value.join(", ") : String(value);
  }
}

function ReviewRow({ label, value }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <span className="text-[10px] font-semibold text-navy/25 uppercase tracking-wider w-40 flex-shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm text-navy/70 flex-1 break-words">{value}</span>
    </div>
  );
}

export function FormRenderer({ form, prefill = {}, onSubmit, submitting = false }) {
  const sections = (form && form.sections) || [];
  const totalSteps = sections.length + 1; // + Review
  const reviewStep = sections.length;

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(() => seedPrefill(form, prefill));
  // Per-step validation errors: { [field.key]: message }
  const [errors, setErrors] = useState({});
  const contentRef = useRef(null);

  const labels = useMemo(
    () => [
      ...sections.map((s, i) => s.heading || s.title || `Section ${i + 1}`),
      "Review",
    ],
    [sections]
  );

  const setAnswer = (key, value) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));

  /* Validate only the required+visible fields belonging to the current step. */
  const validateStep = (idx) => {
    const section = sections[idx];
    if (!section) return {};
    const { errors: allErrors } = validateForm(form, answers);
    const stepErrors = {};
    for (const field of section.fields || []) {
      if (allErrors[field.key]) stepErrors[field.key] = allErrors[field.key];
    }
    return stepErrors;
  };

  const next = () => {
    const stepErrors = validateStep(step);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    setStep((s) => Math.min(s + 1, totalSteps - 1));
  };

  const back = () => {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  };

  /* Determine the signature field value (first signature-type field). */
  const signatureField = useMemo(
    () => allFields(form).find((f) => f.type === "signature"),
    [form]
  );

  const handleSubmit = () => {
    // Full-form gate on final submit.
    const { ok, errors: allErrors } = validateForm(form, answers);
    if (!ok) {
      setErrors(allErrors);
      // Jump to the first section that has an error so the doctor can fix it.
      const firstBadIdx = sections.findIndex((s) =>
        (s.fields || []).some((f) => allErrors[f.key])
      );
      if (firstBadIdx >= 0) setStep(firstBadIdx);
      return;
    }
    const signature = signatureField ? answers[signatureField.key] : undefined;
    const fd = buildSubmitFormData({
      formType: form.slug,
      form,
      answers,
      signature,
    });
    onSubmit(fd);
  };

  /* GSAP step transition — matches RxWizard. */
  useEffect(() => {
    if (contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }
      );
    }
  }, [step]);

  const hasErrors = Object.keys(errors).length > 0;
  const onReview = step === reviewStep;
  const currentSection = sections[step];

  return (
    <div className="bg-white rounded-[2rem] border border-surface-300/50 shadow-xl shadow-navy/5 overflow-hidden">
      <StepHeader current={step} total={totalSteps} labels={labels} />

      <div ref={contentRef}>
        {/* ─── SECTION STEPS ─── */}
        {!onReview && currentSection && (
          <div className="p-6 md:p-8 space-y-6">
            {currentSection.note && (
              <p className="text-sm text-navy/45 leading-relaxed">
                {currentSection.note}
              </p>
            )}
            {(currentSection.fields || []).map((field) => {
              if (!shouldShow(field, answers)) return null;
              const err = errors[field.key];
              return (
                <div
                  key={field.key || field.label}
                  className={
                    err ? "rounded-2xl ring-2 ring-red-400/20 p-0.5" : ""
                  }
                >
                  <FormField
                    field={field}
                    value={answers[field.key]}
                    answers={answers}
                    onChange={(v) => setAnswer(field.key, v)}
                  />
                  {err && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-red-500 font-medium">
                      <AlertCircle size={11} /> {err}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ─── REVIEW STEP ─── */}
        {onReview && (
          <div className="p-6 md:p-8 space-y-4">
            <p className="text-sm text-navy/45">
              Review your answers below. Use Back to make changes, then submit.
            </p>
            {sections.map((section, idx) => {
              const rows = (section.fields || [])
                .filter((f) => shouldShow(f, answers))
                .map((f) => ({
                  field: f,
                  display: formatReviewValue(f, answers[f.key]),
                }))
                .filter((r) => r.display != null);
              if (rows.length === 0) return null;
              return (
                <div
                  key={section.id || idx}
                  className="p-4 md:p-5 rounded-2xl bg-surface-50/50 border border-surface-300/20"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-heading font-semibold text-sm text-navy">
                      {section.heading || labels[idx]}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setStep(idx)}
                      className="text-xs text-brand-500 hover:text-brand-600 font-medium transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {rows.map((r) => (
                      <ReviewRow
                        key={r.field.key}
                        label={(r.field.label || r.field.key || "")
                          .replace(/<[^>]+>/g, "")
                          .slice(0, 48)}
                        value={r.display}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Navigation Footer ─── */}
      <div className="px-6 md:px-8 py-5 border-t border-surface-300/30 flex items-center justify-between">
        {step > 0 ? (
          <button
            type="button"
            onClick={back}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-medium text-navy/50 hover:text-navy hover:bg-surface-100 transition-all"
          >
            <ChevronLeft size={16} /> Back
          </button>
        ) : (
          <div />
        )}

        {!onReview ? (
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
            disabled={submitting}
            className="btn-magnetic flex items-center gap-1.5 px-6 py-2.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="relative z-10 flex items-center gap-1.5">
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Submitting...
                </>
              ) : (
                <>
                  Submit <Send size={16} />
                </>
              )}
            </span>
          </button>
        )}
      </div>

      {/* ─── Inline error summary ─── */}
      {hasErrors && (
        <div className="px-6 md:px-8 pb-4 -mt-2">
          <p className="text-xs text-red-400 font-medium">
            Please fill in the required fields highlighted above.
          </p>
        </div>
      )}
    </div>
  );
}
