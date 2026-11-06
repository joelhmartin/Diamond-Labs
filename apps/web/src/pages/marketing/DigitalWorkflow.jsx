import { Link } from "react-router-dom";
import { Archive, ArrowRight, Gauge, Layers } from "lucide-react";
import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";
import { HeroStage } from "../../components/marketing/HeroStage";

const PIPELINE = [
  {
    title: "Intraoral scan",
    body: "Digital capture from your scanner (Medit, iTero, 3Shape, Primescan) replaces traditional impressions. We accept STL and native files.",
    detail: "Sent through the Rx form in the account portal, HIPAA-compliant.",
  },
  {
    title: "Digital bite registration",
    body: "Captured in the phonetic position for Olmos Day appliances. Hamular notches and incisive papilla preserved for D3D-Matrix mounting.",
    detail: "Phonetic bite, articulator transfer.",
  },
  {
    title: "CAD articulation",
    body: "Each case is designed in CAD to the parameters on your Rx: vertical dimension, rotation, cant and protrusion.",
    detail: "Every occlusal surface mapped.",
  },
  {
    title: "SLS printing",
    body: "Printed appliances are made in biocompatible PA12 nylon at sub-millimeter tolerance. Thin, comfortable, durable, and digitally archived for reprint.",
    detail: "MED-Grade PA2200, selective laser sintering.",
  },
  {
    title: "Quality verification",
    body: "Dimensional check against the design file. Every appliance is verified before it leaves the lab.",
    detail: "Dimensional QA, finishing, sterilization.",
  },
  {
    title: "Ship with tracking",
    body: "Shipped with tracking, a care kit, and insertion instructions. Delivery notification sent to your practice.",
    detail: "FedEx, tracking generated automatically.",
  },
];

const ADVANTAGES = [
  {
    Icon: Archive,
    title: "Digital reprint, no new records",
    body: "Every case is digitally archived. Lost, broken, or worn appliances can be reprinted from the original design without re-scanning the patient.",
  },
  {
    Icon: Gauge,
    title: "10-business-day turnaround",
    body: "From receipt to ship in 10 business days, with the same digital steps each time.",
  },
  {
    Icon: Layers,
    title: "Consistent output",
    body: "Computer-aided articulation means every technician, every shift, produces an appliance built to the parameters on your Rx.",
  },
];

const APPLIANCES = [
  { name: "Diamond Digital Sleep Orthotic", short: "DDSO", image: "/images/ddso-post-iso.webp", to: "/services/sleep" },
  { name: "Olmos Neuromuscular Device", short: "OND", image: "/images/ond-nylon.webp", to: "/services/tmd" },
  { name: "Olmos Neuromuscular Positioner", short: "ONP", image: "/images/onp-nylon4.webp", to: "/services/tmd" },
];

function Pipeline() {
  return (
    <Reveal className="relative overflow-hidden section-pad py-24 md:py-32 bg-navy">
      <HeroStage />
      <div className="relative z-10 max-w-6xl mx-auto">
        <h2 className="max-w-3xl font-heading font-bold text-3xl md:text-5xl tracking-tight text-on-dark">
          Every digital case follows the same six stages
        </h2>
        <ol className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {PIPELINE.map((s, i) => (
            <li
              key={s.title}
              className="flex flex-col rounded-[2rem] bg-white/[0.07] border border-white/10 backdrop-blur-sm p-7"
            >
              <span aria-hidden="true" className="font-drama italic text-6xl leading-none text-brand-400">
                {i + 1}
              </span>
              <h3 className="mt-5 font-heading font-bold text-xl tracking-tight text-on-dark">{s.title}</h3>
              <p className="mt-3 text-on-dark/75 leading-relaxed">{s.body}</p>
              <p className="mt-auto pt-5 text-sm text-on-dark/60">{s.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </Reveal>
  );
}

function Advantages() {
  return (
    <Reveal className="section-pad py-24 md:py-32">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        <figure>
          <img
            src="/images/ddso-kit.webp"
            alt="A finished DDSO appliance with its case, cleaning kit and patient instructions"
            className="w-full rounded-[2.5rem] object-cover shadow-xl shadow-navy/15"
          />
          <figcaption className="mt-4 text-sm text-navy/70">
            Appliances ship with a care kit and insertion instructions.
          </figcaption>
        </figure>
        <div>
          <SectionHeading title="What you gain from an end-to-end digital pipeline" />
          <ul className="mt-10 space-y-8">
            {ADVANTAGES.map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-5">
                <span className="flex-shrink-0 grid place-items-center w-12 h-12 rounded-2xl bg-brand-100 text-brand-700">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-heading font-bold text-lg tracking-tight text-navy">{title}</h3>
                  <p className="mt-2 text-navy/70 leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Reveal>
  );
}

function Appliances() {
  return (
    <Reveal className="section-pad pb-8">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Appliances we make this way" />
        <ul className="mt-10 grid md:grid-cols-3 gap-5">
          {APPLIANCES.map((a) => (
            <li key={a.short}>
              <Link
                to={a.to}
                className="group flex flex-col h-full rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-7 hover:shadow-xl hover:shadow-navy/10 transition-shadow duration-300"
              >
                <img src={a.image} alt={a.name} className="h-44 w-full object-contain transition-transform duration-500 group-hover:scale-105" />
                <span className="mt-6 font-heading font-bold text-xl tracking-tight text-navy">{a.short}</span>
                <span className="mt-1 flex items-center justify-between gap-3 text-navy/70 text-sm">
                  {a.name}
                  <ArrowRight size={16} className="text-brand-700 flex-shrink-0 group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

export function DigitalWorkflowPage() {
  return (
    <>
      <PageHero
        title="Scan to ship"
        titleAccent="in 10 business days."
        intro="A fully digital fabrication pipeline. Digital cases follow the same six stages, and printed appliances are archived for reprint."
        product="/images/ddso-isometric.webp"
        productAlt="A DDSO sleep appliance on a blue printed dental model"
      />
      <Pipeline />
      <Advantages />
      <Appliances />
      <CtaBand
        title="Send a case"
        intro="Approved doctors send scans through the Rx form in the account portal, and we'll confirm receipt within one business day."
        primary={{ label: "Submit Digital Rx", to: "/submit-case" }}
        secondary={{ label: "Rx instructions", to: "/resources/rx-instructions" }}
        product="/images/ddso-post-iso.webp"
        productAlt="A DDSO sleep appliance"
      />
    </>
  );
}
