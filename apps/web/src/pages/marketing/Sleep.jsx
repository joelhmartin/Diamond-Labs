import { CheckCircle2 } from "lucide-react";
import { ProductCatalog } from "../../components/marketing/ProductCatalog";
import { PageHero } from "../../components/marketing/PageHero";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";

const SLEEP_TABS = [
  { key: "ddsoAnt", label: "DDSO — Anterior", sub: "Sleep Appliance" },
  { key: "ddsoPost", label: "DDSO — Posterior", sub: "Sleep Appliance" },
];

const CORE_FEATURES = [
  {
    title: "Mandibular Repositioning",
    body: "Brings the base of the tongue forward, opening the oropharynx and strengthening the upper airway — greater resistance to airway collapse.",
  },
  {
    title: "MED-Grade Elastomeric Straps",
    body: "Allow lateral movement and prevent retrusion of the mandible. Available in a range of sizes and elasticity to provide useful feedback.",
  },
  {
    title: "Maximum Intraoral Volume",
    body: "Dual action of mandibular repositioning while maintaining maximum intraoral space for the tongue.",
  },
  {
    title: "Biocompatible PA2200 Nylon",
    body: "MED-Grade nylon allows a thin and comfortable device with unmatched durability.",
  },
  {
    title: "Reduced Forces on Teeth",
    body: "Delivered with an upper and lower splint that distributes forces throughout both arches.",
  },
  {
    title: "5-Year Unconditional Warranty",
    body: "Every DDSO ships with a 5-year warranty. Digital design allows replacements to be made without new records.",
  },
];

function CoreFeatures() {
  return (
    <Reveal className="section-pad py-20 md:py-24 bg-navy text-on-dark">
      <div className="max-w-6xl mx-auto">
        <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight max-w-2xl">
          Core features and benefits
        </h2>

        <ul className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
          {CORE_FEATURES.map((f) => (
            <li key={f.title} className="flex gap-3 border-t border-white/15 pt-5">
              <CheckCircle2 size={16} className="text-brand-500 flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-heading font-semibold text-base">{f.title}</h3>
                <p className="mt-2 text-on-dark/70 text-sm leading-relaxed">{f.body}</p>
              </div>
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

export function SleepPage() {
  return (
    <>
      <PageHero
        variant="compact"
        title="Mandibular advancement,"
        titleAccent="engineered."
        intro="The Diamond Digital Sleep Orthotic (DDSO) is a custom CAD/CAM device for snoring and mild-to-moderate OSA in adults. FDA 510(k) cleared, fully digital."
      />
      <ProductCatalog tabs={SLEEP_TABS} spacing="pt-12 md:pt-14 pb-12 md:pb-16" />
      <CoreFeatures />
      <CtaBand
        title="Start a DDSO case through the portal Rx form"
        intro="All DDSO devices are Rx-only. Approved doctors send scans and Rx details through the Rx form in the account portal."
        primary={{ label: "Submit Digital Rx", to: "/submit-case" }}
        secondary={{ label: "Talk to the lab", to: "/contact" }}
      />
    </>
  );
}
