import { Brain, ExternalLink, Globe2, MapPin, Moon, Network } from "lucide-react";
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
    Icon: Brain,
    title: "TMD Training",
    body: "Temporomandibular disorder diagnosis and the orthotic protocol, built around restoring function, not just managing symptoms.",
  },
  {
    Icon: Moon,
    title: "Dental Sleep Medicine",
    body: "Oral appliance therapy for obstructive sleep apnea and snoring. FDA-cleared device selection, titration, and long-term patient management.",
  },
  {
    Icon: Network,
    title: "Integrated Care",
    body: "How dentistry connects to neurology, otolaryngology, and physical therapy in craniofacial pain treatment. This cross-disciplinary approach defines the centre model.",
  },
];

const LOCATIONS = [
  { label: "United States", note: "Multiple regional sessions annually" },
  { label: "Canada",        note: "Scheduled throughout the year" },
  { label: "Australia",     note: "Regional training sessions" },
];

const TMJ_LINK = "https://tmjtherapycentre.com";

function Intro() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
        <div>
          <SectionHeading title="The program" />
          <div className="mt-6 space-y-5 text-navy/70 leading-relaxed">
            <p>
              TMJ &amp; Sleep Therapy Centres International provides continued education, training, and resources
              for the dental profession. The program covers an integrated approach to care: in-depth
              diagnosis, the latest treatment technologies, patient management systems, integrated software, and
              training for every level of a dentist&apos;s practice.
            </p>
            <p>
              All education is directed by Dr. Steven R. Olmos, who has focused on sleep breathing disorders,
              craniofacial pain, and TMD. He founded{" "}
              <a
                href={TMJ_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-700 font-semibold hover:underline"
              >
                TMJ &amp; Sleep Therapy Centres International
              </a>
              , and he directs the courses.
            </p>
          </div>
        </div>
        <img
          src="/images/onp-rear.webp"
          alt="An Olmos appliance on a blue printed dental model, rear view"
          className="w-full rounded-[2.5rem] object-cover shadow-xl shadow-navy/15"
        />
      </div>
    </Reveal>
  );
}

function Levels() {
  return (
    <Reveal className="section-pad py-20 md:py-24 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Beginning, intermediate and advanced courses" />
        <ol className="mt-10 grid md:grid-cols-3 gap-5">
          {LEVELS.map((l, i) => (
            <li
              key={l.level}
              className="flex flex-col rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-7 hover:shadow-xl hover:shadow-navy/10 hover:-translate-y-1 transition-all duration-300"
            >
              <span aria-hidden="true" className="font-drama italic text-6xl leading-none text-brand-700">
                {i + 1}
              </span>
              <h3 className="mt-5 font-heading font-bold text-2xl tracking-tight text-navy">{l.level}</h3>
              <p className="mt-3 text-navy/70 leading-relaxed">{l.body}</p>
              <p className="mt-auto pt-6 text-sm text-navy/70">
                <span className="inline-block rounded-full bg-brand-100 text-brand-700 px-3 py-1 font-semibold mr-2">
                  Ideal for
                </span>
                {l.audience}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </Reveal>
  );
}

function Focus() {
  return (
    <Reveal className="section-pad py-20 md:py-28 bg-navy">
      <div className="max-w-6xl mx-auto">
        <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-on-dark">
          What you&apos;ll <span className="font-drama italic text-brand-500">study</span>
        </h2>
        <ul className="mt-12 grid md:grid-cols-3 gap-5">
          {FOCUS.map(({ Icon, title, body }) => (
            <li key={title} className="rounded-[2rem] bg-white/[0.07] border border-white/10 backdrop-blur-sm p-7">
              <span className="grid place-items-center w-12 h-12 rounded-2xl bg-white/10 text-brand-300">
                <Icon size={22} aria-hidden="true" />
              </span>
              <h3 className="mt-5 font-heading font-bold text-xl tracking-tight text-on-dark">{title}</h3>
              <p className="mt-3 text-on-dark/75 leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

function Locations() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto">
        <SectionHeading title="Sessions held in three countries" />
        <ul className="mt-10 grid md:grid-cols-3 gap-5">
          {LOCATIONS.map((l) => (
            <li key={l.label} className="rounded-[2rem] bg-white border border-surface-300/60 shadow-sm p-7">
              <span className="grid place-items-center w-12 h-12 rounded-2xl bg-brand-100 text-brand-700">
                <MapPin size={22} aria-hidden="true" />
              </span>
              <h3 className="mt-5 font-heading font-bold text-xl tracking-tight text-navy">{l.label}</h3>
              <p className="mt-2 text-navy/70">{l.note}</p>
            </li>
          ))}
        </ul>

        <div className="mt-8 rounded-[2.5rem] bg-brand-100 p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-6">
          <span className="hidden md:grid flex-shrink-0 place-items-center w-14 h-14 rounded-2xl bg-white text-brand-700">
            <Globe2 size={26} aria-hidden="true" />
          </span>
          <div className="flex-1">
            <h3 className="font-heading font-bold text-xl text-navy tracking-tight">Upcoming course calendar</h3>
            <p className="mt-1 text-navy/70 text-sm leading-relaxed">
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
        variant="compact"
        title="Courses for TMD"
        titleAccent="and sleep dentistry."
        intro="Continued education from TMJ & Sleep Therapy Centres International, directed by Dr. Steven R. Olmos. Beginning, intermediate, and advanced training in TMD and dental sleep medicine."
        product="/images/ond-nylon.webp"
        productAlt="An Olmos Neuromuscular Device appliance"
      />
      <Intro />
      <Levels />
      <Focus />
      <Locations />
      <CtaBand
        title="Call for upcoming course dates"
        intro="Call the lab for current session dates, curriculum, and registration, or reach us through the contact form."
        primary={{ href: "tel:+16197246400", label: "Call 619.724.6400" }}
        secondary={{ to: "/contact", label: "Contact form" }}
        product="/images/ddso-ant-pair.webp"
        productAlt="A pair of DDSO sleep appliances"
      />
    </>
  );
}
