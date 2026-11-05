import { Link } from "react-router-dom";
import { FileCheck2, Mail, Phone, Send, ShieldCheck, Timer, Truck, UserPlus, LogIn } from "lucide-react";
import { useAuthStore } from "../../stores/auth.store.js";
import { ROUTES } from "../../config/routes.js";
import { PageHero } from "../../components/marketing/PageHero";
import { HeroStage } from "../../components/marketing/HeroStage";
import { Reveal } from "../../components/marketing/Reveal";

/* ════════════════════════════════════════════════════════════════
   MARKETING TEASER PAGE
   Online case submission from the website is temporarily unavailable
   (the click-through wizard has been retired). This page now points
   doctors to phone/email, and signed-in doctors to the portal's Rx
   form, rather than promising a working wizard.
   ════════════════════════════════════════════════════════════════ */

const PHONE = (
  <a href="tel:+16197246400" className="font-mono font-semibold text-brand-300 hover:underline">
    619.724.6400
  </a>
);
const EMAIL = (
  <a href="mailto:info@diamondorthotic.com" className="font-semibold text-brand-300 hover:underline">
    info@diamondorthotic.com
  </a>
);

const primaryBtn =
  "btn-magnetic inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors";

const FACTS = [
  { Icon: Timer, label: "Turnaround under 2 weeks" },
  { Icon: Truck, label: "Ships nationwide" },
  { Icon: ShieldCheck, label: "HIPAA compliant" },
];

function RouteCard({ Icon, title, body, children }) {
  return (
    <li className="flex flex-col rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-7 hover:shadow-xl hover:shadow-navy/10 hover:-translate-y-1 transition-all duration-300">
      <span className="grid place-items-center w-12 h-12 rounded-2xl bg-brand-100 text-brand-700">
        <Icon size={22} aria-hidden="true" />
      </span>
      <h3 className="mt-5 font-heading font-bold text-xl tracking-tight text-navy">{title}</h3>
      <p className="mt-2 text-navy/70 leading-relaxed">{body}</p>
      <div className="mt-auto pt-5">{children}</div>
    </li>
  );
}

const linkCls = "inline-flex items-center gap-2 font-semibold text-brand-700 hover:underline";

function ActionPanel({ isApprovedDoctor }) {
  return (
    <div className="relative overflow-hidden rounded-[2.5rem] md:rounded-[3rem] bg-navy shadow-xl shadow-navy/20">
      <HeroStage />
      <div className="relative z-10 grid lg:grid-cols-[1.2fr_1fr] gap-8 items-center p-8 md:p-14">
        {isApprovedDoctor ? (
          <div>
            <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-on-dark">
              Send a case from your portal
            </h2>
            <p className="mt-5 text-on-dark/75 text-lg leading-relaxed">
              Submitting a case from the public website isn&apos;t available. Your account portal has the Rx form.
              Questions about a case? Call {PHONE} or email {EMAIL}.
            </p>
            <div className="mt-8">
              <Link to={ROUTES.RX_CHOOSER} className={primaryBtn}>
                <span className="relative z-10 flex items-center gap-2">
                  <Send size={15} /> Open the portal Rx form
                </span>
              </Link>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-on-dark">
              Approved doctors only
            </h2>
            <p className="mt-5 text-on-dark/75 text-lg leading-relaxed">
              Submitting a case from the public website isn&apos;t available. Approved Diamond partner doctors send
              cases through the Rx form in their account portal. Everyone else can call {PHONE} or email {EMAIL} and
              we&apos;ll take it from there.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4">
              <Link to={ROUTES.LOGIN} state={{ from: { pathname: ROUTES.RX_CHOOSER } }} className={primaryBtn}>
                <span className="relative z-10 flex items-center gap-2">
                  <Send size={15} /> Sign in to submit a case
                </span>
              </Link>
              <Link
                to={ROUTES.REGISTER_DOCTOR}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-sm font-medium bg-white/5 border border-white/20 text-white/85 hover:bg-white/10 transition-colors"
              >
                Apply for a doctor account
              </Link>
            </div>
            <p className="mt-6 text-sm text-on-dark/70 leading-relaxed">
              Already an approved doctor? Sign in above and the link takes you straight to the Rx form.
            </p>
          </div>
        )}
        <img
          src="/images/ond-trutaine.webp"
          alt="An Olmos Neuromuscular Device appliance"
          className="w-[70%] max-w-[360px] mx-auto h-auto object-contain drop-shadow-[0_30px_50px_rgba(0,20,60,0.45)]"
        />
      </div>
    </div>
  );
}

function Routes({ isApprovedDoctor }) {
  return (
    <ul className={`mt-8 grid md:grid-cols-2 gap-5 ${isApprovedDoctor ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
      {isApprovedDoctor ? (
        <RouteCard Icon={FileCheck2} title="Portal Rx form" body="Send the case straight from your account portal.">
          <Link to={ROUTES.RX_CHOOSER} className={linkCls}>
            Open the portal Rx form
          </Link>
        </RouteCard>
      ) : (
        <>
          <RouteCard Icon={LogIn} title="Sign in" body="Approved doctors sign in and go straight to the Rx form.">
            <Link to={ROUTES.LOGIN} state={{ from: { pathname: ROUTES.RX_CHOOSER } }} className={linkCls}>
              Sign in to submit a case
            </Link>
          </RouteCard>
          <RouteCard Icon={UserPlus} title="Apply" body="Not an approved partner yet? Apply for a doctor account.">
            <Link to={ROUTES.REGISTER_DOCTOR} className={linkCls}>
              Apply for a doctor account
            </Link>
          </RouteCard>
        </>
      )}
      <RouteCard Icon={Phone} title="Call the lab" body="Talk to us about a case.">
        <a href="tel:+16197246400" className={`${linkCls} font-mono`}>
          619.724.6400
        </a>
      </RouteCard>
      <RouteCard Icon={Mail} title="Email" body="Write to the lab.">
        <a href="mailto:info@diamondorthotic.com" className={linkCls}>
          info@diamondorthotic.com
        </a>
      </RouteCard>
    </ul>
  );
}

export function CaseSubmissionPage() {
  const isApprovedDoctor = useAuthStore((s) => s.isApprovedDoctor());

  return (
    <div>
      <PageHero
        title="Submit a new case"
        titleAccent="through the portal."
        intro="Approved doctors send cases through the Rx form in the account portal. Everyone else can call the lab at 619.724.6400."
        product="/images/ddso-ant-overview.webp"
        productAlt="A DDSO sleep appliance"
      />

      <Reveal className="section-pad py-16 md:py-24">
        <div className="max-w-6xl mx-auto">
          <ActionPanel isApprovedDoctor={isApprovedDoctor} />
          <Routes isApprovedDoctor={isApprovedDoctor} />
          <ul className="mt-10 flex flex-wrap gap-3">
            {FACTS.map(({ Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-2 rounded-full bg-brand-100 text-brand-700 px-4 py-2 text-sm font-semibold"
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </div>
  );
}
