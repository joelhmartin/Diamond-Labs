import { Archive, Gauge, Layers } from "lucide-react";
import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";
import { DefinitionGrid } from "../../components/marketing/DefinitionGrid";

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

function Pipeline() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Every digital case follows the same six stages" />
        <ol className="mt-10 max-w-3xl divide-y divide-navy/15 border-y border-navy/15">
          {PIPELINE.map((s, i) => (
            <li key={s.title} className="flex gap-5 md:gap-8 py-6">
              <span
                aria-hidden="true"
                className="font-heading font-bold text-3xl md:text-4xl text-brand-700 w-10 md:w-14 flex-shrink-0 leading-none"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="font-heading font-bold text-xl tracking-tight text-navy">{s.title}</h3>
                <p className="mt-2 text-navy/70 leading-relaxed">{s.body}</p>
                <p className="mt-2 text-sm text-navy/70">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Reveal>
  );
}

function Advantages() {
  return (
    <Reveal className="section-pad py-20 md:py-24 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="What you gain from an end-to-end digital pipeline" />
        <DefinitionGrid items={ADVANTAGES.map((a) => ({ term: a.title, body: a.body, Icon: a.Icon }))} />
      </div>
    </Reveal>
  );
}

export function DigitalWorkflowPage() {
  return (
    <>
      <PageHero
        variant="image"
        title="Scan to ship"
        titleAccent="in 10 business days."
        intro="A fully digital fabrication pipeline. Digital cases follow the same six stages, and printed appliances are archived for reprint."
        image="/images/ddso-full.webp"
        imageAlt="A 3D-printed DDSO sleep appliance on a stainless steel bench in the Diamond lab"
      />
      <Pipeline />
      <Advantages />
      <CtaBand
        title="Send a case"
        intro="Approved doctors send scans through the Rx form in the account portal, and we'll confirm receipt within one business day."
        primary={{ label: "Submit Digital Rx", to: "/submit-case" }}
        secondary={{ label: "Rx instructions", to: "/resources/rx-instructions" }}
      />
    </>
  );
}
