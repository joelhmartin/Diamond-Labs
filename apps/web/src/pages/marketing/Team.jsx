import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { StatRow } from "../../components/marketing/StatRow";
import { Reveal } from "../../components/marketing/Reveal";

const GROUPS = [
  { label: "Leadership", people: [{ name: "Matt Rago", role: "Director of Operations" }] },
  {
    label: "Digital engineering",
    people: [
      { name: "Franco Di Paolo", role: "Lead Digital Engineer" },
      { name: "James Albrecht", role: "Digital Engineering" },
    ],
  },
  {
    label: "Dental technicians",
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
    people: [
      { name: "Barbara Rago", role: "RN, MSN — Compliance & Regulations" },
      { name: "Jay Tuyay", role: "Case Quality Assurance" },
    ],
  },
  {
    label: "Operations and logistics",
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
  { value: "1", label: "Lab, in La Mesa, California" },
];

function Group({ label, people }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[14rem_1fr] gap-4 md:gap-10 py-8 border-t border-navy/15">
      <h3 className="font-heading font-bold text-lg text-navy">{label}</h3>
      <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-10">
        {people.map((p) => (
          <li key={p.name} className="py-2.5 border-b border-navy/10 last:border-b-0 lg:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
            <span className="font-semibold text-navy">{p.name}</span>
            <span className="block text-sm text-navy/70">{p.role}</span>
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
        variant="image"
        title="Meet the"
        titleAccent="Diamond team."
        intro="Dental technicians, digital engineers and clinical specialists. Every case passes through their hands."
        image="/images/ddso-full.webp"
        imageAlt="A blue and white orthotic appliance on a stainless steel bench in the Diamond lab, with an articulator beside it"
      />
      <Reveal className="section-pad py-16 md:py-20">
        <div className="max-w-6xl mx-auto">
          <StatRow stats={STATS} />
        </div>
      </Reveal>
      <Reveal className="section-pad pb-20 md:pb-24">
        <div className="max-w-6xl mx-auto">
          <SectionHeading title="Who does what" />
          <div className="mt-10">
            {GROUPS.map((g) => (
              <Group key={g.label} {...g} />
            ))}
          </div>
        </div>
      </Reveal>
      <CtaBand
        title="Talk to the lab"
        intro="Questions about a case or an appliance go straight to the people who make it."
        primary={{ label: "Contact the lab", to: "/contact" }}
        secondary={{ label: "About the lab", to: "/about" }}
      />
    </>
  );
}
