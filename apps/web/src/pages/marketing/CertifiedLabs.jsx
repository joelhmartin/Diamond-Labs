import { Link } from "react-router-dom";
import { ExternalLink, MapPin, Phone } from "lucide-react";
import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";

const REGIONS = [
  {
    label: "United States",
    labs: [
      {
        name: "Diamond Orthotic Laboratory International",
        locator: "La Mesa, California",
        href: "https://www.diamondorthoticlab.com",
        display: "diamondorthoticlab.com",
        phone: "619.724.6400",
      },
      {
        name: "John's Dental Laboratory",
        locator: "Terre Haute, Indiana",
        href: "https://www.johnsdental.com",
        display: "johnsdental.com",
      },
    ],
  },
  {
    label: "Canada",
    labs: [
      {
        name: "Orthodent",
        locator: "Canada",
        href: "https://www.orthodent.ca",
        display: "orthodent.ca",
      },
      {
        name: "Echlon Laboratory",
        locator: "Canada",
        phone: "877.505.5441",
      },
    ],
  },
  {
    label: "Australia",
    labs: [
      {
        name: "Airway Centric Orthotics",
        locator: "Australia",
        href: "https://www.airwaycentricorthotics.com",
        display: "airwaycentricorthotics.com",
      },
    ],
  },
];

function MapFeature() {
  return (
    <section className="section-pad relative z-10 -mt-10 md:-mt-16">
      <div className="max-w-6xl mx-auto rounded-[2.5rem] md:rounded-[3rem] bg-white border border-surface-300/60 shadow-2xl shadow-navy/15 p-5 md:p-10">
        <img
          src="/images/certified-labs-map.png"
          alt="World map with markers across the United States, Canada and Australia, where the certified laboratories are located"
          className="w-full h-auto rounded-[1.5rem]"
        />
        <ul className="mt-6 flex flex-wrap gap-3">
          {REGIONS.map((r) => (
            <li
              key={r.label}
              className="inline-flex items-center gap-2 rounded-full bg-brand-100 text-brand-700 px-4 py-2 text-sm font-semibold"
            >
              <MapPin size={16} aria-hidden="true" />
              {r.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Standard() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-14">
        <div className="lg:col-span-2">
          <SectionHeading title="How certification works" />
        </div>
        <div className="lg:col-span-3 space-y-5 text-navy/70 leading-relaxed">
          <p>
            Each TMJ &amp; Sleep Certified Lab has given its assurance that products made to the clinical protocol will
            meet a consistent quality standard.
          </p>
          <p>
            Continued training in the clinical protocol is provided to each certified laboratory and its technicians.
            Ongoing controls are in place to ensure quality as well as your satisfaction.
          </p>
          <p>
            The certified lab program is administered by <span className="text-navy font-semibold">Matt Rago</span>,
            Director of International Laboratory Certification, together with{" "}
            <Link to="/about/dr-olmos" className="text-brand-700 font-semibold hover:underline">
              Dr. Olmos
            </Link>
            . They are available for technical support questions from labs, doctors, and staff.
          </p>
        </div>
      </div>
    </Reveal>
  );
}

function LabCard({ lab }) {
  return (
    <li className="flex flex-col rounded-[2rem] bg-white/[0.07] border border-white/10 backdrop-blur-sm p-7 hover:bg-white/10 transition-colors duration-300">
      <h4 className="font-heading font-bold text-xl tracking-tight text-on-dark">{lab.name}</h4>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-on-dark/70">
        <MapPin size={14} aria-hidden="true" />
        {lab.locator}
      </p>
      <div className="mt-auto pt-6 space-y-2 text-sm">
        {lab.href && (
          <a
            href={lab.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 font-medium text-brand-300 hover:underline"
          >
            <ExternalLink size={14} aria-hidden="true" />
            {lab.display}
          </a>
        )}
        {lab.phone && (
          <a
            href={`tel:+1${lab.phone.replace(/\D/g, "")}`}
            className="flex items-center gap-2 font-mono text-on-dark/85 hover:underline"
          >
            <Phone size={14} aria-hidden="true" />
            {lab.phone}
          </a>
        )}
      </div>
    </li>
  );
}

function Directory() {
  return (
    <Reveal className="section-pad py-20 md:py-28 bg-navy">
      <div className="max-w-6xl mx-auto">
        <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-on-dark">
          Find a <span className="font-drama italic text-brand-500">certified lab</span>
        </h2>
        <div className="mt-12 space-y-12">
          {REGIONS.map((r) => (
            <div key={r.label}>
              <h3 className="font-heading font-bold text-xl text-brand-300">{r.label}</h3>
              <ul className="mt-4 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                {r.labs.map((lab) => (
                  <LabCard key={lab.name} lab={lab} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

export function CertifiedLabsPage() {
  return (
    <>
      <PageHero
        title="Certified laboratories"
        titleAccent="in three countries."
        intro="Laboratories in the US, Canada and Australia are certified to fabricate Olmos Series appliances."
        product="/images/ddso-ant-angle.webp"
        productAlt="A DDSO sleep appliance"
      />
      <MapFeature />
      <Standard />
      <Directory />
      <CtaBand
        title="Need help with impressions or orthotic repairs?"
        intro="Call Diamond Orthotic Lab directly for training on taking quality impressions or performing simple orthotic repairs and relines. Save your practice time and money."
        primary={{ href: "tel:+16197246400", label: "Call 619.724.6400" }}
        secondary={{ to: "/contact", label: "Contact form" }}
        product="/images/onp-clear.webp"
        productAlt="An Olmos Neuromuscular Positioner appliance"
      />
    </>
  );
}
