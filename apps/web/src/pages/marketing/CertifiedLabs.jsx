import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
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

function Standard() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-14">
        <div className="lg:col-span-2">
          <SectionHeading title="Integrating form with function" />
        </div>
        <div className="lg:col-span-3 space-y-5 text-navy/70 leading-relaxed">
          <p>
            TMJ &amp; Sleep Certified Labs share a commitment to excellence. Each lab has given their assurance that
            products made to the clinical protocol will meet the consistent high quality we all expect and demand for
            our patients.
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

function LabRow({ lab }) {
  return (
    <li className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_auto] gap-x-6 gap-y-1 py-4 items-baseline">
      <span className="font-heading font-bold text-navy">{lab.name}</span>
      <span className="text-sm text-navy/70">{lab.locator}</span>
      <span className="text-sm">
        {lab.href && (
          <a
            href={lab.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline"
          >
            {lab.display}
            <ExternalLink size={12} />
          </a>
        )}
      </span>
      <span className="text-sm font-mono text-navy/70">{lab.phone}</span>
    </li>
  );
}

function Directory() {
  return (
    <Reveal className="section-pad py-20 md:py-24 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Labs that stand ready to service your appliance needs" />
        <div className="mt-10 space-y-10">
          {REGIONS.map((r) => (
            <div key={r.label}>
              <h3 className="font-heading font-bold text-xl text-navy">{r.label}</h3>
              <ul className="mt-3 divide-y divide-navy/15 border-y border-navy/15">
                {r.labs.map((lab) => (
                  <LabRow key={lab.name} lab={lab} />
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
        variant="image"
        image="/images/ond-overview.webp"
        imageAlt="A Diamond-made nylon orthotic appliance"
        title="Certified laboratories"
        intro="Laboratories in the US, Canada and Australia are certified to make these appliances."
      />
      <Standard />
      <Directory />
      <CtaBand
        title="Need help with impressions or orthotic repairs?"
        intro="Call Diamond Orthotic Lab directly for training on taking quality impressions or performing simple orthotic repairs and relines. Save your practice time and money."
        primary={{ href: "tel:+16197246400", label: "Call 619.724.6400" }}
        secondary={{ to: "/contact", label: "Contact form" }}
      />
    </>
  );
}
