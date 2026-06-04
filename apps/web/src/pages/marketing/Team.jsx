import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight, Users, Wrench, ShieldCheck, Cpu } from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

const TEAM = {
  leadership: [
    { name: "Matt Rago", role: "Director of Operations" },
  ],
  engineering: [
    { name: "Franco Di Paolo", role: "Lead Digital Engineer" },
    { name: "James Albrecht", role: "Digital Engineering" },
  ],
  technicians: [
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
  quality: [
    { name: "Barbara Rago", role: "RN, MSN — Compliance & Regulations" },
    { name: "Jay Tuyay", role: "Case Quality Assurance" },
  ],
  operations: [
    { name: "Tracy Adams", role: "Products / Procurement Coordinator" },
    { name: "Sammy Mitchell", role: "Communication Logistics Coordinator" },
    { name: "Krystee Rago", role: "Operations" },
  ],
};

function initials(name) {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Hero() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-team-hero]", {
        y: 40,
        opacity: 0,
        duration: 1,
        stagger: 0.08,
        ease: "power3.out",
        delay: 0.3,
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative h-[70dvh] min-h-[500px] flex items-end overflow-hidden bg-gradient-to-t from-diamond-300 via-diamond-200 to-transparent section-pad"
    >
      <div className="absolute inset-0 opacity-[0.08]">
        <img
          src="https://images.unsplash.com/photo-1581093588401-fbb62a02f120?auto=format&fit=crop&w=1920&q=80"
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      {/* <div className="absolute inset-0 bg-gradient-to-t from-diamond-300 via-diamond-300/60 to-transparent" /> */}

      <div className="relative z-10 pb-16 md:pb-24 w-full max-w-6xl mx-auto">
        <div className="max-w-3xl">
        <span
          data-team-hero
          className="font-mono text-xs text-ink/40 uppercase tracking-widest"
        >
          Our Team
        </span>
        <h1 data-team-hero className="mt-4 text-ink">
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-7xl tracking-tight leading-[0.95]">
            Meet the
          </span>
          <span className="block font-drama italic text-5xl sm:text-6xl md:text-8xl tracking-tight leading-[0.9] text-brand-500">
            Diamond team.
          </span>
        </h1>
        <p
          data-team-hero
          className="mt-6 text-ink/80 text-base md:text-lg max-w-lg leading-relaxed"
        >
          Dental technicians, digital engineers, and clinical specialists —
          every case, every appliance, passes through these hands.
        </p>
        </div>
      </div>
    </section>
  );
}

function StatBar() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-team-stat]", {
        y: 20,
        opacity: 0,
        duration: 0.6,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 80%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  const totalTechs = TEAM.technicians.length;
  const stats = [
    { value: "20+", label: "Team Members" },
    { value: `${totalTechs}`, label: "Dental Technicians" },
    { value: "4", label: "Specialist Disciplines" },
    { value: "1", label: "San Diego Lab" },
  ];

  return (
    <section ref={ref} className="section-pad py-16 md:py-20 border-b border-b-gray-200/40">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 ">
          {stats.map((s, i) => (
            <div key={i} data-team-stat>
              <span className="block font-heading font-bold text-3xl md:text-4xl text-ink tracking-tight">
                {s.value}
              </span>
              <span className="block font-mono text-[10px] text-ink/30 uppercase tracking-wider mt-1">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PersonCard({ name, role, accent = false }) {
  return (
    <div className="group bg-white card-radius p-6 border border-surface-300/50 hover:border-brand-500/30 hover:shadow-lg hover:shadow-ink/5 transition-all duration-500">
      <div className="flex items-center gap-4">
        <div
          className={`w-12 h-12 rounded-2xl flex items-center justify-center font-heading font-bold text-sm tracking-tight transition-colors duration-500 ${
            accent
              ? "bg-brand-500 text-white"
              : "bg-surface-200 text-ink/60 group-hover:bg-brand-500/10 group-hover:text-brand-500"
          }`}
        >
          {initials(name)}
        </div>
        <div className="min-w-0">
          <div className="font-heading font-semibold text-sm text-ink tracking-tight truncate">
            {name}
          </div>
          <div className="text-ink/45 text-xs mt-0.5 truncate">{role}</div>
        </div>
      </div>
    </div>
  );
}

function Group({ label, Icon, people, accentAll = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-person]", {
        y: 24,
        opacity: 0,
        duration: 0.6,
        stagger: 0.04,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 80%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref} className="mb-16 md:mb-20">
      <div className="flex items-center gap-3 mb-6 md:mb-8">
        <Icon size={16} className="text-brand-500" />
        <span className="font-mono text-xs text-ink/40 uppercase tracking-widest">
          {label}
        </span>
        <div className="flex-1 h-px bg-surface-300/60" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
        {people.map((p) => (
          <div key={p.name} data-person>
            <PersonCard {...p} accent={accentAll} />
          </div>
        ))}
      </div>
    </div>
  );
}

function CTA() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-team-cta]", {
        y: 40,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 75%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="section-pad py-24 md:py-28">
      <div className="max-w-3xl mx-auto text-center">
        <span
          data-team-cta
          className="font-mono text-xs text-ink/40 uppercase tracking-widest"
        >
          Partner With Us
        </span>
        <h2
          data-team-cta
          className="mt-4 font-heading font-bold text-3xl md:text-5xl tracking-tight"
        >
          Work with the people who
          <br />
          <span className="font-drama italic text-brand-500">
            know the protocol.
          </span>
        </h2>
        <div
          data-team-cta
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <Link
            to="/contact"
            className="btn-magnetic group px-8 py-4 rounded-full bg-accent-500 text-white font-semibold"
          >
            <span className="btn-bg bg-accent-600 rounded-full" />
            <span className="relative z-10 flex items-center gap-2">
              Contact the Lab
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform"
              />
            </span>
          </Link>
          <Link
            to="/about"
            className="px-8 py-4 rounded-full border border-surface-300 text-ink/70 font-medium hover:bg-surface-200/60 transition-colors duration-300"
          >
            Our Story
          </Link>
        </div>
      </div>
    </section>
  );
}

export function TeamPage() {
  return (
    <>
      <Hero />
      <StatBar />
      <section className="section-pad py-20 md:py-28">
        <div className="max-w-6xl mx-auto">
          <Group
            label="Leadership"
            Icon={Users}
            people={TEAM.leadership}
            accentAll
          />
          <Group
            label="Digital Engineering"
            Icon={Cpu}
            people={TEAM.engineering}
          />
          <Group
            label="Dental Technicians"
            Icon={Wrench}
            people={TEAM.technicians}
          />
          <Group
            label="Quality & Compliance"
            Icon={ShieldCheck}
            people={TEAM.quality}
          />
          <Group
            label="Operations & Logistics"
            Icon={Users}
            people={TEAM.operations}
          />
        </div>
      </section>
      <CTA />
    </>
  );
}
