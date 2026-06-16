import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { Lock, Clock, Package, Send } from "lucide-react";

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
    <section ref={ref} className="relative hero-gradient pt-32 pb-24">
      <div className="section-pad text-center max-w-2xl mx-auto">
        <span data-ch className="font-mono text-xs text-white/40 uppercase tracking-widest">
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
          HIPAA-compliant digital submission for every Diamond-fabricated device.
          Pick the device, configure it, upload your scans and records, sign —
          we begin fabrication within one business day.
        </p>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   MARKETING TEASER PAGE
   This page is shown to unauthenticated visitors. Approved doctors
   are directed to /app/cases/new for the live submission wizard.
   ════════════════════════════════════════════════════════════════ */

export function CaseSubmissionPage() {
  return (
    <div>
      <CaseHero />

      <section className="relative z-10 section-pad -mt-8 pb-20">
        <div className="max-w-2xl mx-auto">

          {/* CTA card */}
          <div className="bg-white rounded-[2rem] border border-surface-300/50 shadow-xl shadow-navy/5 overflow-hidden">
            <div className="p-8 md:p-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center mx-auto mb-6">
                <Lock size={28} className="text-brand-500" />
              </div>

              <h2 className="font-heading font-bold text-2xl text-navy">
                Doctors Only
              </h2>
              <p className="mt-3 text-sm text-navy/50 max-w-md mx-auto leading-relaxed">
                The Digital Rx portal is available to approved Diamond Labs
                partner doctors. Sign in with your doctor account to access the
                full case submission wizard.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  to="/auth/login"
                  className="btn-magnetic inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    <Send size={15} /> Sign In to Submit a Case
                  </span>
                </Link>
                <Link
                  to="/auth/register/doctor"
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full text-sm font-medium border border-surface-300/50 text-navy/60 hover:text-navy hover:border-brand-500/30 transition-all"
                >
                  Apply for a doctor account
                </Link>
              </div>
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
                  className="flex items-center justify-center gap-2 text-xs text-navy/40"
                >
                  <Icon size={14} />
                  <span className="font-mono">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Secondary explanation */}
          <p className="mt-6 text-center text-xs text-navy/30 max-w-sm mx-auto leading-relaxed">
            Already approved? After signing in you&apos;ll be redirected to the
            full wizard — device picker, digital scans upload, e-signature, and
            same-day queue entry.
          </p>
        </div>
      </section>
    </div>
  );
}
