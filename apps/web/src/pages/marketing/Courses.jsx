import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { Reveal } from "../../components/marketing/Reveal";

const LEVELS = [
  {
    level: "Beginning",
    body: "Introduction to TMD and Dental Sleep Medicine protocols. The diagnostic framework, Olmos Series appliance overview, and clinical triage fundamentals.",
    audience: "New to TMD / OSA treatment",
  },
  {
    level: "Intermediate",
    body: "Comprehensive diagnosis, appliance selection criteria, phonetic bite registration, impression technique, and patient management systems.",
    audience: "Dentists building a TMJ practice",
  },
  {
    level: "Advanced",
    body: "Complex case management, integration with sleep medicine workflows, data-driven treatment outcomes, and advanced application of the clinical protocol.",
    audience: "Experienced practitioners",
  },
];

const FOCUS = [
  {
    title: "TMD Training",
    body: "Temporomandibular disorder diagnosis and the orthotic protocol, built around restoring function, not just managing symptoms.",
  },
  {
    title: "Dental Sleep Medicine",
    body: "Oral appliance therapy for obstructive sleep apnea and snoring. FDA-cleared device selection, titration, and long-term patient management.",
  },
  {
    title: "Integrated Care",
    body: "How dentistry connects to neurology, otolaryngology, and physical therapy in craniofacial pain treatment. This cross-disciplinary approach defines the centre model.",
  },
];

const LOCATIONS = [
  { label: "United States", note: "Multiple regional sessions annually" },
  { label: "Canada",        note: "Scheduled throughout the year" },
  { label: "Australia",     note: "Regional training sessions" },
];

function Intro() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-14">
        <div className="lg:col-span-2">
          <SectionHeading title="The program" />
        </div>
        <div className="lg:col-span-3 space-y-5 text-navy/70 leading-relaxed">
          <p>
            TMJ &amp; Sleep Therapy Centres International is recognized as a leader in continued education, training,
            and resources for the dental profession. The program delivers an integrated approach to care: in-depth
            diagnosis, the latest treatment technologies, patient management systems, integrated software, and
            training for every level of a dentist&apos;s practice.
          </p>
          <p>
            All education is directed by Dr. Steven R. Olmos, who has focused on helping patients overcome sleep
            breathing disorders, craniofacial pain, and TMD. His system for triage,
            diagnosis, and treatment is noted for providing successful treatment results, and is the driving force
            behind{" "}
            <Link to="/resources/certified-labs" className="text-brand-700 font-semibold hover:underline">
              60+ Centres across 7 countries
            </Link>
            .
          </p>
        </div>
      </div>
    </Reveal>
  );
}

function Levels() {
  return (
    <Reveal className="section-pad py-20 md:py-24 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Beginning, intermediate and advanced courses" />
        <dl className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-8">
          {LEVELS.map((l) => (
            <div key={l.level} className="border-t border-navy/15 pt-5">
              <dt className="font-heading font-bold text-2xl text-navy">{l.level}</dt>
              <dd className="mt-3 text-navy/70 leading-relaxed">{l.body}</dd>
              <dd className="mt-3 text-sm text-navy/70">
                <span className="font-semibold text-navy">Ideal for:</span> {l.audience}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Reveal>
  );
}

function Focus() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="What you'll study" />
        <dl className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-8">
          {FOCUS.map((f) => (
            <div key={f.title} className="border-t border-navy/15 pt-5">
              <dt className="font-heading font-bold text-lg text-navy">{f.title}</dt>
              <dd className="mt-2 text-navy/70 text-sm leading-relaxed">{f.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Reveal>
  );
}

function Locations() {
  return (
    <Reveal className="section-pad py-20 md:py-24 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Sessions held across three continents" />
        <ul className="mt-10 divide-y divide-navy/15 border-y border-navy/15">
          {LOCATIONS.map((l) => (
            <li key={l.label} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-8 py-4">
              <span className="sm:w-56 font-heading font-bold text-navy">{l.label}</span>
              <span className="text-navy/70">{l.note}</span>
            </li>
          ))}
        </ul>

        <div className="mt-10 bg-navy card-radius p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex-1">
            <h3 className="font-heading font-bold text-lg text-on-dark tracking-tight">Upcoming course calendar</h3>
            <p className="mt-1 text-on-dark/70 text-sm leading-relaxed">
              Dates and locations are scheduled throughout the year. For the current calendar, registration, and seat
              availability, contact the lab or visit TMJ &amp; Sleep Therapy Centres International directly.
            </p>
          </div>
          <a
            href="https://www.tmjtherapycentre.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors whitespace-nowrap"
          >
            TMJ &amp; Sleep Centres
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </Reveal>
  );
}

export function CoursesPage() {
  return (
    <>
      <PageHero
        variant="image"
        image="/images/onp-clear.webp"
        imageAlt="A blue Diamond-made orthotic appliance on its model"
        title="Courses for TMD and sleep dentistry"
        intro="Continued education from TMJ & Sleep Therapy Centres International, directed by Dr. Steven R. Olmos. Beginning, intermediate, and advanced training in TMD and dental sleep medicine."
      />
      <Intro />
      <Levels />
      <Focus />
      <Locations />
      <CtaBand
        title="Ready to expand your knowledge?"
        intro="Call the lab for current session dates, curriculum, and registration, or reach us through the contact form."
        primary={{ href: "tel:+16197246400", label: "Call 619.724.6400" }}
        secondary={{ to: "/contact", label: "Contact form" }}
      />
    </>
  );
}
