import { Activity, AudioLines, Brain, CheckCircle2, Ear, Eye, Frown, Hand, Lock, Moon, Sun, Utensils, Zap } from "lucide-react";
import { ProductCatalog } from "../../components/marketing/ProductCatalog";
import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { HeroStage } from "../../components/marketing/HeroStage";
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
    image: "/images/ond-overview.webp",
    alt: "ON-D decompressor, upper and lower elements on a model",
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
    image: "/images/onp-nylon4.webp",
    alt: "ON-P positioner with anterior ring on a model",
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
  { Icon: Brain, text: "Chronic recurring headaches" },
  { Icon: AudioLines, text: "Clicking, popping, or grating sounds in the jaw joints" },
  { Icon: Ear, text: "Earaches, congestion, or ringing in the ears" },
  { Icon: Lock, text: "Limited jaw opening or locking" },
  { Icon: Activity, text: "Neck and/or throat pain" },
  { Icon: Frown, text: "Difficulty closing the teeth together" },
  { Icon: Eye, text: "Pain behind the eyes" },
  { Icon: Utensils, text: "Swallowing difficulty" },
  { Icon: Hand, text: "Pain in the tongue, gums, or cheek muscles" },
  { Icon: Zap, text: "Teeth grinding or clenching" },
];

const MATERIALS = [
  { name: "Nylon", note: "OND · ONP", image: "/images/ond-nylon.webp", alt: "OND appliance in white nylon on a dark model" },
  { name: "Trutaine", note: "OND · ONP", image: "/images/ond-trutaine.webp", alt: "OND appliance in Trutaine on blue models" },
  { name: "Bioflex", note: "ONP", image: "/images/onp-bioflex-new.webp", alt: "ONP appliance in clear Bioflex" },
  { name: "Thermoform", note: "OD, PMT", image: "/images/od-pmt.webp", alt: "Thermoform PMT day orthotic on a blue model" },
];

