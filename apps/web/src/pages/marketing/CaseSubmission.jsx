import { Link } from "react-router-dom";
import { Send } from "lucide-react";
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

const PHONE = (
  <a href="tel:+16197246400" className="font-mono font-semibold text-brand-700 hover:underline">
    619.724.6400
  </a>
);
const EMAIL = (
  <a href="mailto:info@diamondorthotic.com" className="font-semibold text-brand-700 hover:underline">
    info@diamondorthotic.com
  </a>
);

const primaryBtn =
  "btn-magnetic inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors";

export function CaseSubmissionPage() {
  const isApprovedDoctor = useAuthStore((s) => s.isApprovedDoctor());

  return (
    <div>
      <PageHero
        title="Submit a new case"
        intro="Approved doctors send cases through the Rx form in the account portal. Everyone else can call the lab at 619.724.6400."
      />

      <section className="section-pad py-16 md:py-20">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl">
            {isApprovedDoctor ? (
              <>
                <h2 className="font-heading font-bold text-2xl md:text-3xl tracking-tight text-navy">
                  Send a case from your portal
                </h2>
                <p className="mt-3 text-navy/70 leading-relaxed">
                  Submitting a case from the public website isn&apos;t available. Your account portal has the Rx form
                  for every Diamond device. Questions about a case? Call {PHONE} or email {EMAIL}.
                </p>
                <div className="mt-8">
                  <Link to={ROUTES.RX_CHOOSER} className={primaryBtn}>
                    <span className="relative z-10 flex items-center gap-2">
                      <Send size={15} /> Open the portal Rx form
                    </span>
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-heading font-bold text-2xl md:text-3xl tracking-tight text-navy">
                  Approved doctors only
                </h2>
                <p className="mt-3 text-navy/70 leading-relaxed">
                  Submitting a case from the public website isn&apos;t available. Approved Diamond partner doctors
                  send cases through the Rx form in their account portal. Everyone else can call {PHONE} or email{" "}
                  {EMAIL} and we&apos;ll take it from there.
                </p>
                <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4">
                  <Link to={ROUTES.LOGIN} state={{ from: { pathname: ROUTES.RX_CHOOSER } }} className={primaryBtn}>
                    <span className="relative z-10 flex items-center gap-2">
                      <Send size={15} /> Sign in to submit a case
                    </span>
                  </Link>
                  <Link
                    to={ROUTES.REGISTER_DOCTOR}
                    className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full text-sm font-medium border border-navy/20 text-navy/70 hover:text-navy hover:border-navy/40 transition-colors"
                  >
                    Apply for a doctor account
                  </Link>
                </div>
                <p className="mt-6 text-sm text-navy/70 leading-relaxed">
                  Already an approved doctor? Sign in above and the link takes you straight to the Rx form.
                </p>
              </>
            )}

            <p className="mt-10 pt-6 border-t border-navy/15 text-sm text-navy/70">
              Turnaround under 2 weeks. Ships nationwide. HIPAA compliant.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
