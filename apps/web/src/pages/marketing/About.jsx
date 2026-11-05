import { Link } from "react-router-dom";
import { ArrowRight, Award, HeartHandshake, Crosshair, Zap } from "lucide-react";
import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";
import { HeroStage } from "../../components/marketing/HeroStage";

const VALUES = [
  {
    Icon: Award,
    title: "Quality",
    desc: "Every appliance meets exacting standards. Printed precision verified through multi-point dimensional analysis before it leaves our lab.",
  },
  {
    Icon: HeartHandshake,
    title: "Commitment",
    desc: "We're invested in outcomes, not just orders. Direct communication with your dedicated technician on every case.",
  },
  {
    Icon: Crosshair,
    title: "Accuracy",
    desc: "Full digital workflow from scan to delivery. CAD articulation eliminates the cumulative errors of analog processes.",
  },
  {
    Icon: Zap,
    title: "Efficiency",
    desc: "Fast turnaround without cutting corners. Digital-first means fewer remakes, fewer adjustments, and faster chair time.",
  },
];

const SHOWCASE = [
  { name: "DDSO Anterior", full: "Diamond Digital Sleep Orthotic, anterior contact design", image: "/images/ddso-ant-angle.webp", alt: "DDSO anterior sleep appliance on a dark dental model" },
  { name: "DDSO Posterior", full: "Diamond Digital Sleep Orthotic, full-arch posterior design", image: "/images/ddso-post-iso.webp", alt: "DDSO posterior sleep appliance with a nylon band" },
  { name: "OND", full: "Olmos Neuromuscular Device", image: "/images/ond-overview.webp", alt: "Olmos Neuromuscular Device on upper and lower models" },
  { name: "ONP", full: "Olmos Neuromuscular Positioner", image: "/images/onp-nylon4.webp", alt: "Olmos Neuromuscular Positioner on upper and lower models" },
];

const textLink = "inline-flex items-center gap-2 font-semibold text-brand-700 hover:underline";

function Mission() {
  return (
    <Reveal className="section-pad py-16 md:py-20">
      <div className="relative overflow-hidden max-w-6xl mx-auto rounded-[2.5rem] md:rounded-[3rem] bg-navy">
        <HeroStage />
        <div className="relative z-10 px-8 py-16 md:px-16 md:py-24">
          <span className="font-mono text-xs uppercase tracking-widest text-on-dark/70">Our mission</span>
          <h2 className="mt-5 max-w-4xl font-drama italic text-3xl sm:text-4xl md:text-6xl leading-[1.1] tracking-tight text-on-dark">
            To advance the treatment of <span className="text-brand-400">TMJ</span> and{" "}
            <span className="text-brand-400">sleep breathing disorders</span> through precision digital manufacturing.
          </h2>
        </div>
      </div>
    </Reveal>
  );
}

function Values() {
  return (
    <Reveal className="section-pad pb-20 md:pb-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="What drives every case" />
        <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {VALUES.map(({ Icon, title, desc }) => (
            <li key={title} className="rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-7">
              <span className="grid place-items-center w-12 h-12 rounded-2xl bg-brand-100 text-brand-700">
                <Icon size={22} aria-hidden="true" />
              </span>
              <h3 className="mt-5 font-heading font-bold text-xl tracking-tight text-navy">{title}</h3>
              <p className="mt-2 text-navy/70 text-sm leading-relaxed">{desc}</p>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

function ImagingTechnology() {
  return (
    <Reveal className="relative overflow-hidden bg-navy section-pad py-20 md:py-28">
      <HeroStage />
      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="max-w-2xl">
          <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-on-dark">3D imaging technology</h2>
          <p className="mt-4 text-on-dark/75 text-lg leading-relaxed">
            Digital cases begin as a high-resolution model, captured intraorally, articulated in CAD and checked surface by
            surface before fabrication. Printed appliances are made in nylon.
          </p>
          <Link to="/services/digital-workflow" className="mt-6 inline-flex items-center gap-2 font-semibold text-brand-400 hover:underline">
            See the digital workflow <ArrowRight size={16} />
          </Link>
        </div>
        <ul className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-5">
          {SHOWCASE.map((a) => (
            <li key={a.name}>
              <Link
                to="/products"
                className="group flex h-full flex-col rounded-[2rem] bg-white/[0.07] border border-white/10 backdrop-blur-sm p-6 md:p-8 transition-colors duration-300 hover:bg-white/[0.12]"
              >
                <img
                  src={a.image}
                  alt={a.alt}
                  loading="lazy"
                  className="h-56 md:h-72 w-full object-contain drop-shadow-[0_24px_40px_rgba(0,20,60,0.45)] transition-transform duration-500 group-hover:scale-105"
                />
                <span className="mt-6 font-heading font-bold text-2xl tracking-tight text-on-dark">{a.name}</span>
                <span className="mt-1 flex items-center justify-between gap-3 text-sm text-on-dark/70">
                  {a.full}
                  <ArrowRight size={16} className="flex-shrink-0 text-brand-400 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

function CertifiedLabs() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto overflow-hidden rounded-[2.5rem] md:rounded-[3rem] bg-brand-100 border border-brand-200/60 shadow-sm">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center p-8 md:p-14">
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
            className="w-full h-auto rounded-3xl bg-white p-3 shadow-lg shadow-navy/10"
            loading="lazy"
          />
        </div>
      </div>
    </Reveal>
  );
}

export function AboutPage() {
  return (
    <>
      <PageHero
        title="About Diamond"
        titleAccent="Orthotic Laboratory."
        intro="A dental laboratory in La Mesa, California, making TMJ and sleep breathing appliances for dentists on a fully digital workflow."
        product="/images/ddso-nylon-bands.webp"
        productAlt="A DDSO sleep appliance with nylon bands"
      />
      <Mission />
      <Values />
      <ImagingTechnology />
      <CertifiedLabs />
      <CtaBand
        title="Work with the lab"
        intro="Ask about an appliance, a case in progress or setting up an account."
        primary={{ label: "Contact the lab", to: "/contact" }}
        product="/images/ddso-ant-pair.webp"
        productAlt="A DDSO anterior appliance, upper and lower"
      />
    </>
  );
}