function Definition() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Splint or orthotic" />
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          <div className="bg-surface-100 card-radius p-8 md:p-10 border border-surface-300/60">
            <h3 className="font-heading font-bold text-lg text-navy">Splint</h3>
            <p className="mt-3 text-xl md:text-2xl italic text-navy/70 leading-snug">
              &ldquo;A rigid or flexible appliance used to maintain in position a displaced or mobile part, or to
              keep in place and protect an injured part.&rdquo;
            </p>
          </div>
          <div className="bg-navy card-radius p-8 md:p-10 shadow-xl shadow-navy/20">
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
    <Reveal className="section-pad py-20 md:py-24 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-10 items-center">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-3 text-navy/70 font-semibold">
              <Sun size={16} className="text-accent-500" aria-hidden="true" />
              Olmos Day orthotics
            </div>
            <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight">
              Worn during function, made in the <span className="font-drama italic text-brand-700">phonetic position</span>
            </h2>
            <p className="mt-5 text-navy/70 text-lg leading-relaxed">
              Indicated for chronic joint inflammation and disc displacement. Can function as a positioning stent,
              correcting vertical dimension, rotational cant, and protrusive changes. Lingual anatomic ridges guide
              disclusion and protect the contralateral joints in working movements.
            </p>
          </div>
          <div className="rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-6 grid place-items-center">
            <img
              src="/images/ond-bands.webp"
              alt="OND appliance with green elastic bands on a model"
              loading="lazy"
              className="w-[60%] max-w-[280px] h-auto drop-shadow-[0_18px_28px_rgba(0,20,60,0.18)]"
            />
          </div>
        </div>

        <ul className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {DAY_ORTHOTICS.map((o) => (
            <li
              key={o.code}
              className="rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-7 hover:-translate-y-1 hover:shadow-xl hover:shadow-navy/10 transition-all duration-300"
            >
              <span className="inline-block px-3 py-1 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold">
                {o.code}
              </span>
              <h3 className="mt-4 font-heading font-bold text-xl tracking-tight">{o.name}</h3>
              <div className="mt-1 text-sm text-navy/70 italic">{o.tag}</div>
              <ul className="mt-4 space-y-2.5">
                {o.bullets.map((b) => (
                  <li key={b} className="flex gap-2.5 text-sm text-navy/70 leading-snug">
                    <CheckCircle2 size={14} className="text-brand-700 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

function Materials() {
  return (
    <Reveal className="relative overflow-hidden section-pad py-20 md:py-28 bg-navy">
      <HeroStage />
      <div className="relative z-10 max-w-6xl mx-auto">
        <h2 className="max-w-3xl font-heading font-bold text-3xl md:text-5xl tracking-tight text-on-dark">
          The materials, <span className="font-drama italic text-brand-400">side by side</span>
        </h2>
        <ul className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
          {MATERIALS.map((m) => (
            <li key={m.name} className="rounded-[2rem] bg-white/[0.07] border border-white/10 backdrop-blur-sm p-5 md:p-6">
              <div className="aspect-square grid place-items-center">
                <img
                  src={m.image}
                  alt={m.alt}
                  loading="lazy"
                  className="max-h-full max-w-full object-contain drop-shadow-[0_18px_28px_rgba(0,20,60,0.45)]"
                />
              </div>
              <h3 className="mt-4 font-heading font-bold text-lg text-on-dark tracking-tight">{m.name}</h3>
              <p className="text-sm text-on-dark/70">{m.note}</p>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

function NightOrthotics() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 mb-3 text-navy/70 font-semibold">
            <Moon size={16} className="text-navy" aria-hidden="true" />
            Olmos Night orthotics
          </div>
          <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight">
            Worn supine, built for <span className="font-drama italic text-brand-700">the airway</span>
          </h2>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {NIGHT_ORTHOTICS.map((o) => (
            <div key={o.code} className="bg-navy card-radius p-8 md:p-10 shadow-xl shadow-navy/20">
              <img src={o.image} alt={o.alt} loading="lazy" className="mx-auto mb-6 w-[70%] max-w-[320px] h-auto drop-shadow-[0_18px_28px_rgba(0,0,0,0.4)]" />
              <div className="text-sm font-semibold text-brand-400">{o.code}</div>
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
    <Reveal className="section-pad py-20 md:py-24 bg-surface-100">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_1.4fr] gap-10 lg:gap-14 items-start">
        <div className="lg:sticky lg:top-28">
          <SectionHeading
            title="Signs and symptoms of TMD"
            intro="TMD transcends the boundaries of dentistry, neurology, physical therapy, and psychology. Symptoms often involve more than one of the numerous TMJ components: muscles, nerves, tendons, ligaments, bones, and connective tissue."
          />
          <div className="mt-8 rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-6 grid place-items-center">
            <img
              src="/images/onp-model.webp"
              alt="ONP orthotic seated on a model of the teeth"
              loading="lazy"
              className="w-[55%] max-w-[240px] h-auto drop-shadow-[0_18px_28px_rgba(0,20,60,0.18)]"
            />
          </div>
        </div>
        <ul className="grid sm:grid-cols-2 gap-4">
          {SYMPTOMS.map(({ Icon, text }) => (
            <li
              key={text}
              className="flex items-center gap-4 rounded-[1.75rem] bg-white border border-surface-300/60 shadow-sm p-5 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-navy/10 transition-all duration-300"
            >
              <span className="flex-shrink-0 grid place-items-center w-12 h-12 rounded-2xl bg-brand-100 text-brand-700">
                <Icon size={22} aria-hidden="true" />
              </span>
              <span className="text-navy leading-snug">{text}</span>
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
        product="/images/ond-nylon.webp"
        productAlt="OND orthotic in white nylon on a dark model"
      />
      <ProductCatalog tabs={TMD_TABS} spacing="pt-12 md:pt-14 pb-12 md:pb-16" />
      <Definition />
      <DayOrthotics />
      <Materials />
      <NightOrthotics />
      <Symptoms />
      <CtaBand
        title="Start a case through the portal Rx form"
        intro="All Olmos TMD orthotics are Rx-only. Appliance selection is driven by comprehensive diagnosis. Unsure which variant fits? We'll help you decide."
        primary={{ label: "Submit Digital Rx", to: "/submit-case" }}
        secondary={{ label: "Talk to the lab", to: "/contact" }}
        product="/images/onp-clear.webp"
        productAlt="Clear ONP orthotic on a blue model"
      />
    </>
  );
}
