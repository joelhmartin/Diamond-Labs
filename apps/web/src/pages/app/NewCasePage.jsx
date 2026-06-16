import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle, ArrowLeft, Send } from "lucide-react";
import api from "../../config/api.js";
import { useAuthStore } from "../../stores/auth.store.js";
import { RxWizard } from "../../components/rx/RxWizard.jsx";
import { ROUTES } from "../../config/routes.js";

/* ────────────────────────────────────────────────
   Build the multipart FormData from the wizard
   payload. Field names must match the backend
   contract for POST /api/v1/rx/cases exactly.
   ──────────────────────────────────────────────── */
/** Convert a base64 PNG data URL to a Blob (synchronous, no fetch). */
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(head)?.[1] || "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function buildFormData(data) {
  const fd = new FormData();

  // Required text fields
  fd.append("patientFirst", data.patientFirst);
  fd.append("patientLast", data.patientLast);
  fd.append("deviceKey", data.deviceKey ?? "");
  fd.append("deviceCategory", data.deviceCategory ?? "");

  // Optional — sent when the doctor has filled/edited it
  if (data.practiceName) fd.append("practiceName", data.practiceName);

  // Device options. Two types of fields must be lifted out before JSON.stringify:
  //
  // 1. The ortho "artboard" field holds a PNG data URL — pull it out and send
  //    it as the `artboard` file to avoid bloating the options JSON.
  //
  // 2. fileUpload option fields (e.g. sport-guard "logoUpload") hold arrays of
  //    { id, file, name, … } objects. JSON.stringify silently drops the File
  //    bytes. Detect those arrays by checking for a `.file` (File) on the first
  //    element, collect every File, append them under the `photo` field (the
  //    backend accepts logo art as photos), and remove the key from the JSON.
  if (data.deviceOptions && Object.keys(data.deviceOptions).length > 0) {
    const { artboard, ...rest } = data.deviceOptions;
    if (typeof artboard === "string" && artboard.startsWith("data:")) {
      fd.append("artboard", dataUrlToBlob(artboard), "artboard.png");
    }

    // Strip any fileUpload arrays and collect their File objects → `photo`
    const stripped = {};
    for (const [key, val] of Object.entries(rest)) {
      if (
        Array.isArray(val) &&
        val.length > 0 &&
        val[0].file instanceof File
      ) {
        val.forEach((entry) => fd.append("photo", entry.file, entry.name));
      } else {
        stripped[key] = val;
      }
    }

    if (Object.keys(stripped).length > 0) {
      fd.append("deviceOptions", JSON.stringify(stripped));
    }
  }
  if (data.dob) fd.append("dob", data.dob);
  if (data.gender) fd.append("gender", data.gender);
  if (data.firstDevice) fd.append("firstDevice", data.firstDevice);
  if (data.contactPhone) fd.append("contactPhone", data.contactPhone);
  if (data.recordsMethod) fd.append("recordsMethod", data.recordsMethod);
  if (data.physicalBite) fd.append("physicalBite", data.physicalBite);
  if (data.dueDate) fd.append("dueDate", data.dueDate);

  // Boolean as string
  fd.append("rush", data.rush ? "true" : "false");
  if (data.rush && data.rushTier) fd.append("rushTier", data.rushTier);

  if (data.generalComments) fd.append("generalComments", data.generalComments);
  if (data.signatureUrl) fd.append("signatureUrl", data.signatureUrl);

  // Ship-to — only append if a street is provided
  if (data.shipTo?.street) {
    fd.append("shipTo", JSON.stringify(data.shipTo));
  }

  // File fields — field name determines kind; multiple appends per field allowed
  (data.scanFiles || []).forEach((f) => fd.append("scan", f.file));
  (data.photos || []).forEach((f) => fd.append("photo", f.file));
  (data.prescription || []).forEach((f) => fd.append("prescription", f.file));
  (data.sleepStudy || []).forEach((f) => fd.append("sleep_study", f.file));
  (data.artboardFiles || []).forEach((f) => fd.append("artboard", f.file));

  return fd;
}

/* ────────────────────────────────────────────────
   Success screen
   ──────────────────────────────────────────────── */
function SuccessScreen({ result, onReset }) {
  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      {/* Simple top bar */}
      <div className="border-b border-surface-300/30 bg-white px-6 py-4 flex items-center gap-3">
        <Link to={ROUTES.DOCTOR_INVOICES} className="text-navy/40 hover:text-navy transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <span className="font-mono text-xs text-navy/30 uppercase tracking-widest">
          Diamond Labs · Digital Rx
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full bg-white rounded-[2rem] border border-surface-300/50 shadow-xl shadow-navy/5 p-10 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={32} className="text-white" />
          </div>
          <h2 className="font-heading font-bold text-2xl text-navy">Case Submitted!</h2>
          {result?.caseNumber && (
            <p className="mt-1 font-mono text-xs text-navy/30">{result.caseNumber}</p>
          )}
          <p className="mt-4 text-sm text-navy/50 max-w-xs mx-auto leading-relaxed">
            Your case has been received and queued for fabrication. We&apos;ll notify
            you at each milestone via email.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onReset}
              className="px-6 py-3 rounded-full text-sm font-semibold border border-surface-300/50 text-navy/60 hover:text-navy hover:border-brand-500/30 transition-all flex items-center gap-2"
            >
              <Send size={14} /> Submit Another
            </button>
            <Link
              to={ROUTES.DOCTOR_INVOICES}
              className="px-6 py-3 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            >
              Go to Invoices
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Main page
   ──────────────────────────────────────────────── */
export function NewCasePage() {
  const user = useAuthStore((s) => s.user);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Prefill from the logged-in doctor's profile
  const prefill = {
    doctorName: user?.name || user?.doctorName || "",
    practiceName: user?.practiceName || user?.practice || "",
    email: user?.email || "",
    phone: user?.phone || user?.contactPhone || "",
  };

  const handleSubmit = async (caseData) => {
    setSubmitting(true);
    setError(null);
    try {
      const fd = buildFormData(caseData);
      // Do NOT set Content-Type manually — let the browser/axios set the
      // multipart/form-data boundary automatically when it sees FormData.
      const { data } = await api.post("/rx/cases", fd, {
        headers: { "Content-Type": undefined },
      });
      setResult(data.data); // { id, caseNumber, status }
    } catch (err) {
      // The API returns `error` as an object ({code,status,message}); extract a
      // string so we never render an object as a React child.
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
    return <SuccessScreen result={result} onReset={() => setResult(null)} />;
  }

  return (
    <div className="min-h-screen bg-surface-50">
      {/* Simple top bar */}
      <div className="border-b border-surface-300/30 bg-white px-6 py-4 flex items-center gap-3">
        <Link to={ROUTES.DOCTOR_INVOICES} className="text-navy/40 hover:text-navy transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <span className="font-mono text-xs text-navy/30 uppercase tracking-widest">
          Diamond Labs · Digital Rx
        </span>
        <span className="font-mono text-xs text-navy/20">/ New Case</span>
      </div>

      {/* Error banner */}
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

      {/* Wizard */}
      <div className="max-w-3xl mx-auto px-4 py-8 pb-20">
        <div className="mb-6">
          <h1 className="font-heading font-bold text-2xl text-navy tracking-tight">
            Submit a New Case
          </h1>
          <p className="mt-1 text-sm text-navy/40">
            HIPAA-compliant digital Rx — your information is pre-filled from your
            account.
          </p>
        </div>

        <RxWizard
          prefill={prefill}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      </div>
    </div>
  );
}
