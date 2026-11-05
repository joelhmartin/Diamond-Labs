import { ClipboardCheck, Layers, Workflow } from "lucide-react";
import { ProductCatalog } from "../../components/marketing/ProductCatalog";
import { CatalogSection } from "../../components/marketing/CatalogSection";
import { PageHero } from "../../components/marketing/PageHero";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";
import LottiePlayer from "../../components/ui/LottiePlayer";

const TABS = [
  { key: "ddsoAnt", label: "DDSO — Anterior", sub: "Sleep Appliance" },
  { key: "ddsoPost", label: "DDSO — Posterior", sub: "Sleep Appliance" },
  { key: "ond", label: "OND", sub: "TMD Orthotic" },
  { key: "onp", label: "ONP", sub: "TMD Orthotic" },
];

const HIGHLIGHTS = [
  {
    Icon: ClipboardCheck,
    label: "Built to your prescription",
    desc: "Every appliance follows the clinical parameters on your Rx.",
  },
  {
    Icon: Workflow,
    label: "Digital-first workflow",
    desc: "Printed nylon appliances run from intraoral scan to 3D print, with each case archived so it can be reprinted without new records.",
  },
  {
    Icon: Layers,
    label: "Multiple materials",
    desc: "Nylon PA12, Bioflex and Trutaine, each case matched to the right material.",
  },
];

function Highlights() {
  return (
    <Reveal className="section-pad py-16 md:py-24">
      <div className="max-w-6xl mx-auto">
        <h2 className="max-w-2xl font-heading font-bold text-3xl md:text-5xl tracking-tight text-navy">
          What every case <span className="font-drama italic text-brand-700">comes with</span>
        </h2>
        <ul className="mt-10 grid md:grid-cols-3 gap-5">
          {HIGHLIGHTS.map(({ Icon, label, desc }) => (
            <li
              key={label}
              className="rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-8 hover:-translate-y-1 hover:shadow-xl hover:shadow-navy/10 transition-all duration-300"
            >
              <span className="grid place-items-center w-12 h-12 rounded-2xl bg-brand-100 text-brand-700">
                <Icon size={22} aria-hidden="true" />
              </span>
              <h3 className="mt-6 font-heading font-bold text-xl tracking-tight text-navy">{label}</h3>
              <p className="mt-3 text-navy/70 leading-relaxed">{desc}</p>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

export function ProductPage() {
  return (
    <>
      <PageHero
        variant="compact"
        title="Precision appliances"
        titleAccent="for every protocol."
        intro="TMD orthotics and sleep appliances, made to the prescription on your Rx."
        media={
          <LottiePlayer
            src="/animations/hero-lottie.json"
            className="w-full max-w-[420px] lg:max-w-none mx-auto aspect-[750/680] opacity-40"
          />
        }
      />
      <ProductCatalog
        tabs={TABS}
        ctaTo="/contact"
        ctaLabel="Request Information"
        notice={null}
        tone="bg-white"
        spacing="pt-12 md:pt-16 pb-16 md:pb-24"
      />
      <CatalogSection />
      <Highlights />
      <CtaBand
        title="Questions about our products?"
        intro="Our team can help you choose the right appliance and material for your patient."
        primary={{ label: "Contact the lab", to: "/contact" }}
        product="/images/ond-trutaine.webp"
        productAlt="OND orthotic in Trutaine on blue models"
      />
    </>
  );
}
