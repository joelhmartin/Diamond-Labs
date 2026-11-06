import { PageHero } from "../../components/marketing/PageHero";
import { SectionHeading } from "../../components/marketing/SectionHeading";
import { CtaBand } from "../../components/marketing/CtaBand";
import { StatRow } from "../../components/marketing/StatRow";
import { Reveal } from "../../components/marketing/Reveal";
import { HeroStage } from "../../components/marketing/HeroStage";
import { Award } from "lucide-react";

const CREDENTIALS = [
  { abbr: "DDS", label: "Doctor of Dental Surgery — USC School of Dentistry" },
  { abbr: "DABCP", label: "Diplomate, American Board of Craniofacial Pain" },
  { abbr: "DABCDSM", label: "Diplomate, American Board of Craniofacial Dental Sleep Medicine" },
  { abbr: "DABDSM", label: "Diplomate, American Board of Dental Sleep Medicine" },
  { abbr: "DAIPM", label: "Diplomate, Academy of Integrative Pain Management" },
  { abbr: "FAAOP", label: "Fellow, American Academy of Orofacial Pain" },
  { abbr: "FAACP", label: "Fellow, American Academy of Craniofacial Pain" },
  { abbr: "FICCMO", label: "Fellow, International College of Cranio-Mandibular Orthopedics" },
  { abbr: "FADI", label: "Fellow, Academy of Dentistry International" },
  { abbr: "FIAO", label: "Fellow, International Association of Orthodontics" },
  { abbr: "FACD", label: "Fellow, American College of Dentists" },
];

const FOCUS_AREAS = [
  {
    title: "Craniofacial pain",
    copy: "Diagnosis and non-surgical treatment of chronic and acute orofacial pain, integrating dentistry, neurology and physical therapy.",
  },
  {
    title: "TMD research",
    copy: "Board certified by the American Board of Craniofacial Pain, with protocols for temporomandibular disorder diagnosis and orthotic therapy.",
  },
  {
    title: "Dental sleep medicine",
    copy: "Board certified in sleep-related breathing disorders; directs clinical research and education programs for dentists treating OSA.",
  },
];

const NETWORK_STATS = [
  { value: "60+", label: "Centres" },
  { value: "7", label: "Countries" },
];

function Biography() {
  return (
    <Reveal className="section-pad py-20 md:py-24">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-14 items-start">
        <figure className="lg:col-span-2">
          <div className="rounded-[2.5rem] overflow-hidden shadow-xl shadow-navy/15">
            <img
              src="/images/dr-olmos-working.jpg"
              alt="Dr. Steven Olmos demonstrating a palpation examination during a training course"
              className="w-full h-auto object-cover"
              width="1080"
              height="565"
              loading="lazy"
            />
          </div>
          <figcaption className="mt-3 text-sm text-navy/70">
            Teaching at a TMJ &amp; Sleep Therapy Centres course
          </figcaption>
        </figure>
        <div className="lg:col-span-3">
          <SectionHeading title="Biography" />
          <div className="mt-6 space-y-5 text-navy/70 leading-relaxed">
            <p>
              Dr. Steven Olmos has been in private practice for more than{" "}
              <span className="text-navy font-semibold">35 years</span>, with the last{" "}
              <span className="text-navy font-semibold">30 years</span> devoted to research and treatment of
              craniofacial pain, temporomandibular disorder (TMD), and sleep-disordered breathing.
            </p>
            <p>
              He obtained his DDS from the University of Southern California School of Dentistry and is Board
              Certified in both Chronic Pain and Sleep Related Breathing Disorders by the American Board of
              Craniofacial Pain, the Academy of Integrative Pain Management, the American Board of Dental Sleep
              Medicine, and the American Board of Craniofacial Pain and Dental Sleep Medicine.
            </p>
            <p>
              Dr. Olmos is the founder of{" "}
              <span className="text-navy font-semibold">TMJ &amp; Sleep Therapy Centres International</span>, with
              over 60 centres in 7 countries dedicated exclusively to the diagnosis and treatment of craniofacial
              pain and sleep disorders. He currently directs research in these fields through data collection,
              focused on establishing protocols between dentistry and medicine for optimal treatment outcomes.
            </p>
          </div>
          <blockquote className="mt-8 rounded-[2rem] bg-brand-100 border-l-4 border-brand-700 p-6 font-drama italic text-2xl leading-snug text-navy">
            &ldquo;The more precise and accurate your diagnosis, the more specific and effective will be the
            treatment.&rdquo;
          </blockquote>
        </div>
      </div>
    </Reveal>
  );
}

function Credentials() {
  return (
    <Reveal className="section-pad pb-20 md:pb-24">
      <div className="max-w-6xl mx-auto rounded-[2.5rem] bg-white border border-surface-300/60 shadow-sm p-8 md:p-12">
        <div className="flex items-center gap-4">
          <span className="grid place-items-center w-12 h-12 rounded-2xl bg-brand-100 text-brand-700">
            <Award size={22} aria-hidden="true" />
          </span>
          <h2 className="font-heading font-bold text-2xl md:text-4xl tracking-tight text-navy">
            Board certifications and fellowships
          </h2>
        </div>
        <ul className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3">
          {CREDENTIALS.map((c) => (
            <li key={c.abbr} className="flex items-start gap-4 rounded-2xl bg-surface-100 p-4">
              <span className="flex-shrink-0 min-w-[4.5rem] rounded-full bg-navy px-3 py-1 text-center font-heading font-bold text-sm text-white">
                {c.abbr}
              </span>
              <span className="text-navy/70 text-sm leading-snug">{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

function Network() {
  return (
    <Reveal className="relative overflow-hidden bg-navy section-pad py-20 md:py-24">
      <HeroStage />
      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="max-w-2xl">
          <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-on-dark">
            TMJ &amp; Sleep Therapy Centres International
          </h2>
          <p className="mt-4 text-on-dark/70 text-lg leading-relaxed">
            The network Dr. Olmos founded spans the US, Canada, Australia and four additional countries. Each
            centre is dedicated to the diagnosis and treatment of craniofacial pain and sleep-disordered
            breathing.
          </p>
        </div>
        <div className="mt-10">
          <StatRow stats={NETWORK_STATS} tone="dark" />
        </div>
        <ul className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          {FOCUS_AREAS.map((f) => (
            <li key={f.title} className="rounded-[2rem] bg-white/[0.07] border border-white/10 backdrop-blur-sm p-6">
              <h3 className="font-heading font-bold text-lg text-on-dark">{f.title}</h3>
              <p className="mt-2 text-on-dark/70 text-sm leading-relaxed">{f.copy}</p>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

export function DrOlmosPage() {
  return (
    <>
      <PageHero
        title="Dr. Steven Olmos, DDS"
        titleAccent="Craniofacial pain and sleep."
        intro="Founder of TMJ & Sleep Therapy Centres International. 35+ years in private practice, 30+ years devoted to research and treatment of craniofacial pain, TMD and sleep-disordered breathing."
      />
      <Biography />
      <Credentials />
      <Network />
      <CtaBand
        title="Training and courses"
        intro="Dr. Olmos directs the courses for dentists. The certified labs fabricate Olmos Series appliances."
        primary={{ label: "Courses", to: "/resources/courses" }}
        secondary={{ label: "Certified labs", to: "/resources/certified-labs" }}
        product="/images/ddso-post-iso.webp"
        productAlt="A DDSO appliance with blue bands"
      />
    </>
  );
}
