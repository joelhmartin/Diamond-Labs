import { Sun, Moon, CheckCircle2 } from "lucide-react";
import { ProductCatalog } from "../../components/marketing/ProductCatalog";
import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";

const TMD_TABS = [
  { key: "ond", label: "OND", sub: "Olmos Neuromuscular Device" },
  { key: "onp", label: "ONP", sub: "Olmos Neuromuscular Positioner" },
];

const DAY_ORTHOTICS = [
  {
    code: "OD — Acrylic",
    name: "Acrylic Day",
    tag: "Easily adjusted",
    bullets: [
      "All acrylic with ball clasps and braided lingual wire support",
      "Chronic disc-displacement or skeletal/muscular asymmetry",
      "Functions as a positioning stent to correct vertical dimension, rotation, cant, and protrusion",
      "Lingual anatomical ridge guides disclusion and protects the contralateral joint in working movements",
    ],
  },
  {
    code: "OD — Expansion",
    name: "Lingual Expansion",
    tag: "No occlusal coverage #22–27",
    bullets: [
      "Narrow arches and/or anterior crowding",
      "Minimal lingual interference required",
      "If lingual wire is activated, tooth movement may occur",
      "Lingual expander connection with open occlusal anteriors",
    ],
  },
  {
    code: "OD — PMT",
    name: "Thermoform",
    tag: "Most compact & comfortable",
    bullets: [
      "Narrow arches",
      "Inter-occlusal distances less than 1.5 mm",
      "Patients with allergies to metals or acrylics",
      "Not recommended for severe crowding or undercuts",
    ],
  },
  {
    code: "OD — Printed",
    name: "Nylon Printed",
    tag: "Digital fabrication",
    bullets: [
      "3D printed in biocompatible PA12 nylon",
      "Thin, comfortable, and durable",
      "Digitally archived — reprint without new records",
      "Ideal for patients with metal allergies",
    ],
  },
];

const NIGHT_ORTHOTICS = [
  {
    code: "ON-D",
    name: "Decompressor — Acrylic",
    summary:
      "Controls parafunctional activity and reduces the forces of clenching and grinding from chronic pain conditions.",
    bullets: [
      "Reduces inflammation (capsulitis)",
      "Indicated where there is no suspected apnea",
      "Digitally designed and 3D-printable in white biocompatible nylon",
      "Upper and lower elements disclosed with an anterior pad — crowded or worn teeth no longer a factor",
      "Digital fabrication allows a new appliance to be made if lost",
    ],
  },
  {
    code: "ON-P",
    name: "Positioner — PMT / Acrylic / Printed",
    summary:
      "Combines the deprogrammer with an anterior ring to position the mandible while supine. Improves airway patency when made in the phonetic position.",
    bullets: [
      "Indicated when there is suspected airway compromise or sleep disordered breathing",
      "Anterior ring provides space for the tongue at night",
      "Promotes forward mandibular movement",
      "Prevents locking in the supine position",
      "Improves airway and nasal obstruction",
      "Reduces clenching and grinding",
    ],
  },
];

const SYMPTOMS = [
  "Chronic recurring headaches",
  "Clicking, popping, or grating sounds in the jaw joints",
  "Earaches, congestion, or ringing in the ears",
  "Limited jaw opening or locking",
  "Neck and/or throat pain",
  "Difficulty closing the teeth together",
  "Pain behind the eyes",
  "Swallowing difficulty",
  "Pain in the tongue, gums, or cheek muscles",
  "Teeth grinding or clenching",
];

