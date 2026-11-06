import { BadgeCheck, BatteryLow, Brain, CirclePause, Droplet, Focus, Layers, Link2, Maximize2, Moon, MoveHorizontal, Scale, Volume2, Wind } from "lucide-react";
import { ProductCatalog } from "../../components/marketing/ProductCatalog";
import { PageHero } from "../../components/marketing/PageHero";
import { CtaBand } from "../../components/marketing/CtaBand";
import { HeroStage } from "../../components/marketing/HeroStage";
import { Reveal } from "../../components/marketing/Reveal";
import { SymptomsSection } from "../../components/marketing/SymptomsSection";

const SLEEP_TABS = [
  { key: "ddsoAnt", label: "DDSO — Anterior", sub: "Sleep Appliance" },
  { key: "ddsoPost", label: "DDSO — Posterior", sub: "Sleep Appliance" },
];

const CORE_FEATURES = [
  {
    Icon: MoveHorizontal,
    title: "Mandibular Repositioning",
    body: "Brings the base of the tongue forward, opening the oropharynx and strengthening the upper airway — greater resistance to airway collapse.",
  },
  {
    Icon: Link2,
    title: "MED-Grade Elastomeric Straps",
    body: "Allow lateral movement and prevent retrusion of the mandible. Available in a range of sizes and elasticity to provide useful feedback.",
  },
  {
    Icon: Maximize2,
    title: "Maximum Intraoral Volume",
    body: "Dual action of mandibular repositioning while maintaining maximum intraoral space for the tongue.",
  },
  {
    Icon: Layers,
    title: "Biocompatible PA2200 Nylon",
    body: "MED-Grade nylon allows a thin and comfortable device with unmatched durability.",
  },
  {
    Icon: Scale,
    title: "Reduced Forces on Teeth",
    body: "Delivered with an upper and lower splint that distributes forces throughout both arches.",
  },
  {
    Icon: BadgeCheck,
    title: "5-Year Unconditional Warranty",
    body: "Every DDSO ships with a 5-year warranty. Digital design allows replacements to be made without new records.",
  },
];

const SYMPTOMS = [
  { Icon: Volume2, text: "Loud, persistent snoring" },
  { Icon: CirclePause, text: "Pauses in breathing noticed by a bed partner" },
  { Icon: Wind, text: "Gasping or choking during sleep" },
  { Icon: BatteryLow, text: "Daytime sleepiness despite a full night in bed" },
  { Icon: Brain, text: "Morning headaches" },
  { Icon: Droplet, text: "Dry mouth or sore throat on waking" },
  { Icon: Focus, text: "Trouble concentrating or remembering" },
  { Icon: Moon, text: "Restless sleep or waking often at night" },
];

const VARIANTS = [
  {
    name: "DDSO Anterior",
    image: "/images/ddso-ant-hooks.webp",
    alt: "DDSO Anterior upper and lower trays with nylon band hooks",
    facts: ["Anterior contact only", "Nylon band system", "Biocompatible nylon PA12"],
  },
  {
    name: "DDSO Posterior",
    image: "/images/ddso-post-iso.webp",
    alt: "DDSO Posterior full-arch trays with a blue band",
    facts: ["Full-arch posterior", "Adjustable band system", "Biocompatible nylon PA12"],
  },
];

function CoreFeatures() {
  return (
    <Reveal className="relative overflow-hidden section-pad py-20 md:py-28 bg-navy text-on-dark">
      <HeroStage />
      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center">
          <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight">
            Core features <span className="font-drama italic text-brand-400">and benefits</span>
          </h2>
          <img
            src="/images/ddso-front.webp"
            alt="DDSO front view showing the upper and lower trays with blue straps"
            className="w-[70%] max-w-[360px] mx-auto lg:ml-auto h-auto drop-shadow-[0_30px_50px_rgba(0,20,60,0.45)]"
          />
        </div>

        <ul className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {CORE_FEATURES.map(({ Icon, title, body }) => (
            <li key={title} className="rounded-[2rem] bg-white/[0.07] border border-white/10 backdrop-blur-sm p-7">
              <span className="grid place-items-center w-12 h-12 rounded-2xl bg-white/10 text-brand-300">
                <Icon size={22} aria-hidden="true" />
              </span>
              <h3 className="mt-5 font-heading font-bold text-lg tracking-tight">{title}</h3>
              <p className="mt-2 text-on-dark/75 text-sm leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>

        <p className="mt-12 max-w-3xl text-sm text-on-dark/70 leading-relaxed">
          FDA 510(k) cleared for the treatment of snoring and/or obstructive sleep apnea in adults. Additional
          modifications and attachments have not been reviewed or cleared by the FDA for the treatment of OSA.
        </p>
      </div>
    </Reveal>
  );
}

function Variants() {
  return (
    <Reveal className="section-pad py-20 md:py-28">
      <div className="max-w-6xl mx-auto">
        <h2 className="max-w-2xl font-heading font-bold text-3xl md:text-5xl tracking-tight text-navy">
          Anterior or <span className="font-drama italic text-brand-700">posterior</span>
        </h2>
        <ul className="mt-10 grid md:grid-cols-2 gap-5">
          {VARIANTS.map((v) => (
            <li key={v.name} className="rounded-[2rem] bg-white border border-surface-300/60 shadow-sm overflow-hidden">
              <div className="bg-gradient-to-br from-white via-surface-50 to-surface-100 p-8 aspect-[4/3] grid place-items-center">
                <img src={v.image} alt={v.alt} loading="lazy" className="max-h-full max-w-[420px] w-full object-contain drop-shadow-[0_18px_28px_rgba(0,20,60,0.18)]" />
              </div>
              <div className="p-8">
                <h3 className="font-heading font-bold text-2xl tracking-tight text-navy">{v.name}</h3>
                <ul className="mt-5 flex flex-wrap gap-2">
                  {v.facts.map((f) => (
                    <li key={f} className="px-4 py-1.5 rounded-full bg-brand-100 text-brand-700 text-sm font-semibold">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

export function SleepPage() {
  return (
    <>
      <PageHero
        variant="compact"
        title="Mandibular advancement,"
        titleAccent="engineered."
        intro="The Diamond Digital Sleep Orthotic (DDSO) is a custom CAD/CAM device for snoring and mild-to-moderate OSA in adults. FDA 510(k) cleared, fully digital."
        product="/images/hero-ddso.webp"
        productAlt="DDSO sleep appliance with a blue adjustment strap"
      />
      <ProductCatalog tabs={SLEEP_TABS} spacing="pt-12 md:pt-14 pb-12 md:pb-16" />
      <SymptomsSection
        title="Signs of snoring and sleep apnea"
        intro="Obstructive sleep apnea often goes unnoticed by the patient: a bed partner hears the snoring and the pauses, and the patient feels the tiredness. Diagnosis comes from a physician and a sleep study; the DDSO is made on that prescription."
        photo={{ src: "/images/symptoms-sleep-tired.webp", alt: "Woman in bed yawning, with a sleep mask pushed up on her forehead" }}
        symptoms={SYMPTOMS}
      />
      <CoreFeatures />
      <Variants />
      <CtaBand
        title="Start a DDSO case through the portal Rx form"
        intro="All DDSO devices are Rx-only. Approved doctors send scans and Rx details through the Rx form in the account portal."
        primary={{ label: "Submit Digital Rx", to: "/submit-case" }}
        secondary={{ label: "Talk to the lab", to: "/contact" }}
        product="/images/ddso-post-overview.webp"
        productAlt="DDSO Posterior sleep appliance, upper and lower trays"
      />
    </>
  );
}
