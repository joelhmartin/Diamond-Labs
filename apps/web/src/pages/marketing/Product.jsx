import { ProductCatalog } from "../../components/marketing/ProductCatalog";
import { CatalogSection } from "../../components/marketing/CatalogSection";
import { PageHero } from "../../components/marketing/PageHero";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";
import { DefinitionGrid } from "../../components/marketing/DefinitionGrid";

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

function Highlights() {
  return (
    <Reveal className="section-pad py-16 md:py-24">
      <div className="max-w-6xl mx-auto">
        <DefinitionGrid className="" items={HIGHLIGHTS.map((h) => ({ term: h.label, body: h.desc }))} />
      </div>
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
        intro="TMD orthotics and sleep appliances, made to the prescription on your Rx."
      />
      <ProductCatalog
        tabs={TABS}
        ctaTo="/contact"
        ctaLabel="Request Information"
        notice={null}
        spacing="pt-12 md:pt-16 pb-16 md:pb-24"
      />
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
