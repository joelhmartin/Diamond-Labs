import { Link } from "react-router-dom";
import { Lock, Clock, Package, Send } from "lucide-react";
import { useAuthStore } from "../../stores/auth.store.js";
import { ROUTES } from "../../config/routes.js";
import { PageHero } from "../../components/marketing/PageHero";

/* ════════════════════════════════════════════════════════════════
   MARKETING TEASER PAGE
   Online case submission from the website is temporarily unavailable
   (the click-through wizard has been retired). This page now points
   doctors to phone/email, and signed-in doctors to the portal's Rx
   form, rather than promising a working wizard.
   ════════════════════════════════════════════════════════════════ */

export function CaseSubmissionPage() {
  const isApprovedDoctor = useAuthStore((s) => s.isApprovedDoctor());

  return (
    <div>
      <PageHero
        title="Submit a new case"
        intro="HIPAA-compliant digital submission for every Diamond-fabricated device. Pick the device, configure it, upload your scans and records, sign. We begin fabrication within one business day."
      />

      <section className="section-pad py-16 md:py-20">
        <div className="max-w-2xl mx-auto">

          {/* CTA card */}
          <div className="bg-white rounded-[2rem] border border-surface-300/50 shadow-xl shadow-navy/5 overflow-hidden">
            <div className="p-8 md:p-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center mx-auto mb-6">
                <Lock size={28} className="text-brand-700" />
              </div>

              {isApprovedDoctor ? (
                <>
                  <h2 className="font-heading font-bold text-2xl text-navy">
                    Online Submission — Coming Soon
                  </h2>
                  <p className="mt-3 text-sm text-navy/70 max-w-md mx-auto leading-relaxed">
                    Submitting a new case from the website isn&apos;t available
                    right now while we rebuild this page. We&apos;re still
                    accepting prescriptions — call 619.724.6400 or email
                    info@diamondorthotic.com and we&apos;ll get your case
                    started. Signed in on the portal? The Rx form there is up
                    and working.
                  </p>
                  <div className="mt-8 flex items-center justify-center">
                    <Link
                      to={ROUTES.RX_CHOOSER}
                      className="btn-magnetic inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors"
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <Send size={15} /> Open the Portal Rx Form
                      </span>
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="font-heading font-bold text-2xl text-navy">
                    Doctors Only
                  </h2>
                  <p className="mt-3 text-sm text-navy/70 max-w-md mx-auto leading-relaxed">
                    Online case submission from the website is temporarily
                    unavailable. Approved Diamond Labs partner doctors can
                    still submit through the Rx form in their account portal
                    — or call 619.724.6400 / email info@diamondorthotic.com
                    and we&apos;ll take it from there.
                  </p>

                  <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                    <Link
                      to={ROUTES.LOGIN}
                      state={{ from: { pathname: ROUTES.RX_CHOOSER } }}
                      className="btn-magnetic inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors"
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <Send size={15} /> Sign In to Submit a Case
                      </span>
                    </Link>
                    <Link
                      to={ROUTES.REGISTER_DOCTOR}
                      className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full text-sm font-medium border border-surface-300/50 text-navy/70 hover:text-navy hover:border-brand-500/30 transition-all"
                    >
                      Apply for a doctor account
                    </Link>
                  </div>
                </>
              )}
            </div>

            {/* Feature strip */}
            <div className="border-t border-surface-300/30 px-8 py-5 bg-surface-50/50 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              {[
                { icon: Clock, label: "< 2 week turnaround" },
                { icon: Package, label: "Ships nationwide" },
                { icon: Lock, label: "HIPAA compliant" },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center justify-center gap-2 text-xs text-navy/70"
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Secondary explanation — only relevant for unauthenticated visitors */}
          {!isApprovedDoctor && (
            <p className="mt-6 text-center text-sm text-navy/70 max-w-sm mx-auto leading-relaxed">
              Already an approved doctor? Sign in above — the link will take you
              straight to the Rx form.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
