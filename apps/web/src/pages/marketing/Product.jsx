import { useState } from "react";
import { PRODUCTS } from "../../data/products";
import { ProductViewer } from "../../components/marketing/ProductViewer";
import { CatalogSection } from "../../components/marketing/CatalogSection";
import { PageHero } from "../../components/marketing/PageHero";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";

const TABS = [
  { key: "ddsoAnt", label: "DDSO — Anterior", sub: "Sleep Appliance" },
  { key: "ddsoPost", label: "DDSO — Posterior", sub: "Sleep Appliance" },
  { key: "ond", label: "OND", sub: "TMD Orthotic" },
  { key: "onp", label: "ONP", sub: "TMD Orthotic" },
];

const HIGHLIGHTS = [
  {
    label: "Built to your prescription",
    desc: "Every appliance follows the clinical parameters on your Rx.",
  },
  {
    label: "Digital-first workflow",
    desc: "From intraoral scan to 3D print, with every case archived so it can be reprinted without new records.",
  },
  {
    label: "Multiple materials",
    desc: "Nylon PA12, Bioflex and Trutaine, each case matched to the right material.",
  },
];

function ProductTabs() {
  const [activeProduct, setActiveProduct] = useState("ddsoAnt");

  return (
    <Reveal className="section-pad pt-12 pb-16 md:pt-16 md:pb-24">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center gap-2 mb-8">
          {TABS.map(({ key, label, sub }) => (
            <button
              key={key}
              onClick={() => setActiveProduct(key)}
              className={`px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${
                activeProduct === key
                  ? "bg-brand-500 text-white"
                  : "bg-surface-200/60 text-navy/70 hover:text-navy hover:bg-surface-300/60"
              }`}
            >
              {label}
              <span className="hidden sm:inline text-xs opacity-70"> · {sub}</span>
            </button>
          ))}
        </div>

        <ProductViewer key={activeProduct} product={PRODUCTS[activeProduct]} />
      </div>
    </Reveal>
  );
}

function Highlights() {
  return (
    <Reveal className="section-pad py-16 md:py-24">
      <dl className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-8">
        {HIGHLIGHTS.map((h) => (
          <div key={h.label} className="border-t border-navy/15 pt-5">
            <dt className="font-heading font-bold text-lg text-navy">{h.label}</dt>
            <dd className="mt-2 text-navy/70 text-sm leading-relaxed">{h.desc}</dd>
          </div>
        ))}
      </dl>
    </Reveal>
  );
}

export function ProductPage() {
  return (
    <>
      <PageHero
        variant="compact"
        title="Precision appliances for"
        titleAccent="every protocol."
        intro="TMD orthotics and sleep appliances, 3D printed in nylon to the prescription on your Rx."
      />
      <ProductTabs />
      <CatalogSection />
      <Highlights />
      <CtaBand
        title="Questions about our products?"
        intro="Our team can help you choose the right appliance and material for your patient."
        primary={{ label: "Contact the lab", to: "/contact" }}
      />
    </>
  );
}
