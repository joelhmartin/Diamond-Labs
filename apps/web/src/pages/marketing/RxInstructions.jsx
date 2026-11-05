import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";
import { DefinitionGrid } from "../../components/marketing/DefinitionGrid";

const PATHWAYS = [
  {
    title: "Digital Rx (fastest)",
    lead: "Approved doctors send intraoral scans and Rx details through the Rx form in the account portal.",
    bullets: [
      "STL or native scanner files accepted",
      "Automatic case-number assignment",
      "Confirmation within one business day",
    ],
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
    title: "Capture the hamular notches",
    body: "Essential for D3D-Matrix mounting. If dragging occurs with Polyvinyl Siloxane, retake around posterior retention landmarks (ball clasps, thermoforming, rigid acrylic).",
  },
  {
    title: "Phonetic position for Day appliances",
    body: "Olmos Day Orthotics are fabricated on the mandible for aesthetics and function. If the patient cannot speak with the appliance in place, they won't wear it.",
  },
  {
    title: "Include incisive papilla",
    body: "Critical landmark for mounting procedures. Incomplete impressions around papilla and notches will delay the case until we can request a retake.",
  },
];

function Pathways() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Pick the route that fits your practice" />
        <ul className="mt-10 divide-y divide-navy/15 border-y border-navy/15">
          {PATHWAYS.map((p) => (
            <li key={p.title} className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_auto] gap-4 md:gap-10 py-8 items-start">
              <div>
                <h3 className="font-heading font-bold text-2xl tracking-tight text-navy">{p.title}</h3>
                <p className="mt-2 text-navy/70 leading-relaxed">{p.lead}</p>
              </div>
              <ul className="list-disc pl-5 space-y-1.5 text-sm text-navy/70 leading-snug marker:text-navy/40">
                {p.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              {p.ctaHref ? (
                <a href={p.ctaHref} className="inline-flex items-center gap-2 font-semibold text-brand-700 hover:underline">
                  {p.ctaLabel}
                  <ArrowRight size={14} />
                </a>
              ) : (
                <Link to={p.ctaTo} className="inline-flex items-center gap-2 font-semibold text-brand-700 hover:underline">
                  {p.ctaLabel}
                  <ArrowRight size={14} />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

function Required() {
  return (
    <Reveal className="section-pad py-20 md:py-24 bg-surface-100">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-14">
        <div className="lg:col-span-2">
          <SectionHeading
            title="What to include"
            intro="Missing information is the single biggest cause of delays. Here's what we need before fabrication can start."
          />
        </div>
        <ul className="lg:col-span-3 list-disc pl-5 space-y-3 text-navy/70 leading-snug marker:text-navy/40">
          {REQUIRED.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

function Tips() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Small details that save the case" />
        <DefinitionGrid items={TIPS.map((t) => ({ term: t.title, body: t.body }))} />
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
      />
      <Pathways />
      <Required />
      <Tips />
      <CtaBand
        title="Unsure about a case? Call the lab first."
        intro="Our technicians can walk you through impression technique, appliance selection, or device-specific requirements before you submit."
        primary={{ href: "tel:+16197246400", label: "Call 619.724.6400" }}
        secondary={{ to: "/resources/videos", label: "Instructional videos" }}
      />
    </>
  );
}
