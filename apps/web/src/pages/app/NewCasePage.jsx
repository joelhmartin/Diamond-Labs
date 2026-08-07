import { Link } from "react-router-dom";
import { ArrowLeft, Clock, Phone, Mail, FileText, ArrowRight } from "lucide-react";
import { useAuthStore } from "../../stores/auth.store.js";
import { ROUTES } from "../../config/routes.js";

/* ────────────────────────────────────────────────
   Coming-soon placeholder.

   The click-through case wizard that used to live at this route (RxWizard +
   DeviceOptionsPanel) has been retired by product decision — the doctor
   portal's Rx form at /app/rx replaces it, reachable from the sidebar only.
   This component keeps its name and this route stays registered so the
   marketing site's "Submit a Case" button and any existing bookmarks still
   resolve to a page instead of a 404. Do not wire this back up to a
   submission flow without a new product decision to do so.
   ──────────────────────────────────────────────── */
export function NewCasePage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      {/* Simple top bar */}
      <div className="border-b border-surface-300/30 bg-white px-6 py-4 flex items-center gap-3">
        <Link to={ROUTES.DOCTOR_INVOICES} className="text-muted hover:text-primary transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <span className="font-mono text-xs text-muted uppercase tracking-widest">
          Diamond Labs · Digital Rx
        </span>
        <span className="font-mono text-xs text-icon">/ New Case</span>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full bg-white rounded-[2rem] border border-surface-300/50 shadow-xl shadow-navy/5 p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center mx-auto mb-6">
            <Clock size={28} className="text-brand-500" />
          </div>

          <h1 className="font-heading font-bold text-2xl text-primary tracking-tight">
            Online Submission — Coming Soon
          </h1>
          <p className="mt-4 text-sm text-secondary max-w-sm mx-auto leading-relaxed">
            Submitting a new case from the website isn&apos;t available right
            now while we rebuild this page.
          </p>
          <p className="mt-3 text-sm text-secondary max-w-sm mx-auto leading-relaxed">
            We&apos;re still accepting prescriptions — call the lab or send us
            an email and we&apos;ll get your case started.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="tel:+16197246400"
              className="btn-magnetic inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            >
              <Phone size={14} /> 619.724.6400
            </a>
            <a
              href="mailto:info@diamondorthotic.com"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-medium border border-surface-300/50 text-secondary hover:text-primary hover:border-brand-500/30 transition-all"
            >
              <Mail size={14} /> info@diamondorthotic.com
            </a>
          </div>

          {isAuthenticated && (
            <div className="mt-8 pt-6 border-t border-surface-300/30">
              <p className="text-xs text-muted mb-3">
                Signed in? The Rx form in your portal is up and working.
              </p>
              <Link
                to={ROUTES.RX_CHOOSER}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-500 hover:gap-2.5 transition-all"
              >
                <FileText size={15} /> Open the Rx form <ArrowRight size={15} />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
