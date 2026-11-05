import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { StatRow } from "../../components/marketing/StatRow";
import { Reveal } from "../../components/marketing/Reveal";
import { HeroStage } from "../../components/marketing/HeroStage";

const GROUPS = [
  { label: "Leadership", tone: "bg-navy", people: [{ name: "Matt Rago", role: "Director of Operations" }] },
  {
    label: "Digital engineering",
    tone: "bg-brand-700",
    people: [
      { name: "Franco Di Paolo", role: "Lead Digital Engineer" },
      { name: "James Albrecht", role: "Digital Engineering" },
    ],
  },
  {
    label: "Dental technicians",
    tone: "bg-navy-dark",
    people: [
      { name: "David Leonard", role: "Lead Dental Technician" },
      { name: "John Olmos", role: "Dental / Digital Technician" },
      { name: "Adam Walnus", role: "Dental Technician" },
      { name: "Elmer Onofre", role: "Dental Technician" },
      { name: "Edgar Aguillar", role: "Dental Technician" },
      { name: "Austin Knutson", role: "Dental Technician" },
      { name: "Inho Ko", role: "Dental Technician" },
      { name: "Crosby Hessel", role: "Dental Technician" },
      { name: "Jose Martinez", role: "Dental Technician" },
      { name: "Ivan Sanchez", role: "Dental Technician" },
      { name: "John Bernel", role: "Dental Technician" },
    ],
  },
  {
    label: "Quality and compliance",
    tone: "bg-accent-600",
    people: [
      { name: "Barbara Rago", role: "RN, MSN — Compliance & Regulations" },
      { name: "Jay Tuyay", role: "Case Quality Assurance" },
    ],
  },
  {
    label: "Operations and logistics",
    tone: "bg-brand-600",
    people: [
      { name: "Tracy Adams", role: "Products / Procurement Coordinator" },
      { name: "Sammy Mitchell", role: "Communication Logistics Coordinator" },
      { name: "Krystee Rago", role: "Operations" },
    ],
  },
];

const byLabel = (label) => GROUPS.find((g) => g.label === label).people;

// Every figure is read from the lists above so the counts cannot drift.
const STATS = [
  { value: String(GROUPS.reduce((n, g) => n + g.people.length, 0)), label: "People on the team" },
  { value: String(byLabel("Dental technicians").length), label: "Dental technicians" },
  { value: String(byLabel("Digital engineering").length), label: "Digital engineers" },
];

// First letters of the first and last name; "RN, MSN" style suffixes live in the role, not the name.
const initials = (name) => name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("");

function Group({ label, tone, people }) {
  return (
    <div className="mt-12 first:mt-10">
      <h3 className="font-heading font-bold text-2xl tracking-tight text-navy">{label}</h3>
      <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {people.map((p) => (
          <li
            key={p.name}
            className="flex items-center gap-4 rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-5 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-navy/10 transition-all duration-300"
          >
            <span
              aria-hidden="true"
              className={`grid flex-shrink-0 place-items-center w-14 h-14 rounded-full font-heading font-bold text-lg text-white ${tone}`}
            >
              {initials(p.name)}
            </span>
            <div className="min-w-0">
              <span className="block font-semibold text-navy">{p.name}</span>
              <span className="block text-sm text-navy/70 leading-snug">{p.role}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TeamPage() {
  return (
    <>
      <PageHero
        title="Meet the"
        titleAccent="Diamond team."
        intro="Dental technicians, digital engineers and clinical specialists. Every case passes through their hands."
        product="/images/ond-trutaine.webp"
        productAlt="An OND appliance on upper and lower blue dental models"
      />
      <Reveal className="section-pad py-20 md:py-24">
        <div className="max-w-6xl mx-auto">
          <SectionHeading title="Who does what" />
          {GROUPS.map((g) => (
            <Group key={g.label} {...g} />
          ))}
        </div>
      </Reveal>
      <Reveal className="relative overflow-hidden bg-navy section-pad py-20 md:py-24">
        <HeroStage />
        <div className="relative z-10 max-w-6xl mx-auto">
          <StatRow stats={STATS} tone="dark" />
        </div>
      </Reveal>
      <CtaBand
        title="Talk to the lab"
        intro="Questions about a case or an appliance go straight to the people who make it."
        primary={{ label: "Contact the lab", to: "/contact" }}
        secondary={{ label: "About the lab", to: "/about" }}
        product="/images/onp-bioflex-new.webp"
        productAlt="An ONP appliance"
      />
    </>
  );
}
