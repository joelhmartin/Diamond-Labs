import { Link } from "react-router-dom";
import { ArrowRight, Check, Crosshair, FileText, Mic2, MonitorUp, PlayCircle, ScanLine } from "lucide-react";
import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";

const PATHWAYS = [
  {
    title: "Digital Rx (fastest)",
    lead: "Approved doctors send intraoral scans and Rx details through the Rx form in the account portal.",
    bullets: [
      "STL or native scanner files accepted",
      "Automatic case-number assignment",
      "Confirmation within one business day",
    ],
    Icon: MonitorUp,
    ctaLabel: "Open the Rx form",
    ctaTo: "/submit-case",
  },
  {
    title: "Paper Rx",
    lead: "Call the lab for a paper Rx.",
    bullets: [
      "Complete by hand",
      "Include with physical models or impressions",
    ],
    Icon: FileText,
    ctaLabel: "Call 619.724.6400",
    ctaHref: "tel:+16197246400",
  },
  {
    title: "Watch the demos",
    lead: "See instructional videos for impression taking, scanner protocols, and phonetic bite registration.",
    bullets: [
      "Impression-taking demonstrations",
      "Phonetic bite registration technique",
      "Device-specific instructions for use",
    ],
    Icon: PlayCircle,
    ctaLabel: "Instructional Videos",
    ctaTo: "/resources/videos",
  },
];

const REQUIRED = [
  "Patient identifier (initials or internal chart ID — not PHI if possible)",
  "Prescribing dentist name, license, and practice contact",
  "Diagnosis — primary indication (TMD, OSA, bruxism, disc displacement, etc.)",
  "Device selection (Olmos Day variant, Night variant, DDSO, SomnoDent, Tap 3)",
  "Bite registration method (phonetic, centric, vertical dimension notes)",
  "Intraoral scans — upper, lower, and bite in STL or native format",
  "Ship-to address and requested delivery timeframe",
];

const TIPS = [
  {
    Icon: ScanLine,
    title: "Capture the hamular notches",
    body: "Essential for D3D-Matrix mounting. If dragging occurs with Polyvinyl Siloxane, retake around posterior retention landmarks (ball clasps, thermoforming, rigid acrylic).",
  },
  {
    Icon: Mic2,
    title: "Phonetic position for Day appliances",
    body: "Olmos Day Orthotics are fabricated on the mandible for aesthetics and function. If the patient cannot speak with the appliance in place, they won't wear it.",
  },
  {
    Icon: Crosshair,
    title: "Include incisive papilla",
    body: "Critical landmark for mounting procedures. Incomplete impressions around papilla and notches will delay the case until we can request a retake.",
  },
];

function Pathways() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Pick the route that fits your practice" />
        <ul className="mt-10 grid lg:grid-cols-3 gap-5">
          {PATHWAYS.map(({ Icon, ...p }, i) => (
            <li
              key={p.title}
              className={`flex flex-col rounded-[2rem] border p-7 md:p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-navy/10 ${
                i === 0 ? "bg-navy text-on-dark border-navy shadow-xl shadow-navy/20" : "bg-white border-surface-300/60 shadow-sm"
              }`}
            >
              <span
                className={`grid place-items-center w-12 h-12 rounded-2xl ${
                  i === 0 ? "bg-white/10 text-brand-300" : "bg-brand-100 text-brand-700"
                }`}
              >
                <Icon size={22} aria-hidden="true" />
              </span>
              <h3 className={`mt-5 font-heading font-bold text-2xl tracking-tight ${i === 0 ? "text-on-dark" : "text-navy"}`}>
                {p.title}
              </h3>
              <p className={`mt-3 leading-relaxed ${i === 0 ? "text-on-dark/75" : "text-navy/70"}`}>{p.lead}</p>
              <ul className={`mt-5 space-y-2 text-sm leading-snug ${i === 0 ? "text-on-dark/75" : "text-navy/70"}`}>
                {p.bullets.map((b) => (
                  <li key={b} className="flex gap-2.5">
                    <Check size={16} className={`mt-0.5 flex-shrink-0 ${i === 0 ? "text-brand-400" : "text-brand-700"}`} aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
              {(() => {
                const cls = `mt-auto pt-7 inline-flex items-center gap-2 font-semibold hover:underline ${
                  i === 0 ? "text-brand-300" : "text-brand-700"
                }`;
                return p.ctaHref ? (
                  <a href={p.ctaHref} className={cls}>
                    {p.ctaLabel}
                    <ArrowRight size={14} />
                  </a>
                ) : (
                  <Link to={p.ctaTo} className={cls}>
                    {p.ctaLabel}
                    <ArrowRight size={14} />
                  </Link>
                );
              })()}
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

function Required() {
  return (
    <Reveal className="relative overflow-hidden section-pad py-20 md:py-28 bg-navy">
      <div className="relative z-10 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
        <div>
          <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-on-dark">
            What to <span className="font-drama italic text-brand-500">include</span>
          </h2>
          <p className="mt-4 text-on-dark/75 text-lg leading-relaxed max-w-xl">
            Missing information is the single biggest cause of delays. Here&apos;s what we need before fabrication can
            start.
          </p>
          <img
            src="/images/dorsal1.webp"
            alt="A white sleep appliance seated on a blue printed dental model"
            className="mt-8 w-full max-w-md rounded-[2rem] object-cover shadow-xl shadow-black/30"
          />
        </div>
        <ul className="rounded-[2rem] bg-white/[0.07] border border-white/10 backdrop-blur-sm p-6 md:p-8 space-y-4">
          {REQUIRED.map((r) => (
            <li key={r} className="flex gap-3 text-on-dark/85 leading-snug">
              <span className="mt-0.5 grid place-items-center w-6 h-6 rounded-full bg-brand-500/20 text-brand-400 flex-shrink-0">
                <Check size={14} aria-hidden="true" />
              </span>
              {r}
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

function Tips() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-14 items-center">
        <figure>
          <img
            src="/images/onp-side.webp"
            alt="A white Olmos appliance seated on a blue printed dental model, side view"
            className="w-full rounded-[2.5rem] object-cover shadow-xl shadow-navy/15"
          />
        </figure>
        <div>
          <SectionHeading title="Small details that save the case" />
          <ul className="mt-8 space-y-4">
            {TIPS.map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-5 rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-6">
                <span className="flex-shrink-0 grid place-items-center w-12 h-12 rounded-2xl bg-brand-100 text-brand-700">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-heading font-bold text-lg tracking-tight text-navy">{title}</h3>
                  <p className="mt-2 text-sm text-navy/70 leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Reveal>
  );
}

export function RxInstructionsPage() {
  return (
    <>
      <PageHero
        variant="compact"
        title="How to send us"
        titleAccent="a case."
        intro="Approved doctors send cases digitally through the account portal, which is fastest. For a paper Rx, call the lab. Video walk-throughs cover impressions and bite registration."
        product="/images/ond-nylon.webp"
        productAlt="An Olmos Neuromuscular Device appliance with bands"
      />
      <Pathways />
      <Required />
      <Tips />
      <CtaBand
        title="Unsure about a case? Call the lab first."
        intro="Our technicians can walk you through impression technique, appliance selection, or device-specific requirements before you submit."
        primary={{ href: "tel:+16197246400", label: "Call 619.724.6400" }}
        secondary={{ to: "/resources/videos", label: "Instructional videos" }}
        product="/images/onp-nylon4.webp"
        productAlt="An Olmos Neuromuscular Positioner appliance"
      />
    </>
  );
}
