import { Archive, Gauge, Layers } from "lucide-react";
import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";

const PIPELINE = [
  {
    title: "Intraoral scan",
    body: "Digital capture from your scanner (Medit, iTero, 3Shape, Primescan) replaces traditional impressions. We accept STL and native files.",
    detail: "Submitted via the Digital Rx portal, HIPAA-compliant upload.",
  },
  {
    title: "Digital bite registration",
    body: "Captured in the phonetic position for Olmos Day appliances. Hammular notches and incisive papilla preserved for D3D-Matrix mounting.",
    detail: "Phonetic bite, articulator transfer.",
  },
  {
    title: "CAD articulation",
    body: "Each case is designed in CAD to the parameters on your Rx: vertical dimension, rotation, cant and protrusion.",
    detail: "Every occlusal surface mapped.",
  },
  {
    title: "SLS fabrication",
    body: "3D printed in biocompatible PA12 nylon at sub-millimeter tolerance. Thin, comfortable, durable, and digitally archived for reprint.",
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
    body: "From receipt to ship in 10 business days, with the same digital steps on every case.",
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
        <SectionHeading title="Every case follows the same six stages" />
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
        <dl className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-10">
          {ADVANTAGES.map((a) => (
            <div key={a.title} className="border-t border-navy/15 pt-5">
              <a.Icon size={20} className="text-brand-700" aria-hidden="true" />
              <dt className="mt-3 font-heading font-bold text-lg text-navy">{a.title}</dt>
              <dd className="mt-2 text-navy/70 text-sm leading-relaxed">{a.body}</dd>
            </div>
          ))}
        </dl>
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
        titleAccent="in 10 days."
        intro="A fully digital fabrication pipeline. Every appliance is archived, and every case follows the same six stages."
        image="/images/ddso-full.webp"
        imageAlt="A 3D-printed DDSO sleep appliance on a stainless steel bench in the Diamond lab"
      />
      <Pipeline />
      <Advantages />
      <CtaBand
        title="Got a scan? Send it over."
        intro="Upload through the Digital Rx portal and we'll confirm receipt within one business day."
        primary={{ label: "Submit Digital Rx", to: "/submit-case" }}
        secondary={{ label: "Rx instructions", to: "/resources/rx-instructions" }}
      />
    </>
  );
}