function Definition() {
  return (
    <Reveal className="section-pad py-20 md:py-24 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Splint or orthotic" />
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          <div className="bg-white card-radius p-8 md:p-10 border border-surface-300/50">
            <h3 className="font-heading font-bold text-lg text-navy">Splint</h3>
            <p className="mt-3 text-xl md:text-2xl italic text-navy/70 leading-snug">
              &ldquo;A rigid or flexible appliance used to maintain in position a displaced or mobile part, or to
              keep in place and protect an injured part.&rdquo;
            </p>
          </div>
          <div className="bg-navy card-radius p-8 md:p-10">
            <h3 className="font-heading font-bold text-lg text-on-dark">Orthotic, what we build</h3>
            <p className="mt-3 text-xl md:text-2xl italic text-on-dark leading-snug">
              &ldquo;An orthopedic appliance used to support, align, prevent or correct deformities, or to improve
              the function of movable parts.&rdquo;
            </p>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function DayOrthotics() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 mb-3 text-navy/70 font-semibold">
            <Sun size={16} className="text-accent-500" aria-hidden="true" />
            Olmos Day orthotics
          </div>
          <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight">
            Worn during function, made in the phonetic position
          </h2>
          <p className="mt-5 text-navy/70 text-lg leading-relaxed">
            Indicated for chronic joint inflammation and disc displacement. Can function as a positioning stent,
            correcting vertical dimension, rotational cant, and protrusive changes. Lingual anatomic ridges guide
            disclusion and protect the contralateral joints in working movements.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
          {DAY_ORTHOTICS.map((o) => (
            <div key={o.code} className="border-t border-navy/15 pt-5">
              <div className="text-sm font-semibold text-brand-700">{o.code}</div>
              <h3 className="mt-1 font-heading font-bold text-xl tracking-tight">{o.name}</h3>
              <div className="mt-1 text-sm text-navy/70 italic">{o.tag}</div>
              <ul className="mt-4 list-disc pl-5 space-y-2 marker:text-navy/40 text-sm text-navy/70 leading-snug">
                {o.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

function NightOrthotics() {
  return (
    <Reveal className="section-pad py-20 md:py-24 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 mb-3 text-navy/70 font-semibold">
            <Moon size={16} className="text-navy" aria-hidden="true" />
            Olmos Night orthotics
          </div>
          <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight">
            Worn supine, built for the airway
          </h2>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {NIGHT_ORTHOTICS.map((o) => (
            <div key={o.code} className="bg-navy card-radius p-8 md:p-10">
              <div className="text-sm font-semibold text-brand-500">{o.code}</div>
              <h3 className="mt-1 font-heading font-bold text-2xl md:text-3xl text-on-dark tracking-tight leading-tight">
                {o.name}
              </h3>
              <p className="mt-4 text-on-dark/70 text-sm md:text-base leading-relaxed">{o.summary}</p>
              <ul className="mt-6 space-y-3">
                {o.bullets.map((b) => (
                  <li key={b} className="flex gap-3 text-sm text-on-dark/70">
                    <CheckCircle2 size={14} className="text-brand-500 flex-shrink-0 mt-1" aria-hidden="true" />
                    <span className="leading-snug">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

function Symptoms() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading
          title="Signs and symptoms of TMD"
          intro="TMD transcends the boundaries of dentistry, neurology, physical therapy, and psychology. Symptoms often involve more than one of the numerous TMJ components: muscles, nerves, tendons, ligaments, bones, and connective tissue."
        />
        <ul className="mt-10 list-disc pl-5 columns-1 sm:columns-2 gap-x-12 marker:text-navy/40 text-navy/70 space-y-3">
          {SYMPTOMS.map((s) => (
            <li key={s} className="break-inside-avoid">
              {s}
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

export function TmdPage() {
  return (
    <>
      <PageHero
        variant="compact"
        title="Orthotics,"
        titleAccent="not splints."
        intro="The Olmos Series is designed to correct skeletal, muscular, tendon, and ligament asymmetries — restoring function and reducing symptoms rather than simply protecting teeth."
      />
      <ProductCatalog tabs={TMD_TABS} spacing="pt-12 md:pt-14 pb-12 md:pb-16" />
      <Definition />
      <DayOrthotics />
      <NightOrthotics />
      <Symptoms />
      <CtaBand
        title="Start a case through the portal Rx form"
        intro="All Olmos TMD orthotics are Rx-only. Appliance selection is driven by comprehensive diagnosis. Unsure which variant fits? We'll help you decide."
        primary={{ label: "Submit Digital Rx", to: "/submit-case" }}
        secondary={{ label: "Talk to the lab", to: "/contact" }}
      />
    </>
  );
}
