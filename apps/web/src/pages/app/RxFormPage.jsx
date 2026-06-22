import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle, ArrowLeft, Send } from "lucide-react";
import api from "../../config/api.js";
import { useAuthStore } from "../../stores/auth.store.js";
import { FormRenderer } from "../../components/rx/FormRenderer.jsx";
import { getForm } from "../../data/forms/index.js";
import { ROUTES } from "../../config/routes.js";

/* ────────────────────────────────────────────────
   Success screen
   ──────────────────────────────────────────────── */
function SuccessScreen({ result, formTitle, onReset }) {
  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      <div className="border-b border-surface-300/30 bg-white px-6 py-4 flex items-center gap-3">
        <Link to={ROUTES.RX_CHOOSER} className="text-navy/40 hover:text-navy transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <span className="font-mono text-xs text-navy/30 uppercase tracking-widest">
          Diamond Labs · {formTitle}
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full bg-white rounded-[2rem] border border-surface-300/50 shadow-xl shadow-navy/5 p-10 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={32} className="text-white" />
          </div>
          <h2 className="font-heading font-bold text-2xl text-navy">Form Submitted!</h2>
          {result?.caseNumber && (
            <p className="mt-1 font-mono text-xs text-navy/30">{result.caseNumber}</p>
          )}
          <p className="mt-4 text-sm text-navy/50 max-w-xs mx-auto leading-relaxed">
            Your submission has been received and queued for review. We&apos;ll be
            in touch via email.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onReset}
              className="px-6 py-3 rounded-full text-sm font-semibold border border-surface-300/50 text-navy/60 hover:text-navy hover:border-brand-500/30 transition-all flex items-center gap-2"
            >
              <Send size={14} /> Submit Another
            </button>
            <Link
              to={ROUTES.RX_CHOOSER}
              className="px-6 py-3 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            >
              Back to Forms
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Main page — resolves the form by slug (prop or :slug param),
   prefills from the auth store, and POSTs the FormData built by
   FormRenderer to the generic submission endpoint.
   ──────────────────────────────────────────────── */
export function RxFormPage({ slug: slugProp }) {
  const params = useParams();
  const slug = slugProp || params.slug;
  const form = getForm(slug);

  const user = useAuthStore((s) => s.user);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const prefill = {
    doctorName: user?.name || user?.doctorName || "",
    practiceName: user?.practiceName || user?.practice || "",
    email: user?.email || "",
    phone: user?.phone || user?.contactPhone || "",
  };

  if (!form) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-[2rem] border border-surface-300/50 shadow-xl shadow-navy/5 p-10 text-center">
          <h2 className="font-heading font-bold text-2xl text-navy">Form not found</h2>
          <p className="mt-3 text-sm text-navy/50">
            We couldn&apos;t find that Rx form.
          </p>
          <Link
            to={ROUTES.RX_CHOOSER}
            className="mt-6 inline-block px-6 py-3 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
          >
            Back to Forms
          </Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (formData) => {
    setSubmitting(true);
    setError(null);
    try {
      // FormData already carries formType, patient name, formData JSON, files,
      // and signature. Let the browser/axios set the multipart boundary.
      const { data } = await api.post("/rx/form-submissions", formData, {
        headers: { "Content-Type": undefined },
      });
      setResult(data.data); // { id, caseNumber, status }
    } catch (err) {
      const apiErr = err.response?.data?.error;
      const msg =
        (typeof apiErr === "string" ? apiErr : apiErr?.message) ||
        err.response?.data?.message ||
        "Submission failed. Please check your connection and try again.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <SuccessScreen
        result={result}
        formTitle={form.title}
        onReset={() => setResult(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-surface-50">
      <div className="border-b border-surface-300/30 bg-white px-6 py-4 flex items-center gap-3">
        <Link to={ROUTES.RX_CHOOSER} className="text-navy/40 hover:text-navy transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <span className="font-mono text-xs text-navy/30 uppercase tracking-widest">
          Diamond Labs · Rx Forms
        </span>
        <span className="font-mono text-xs text-navy/20">/ {form.title}</span>
      </div>

      {error && (
        <div className="max-w-3xl mx-auto px-4 mt-6">
          <div className="flex items-center gap-3 px-5 py-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <span className="font-semibold">Submission error:</span>
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-600 transition-colors"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-8 pb-20">
        <div className="mb-6">
          <h1 className="font-heading font-bold text-2xl text-navy tracking-tight">
            {form.title}
          </h1>
          <p className="mt-1 text-sm text-navy/40">
            HIPAA-compliant digital Rx — your information is pre-filled from your
            account.
          </p>
        </div>

        <FormRenderer
          form={form}
          prefill={prefill}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      </div>
    </div>
  );
}
