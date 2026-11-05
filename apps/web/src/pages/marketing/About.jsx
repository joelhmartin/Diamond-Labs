import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { ModelViewer } from "../../components/ModelViewer";
import { PRODUCTS } from "../../data/products";
import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";

const VALUES = [
  {
    title: "Quality",
    desc: "Every appliance meets exacting standards. 3D-printed precision verified through multi-point dimensional analysis before it leaves our lab.",
  },
  {
    title: "Commitment",
    desc: "We're invested in outcomes, not just orders. Direct communication with your dedicated technician on every case.",
  },
  {
    title: "Accuracy",
    desc: "Full digital workflow from scan to delivery. CAD articulation eliminates the cumulative errors of analog processes.",
  },
  {
    title: "Efficiency",
    desc: "Fast turnaround without cutting corners. Digital-first means fewer remakes, fewer adjustments, and faster chair time.",
  },
];

const textLink = "inline-flex items-center gap-2 font-semibold text-brand-700 hover:underline";

function Mission() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading
          title="Our mission"
          intro="To advance the treatment of TMJ and sleep breathing disorders through precision digital manufacturing."
        />
      </div>
    </Reveal>
  );
}

function Values() {
  return (
    <Reveal className="section-pad pb-20 md:pb-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="What drives every case" />
        <dl className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
          {VALUES.map((v) => (
            <div key={v.title} className="border-t border-navy/15 pt-5">
              <dt className="font-heading font-bold text-lg text-navy">{v.title}</dt>
              <dd className="mt-2 text-navy/70 text-sm leading-relaxed">{v.desc}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Reveal>
  );
}

function ImagingTechnology() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading
          title="3D imaging technology"
          intro="Every Diamond appliance begins as a high-resolution digital model, captured intraorally, articulated in CAD and checked surface by surface before it is printed in nylon."
        />
        <Link to="/services/digital-workflow" className={`mt-6 ${textLink}`}>
          See the digital workflow <ArrowRight size={16} />
        </Link>

        {/* Product reel: auto-rotating 3D models, no interaction */}
        <div className="mt-10 w-full rounded-[2rem] overflow-hidden bg-white border border-surface-300/50 px-4 py-8 md:py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
            {Object.values(PRODUCTS).map((p) => {
              const model = p.images.find((i) => i.is3D);
              if (!model) return null;
              return (
                <div key={p.fullName} className="flex flex-col items-center">
                  <div className="w-full aspect-square">
                    <ModelViewer
                      objPath={model.objPath}
                      mtlPath={model.mtlPath}
                      interactive={false}
                      className="w-full h-full"
                    />
                  </div>
                  <div className="mt-2 text-center">
                    <div className="font-heading font-bold text-sm text-navy">{p.name}</div>
                    <div className="text-xs text-navy/70">{p.category}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function CertifiedLabs() {
  return (
    <Reveal className="section-pad py-16 md:py-20">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white card-radius-lg p-8 md:p-12 border border-surface-300/50 shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            <div>
              <SectionHeading
                title="Part of the certified lab network"
                intro="Diamond Orthotic Laboratory is one of the laboratories in the US, Canada and Australia certified to fabricate Olmos Series appliances."
              />
              <Link to="/resources/certified-labs" className={`mt-6 ${textLink}`}>
                See the certified labs <ArrowRight size={16} />
              </Link>
            </div>
            <img
              src="/images/certified-labs-map.png"
              alt="World map showing the locations of the certified labs"
              className="w-full h-auto rounded-2xl"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function DrOlmosFeature() {
  return (
    <Reveal className="section-pad py-16 md:py-20">
      <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_2fr] lg:grid-cols-[minmax(0,1fr)_3fr] gap-8 items-center">
        <img
          src="/images/dr-olmos.jpg"
          alt="Dr. Steven Olmos"
          className="w-full max-w-[16rem] sm:max-w-none rounded-3xl object-cover aspect-square"
          width="900"
          height="900"
          loading="lazy"
        />
        <div className="max-w-xl">
          <p className="text-navy/70 text-lg leading-relaxed">
            We work with Dr. Steven Olmos, creator of the Olmos Series appliances and founder of TMJ &amp; Sleep
            Therapy Centres International.
          </p>
          <Link to="/about/dr-olmos" className={`mt-4 ${textLink}`}>
            About Dr. Olmos <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </Reveal>
  );
}

export function AboutPage() {
  return (
    <>
      <PageHero
        variant="image"
        title="About Diamond"
        titleAccent="Orthotic Laboratory."
        intro="A dental laboratory in La Mesa, California, making TMJ and sleep breathing appliances for dentists on a fully digital workflow."
        image="/images/about-hero.webp"
        imageAlt="A blue and white 3D-printed orthotic appliance on a stainless steel bench in the Diamond lab"
      />
      <Mission />
      <Values />
      <ImagingTechnology />
      <CertifiedLabs />
      <DrOlmosFeature />
      <CtaBand
        title="Work with the lab"
        intro="Ask about an appliance, a case in progress or setting up an account."
        primary={{ label: "Contact the lab", to: "/contact" }}
      />
    </>
  );
}
