import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Globe,
  Award,
  Microscope,
  Cpu,
} from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

/* ─── HERO ─── */
function AboutHero() {
  const heroRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-about-hero]", {
        y: 40,
        opacity: 0,
        duration: 1,
        stagger: 0.08,
        ease: "power3.out",
        delay: 0.3,
      });
    }, heroRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={heroRef}
      className="relative h-[70dvh] min-h-[500px] flex items-end overflow-hidden"
    >
      <div className="absolute inset-0">
        <img
          src="/images/about-hero.webp"
          alt="DDSO orthotic in dental laboratory"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-transparent to-transparent" />
      </div>

      <div className="relative z-10 section-pad pb-16 md:pb-24 max-w-3xl">
        <span
          data-about-hero
          className="font-mono text-xs text-white/40 uppercase tracking-widest"
        >
          About Diamond
        </span>
        <h1 data-about-hero className="mt-4 text-white">
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-7xl tracking-tight leading-[0.95]">
            The lab behind
          </span>
          <span className="block font-drama italic text-5xl sm:text-6xl md:text-8xl tracking-tight leading-[0.9] text-brand-500">
            the protocol.
          </span>
        </h1>
        <p
          data-about-hero
          className="mt-6 text-white/50 text-base md:text-lg max-w-lg leading-relaxed"
        >
          Diamond Orthotic Laboratory is the only lab built from the ground up
          around the Olmos Series system — the gold standard in TMJ and sleep
          breathing orthotic treatment.
        </p>
      </div>
    </section>
  );
}

/* ─── MISSION STATEMENT ─── */
function Mission() {
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-mission]", {
        y: 30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 70%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="section-pad py-24 md:py-32">
      <div className="max-w-4xl mx-auto text-center">
        <span
          data-mission
          className="font-mono text-xs text-navy/40 uppercase tracking-widest"
        >
          Our Mission
        </span>
        <blockquote data-mission className="mt-8">
          <p className="font-drama italic text-3xl sm:text-4xl md:text-5xl lg:text-6xl text-navy leading-[1.15] tracking-tight">
            To advance the treatment of TMJ and sleep breathing disorders
            through{" "}
            <span className="text-brand-500">
              precision digital manufacturing
            </span>{" "}
            and unwavering commitment to the Olmos clinical protocol.
          </p>
        </blockquote>
        <div
          data-mission
          className="mt-8 flex items-center justify-center gap-3 text-navy/30 text-sm"
        >
          <div className="h-px w-12 bg-navy/10" />
          <span className="font-mono text-xs">
            Quality · Commitment · Accuracy · Efficiency
          </span>
          <div className="h-px w-12 bg-navy/10" />
        </div>
      </div>
    </section>
  );
}

/* ─── DR. OLMOS SECTION ─── */
function DrOlmos() {
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-olmos]", {
        y: 40,
        opacity: 0,
        duration: 0.8,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 70%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="relative bg-navy overflow-hidden py-24 md:py-32">
      {/* Subtle texture */}
      <div className="absolute inset-0 opacity-[0.04]">
        <img
          src="https://images.unsplash.com/photo-1530497610245-94d3c16cda28?auto=format&fit=crop&w=1920&q=80"
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>

      <div className="relative z-10 section-pad">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Photo */}
          <div data-olmos className="flex justify-center lg:justify-start">
            <div className="relative">
              <div className="w-64 h-64 md:w-80 md:h-80 rounded-full overflow-hidden border-4 border-white/10">
                <img
                  src="/images/dr-olmos.jpg"
                  alt="Dr. Steven Olmos"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-brand-500 text-white text-xs font-semibold whitespace-nowrap">
                Olmos Series Creator
              </div>
            </div>
          </div>

          {/* Content */}
          <div>
            <span
              data-olmos
              className="font-mono text-xs text-white/30 uppercase tracking-widest"
            >
              The Protocol
            </span>
            <h2
              data-olmos
              className="mt-4 font-heading font-bold text-3xl md:text-4xl text-white tracking-tight"
            >
              Built on the work of
              <br />
              <span className="font-drama italic text-brand-500">
                Dr. Steven Olmos.
              </span>
            </h2>
            <p
              data-olmos
              className="mt-6 text-white/50 text-base leading-relaxed"
            >
              Dr. Steven Olmos is the global authority on TMJ and sleep
              breathing disorders. His Olmos Series orthotic system represents
              decades of clinical research translated into precise, reproducible
              treatment protocols.
            </p>
            <p
              data-olmos
              className="mt-4 text-white/50 text-base leading-relaxed"
            >
              Diamond Orthotic Laboratory is the only lab purpose-built around
              this system. We don&apos;t just fabricate appliances — we
              understand the clinical intent behind every parameter, every
              adjustment, every case.
            </p>
            <div
              data-olmos
              className="mt-8 flex flex-wrap items-center gap-4"
            >
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
                <Award size={14} className="text-accent-500" />
                <span className="text-white/60 text-xs font-medium">
                  Global TMJ Authority
                </span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
                <Microscope size={14} className="text-brand-500" />
                <span className="text-white/60 text-xs font-medium">
                  Decades of Research
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── VALUES ─── */
function Values() {
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-value-card]", {
        y: 60,
        opacity: 0,
        duration: 0.7,
        stagger: 0.15,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 70%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  const values = [
    {
      title: "Quality",
      desc: "Every appliance meets exacting standards. 3D-printed precision verified through multi-point dimensional analysis before it leaves our lab.",
      accent: "bg-brand-500",
    },
    {
      title: "Commitment",
      desc: "We're invested in outcomes, not just orders. Direct communication with your dedicated technician on every case.",
      accent: "bg-accent-500",
    },
    {
      title: "Accuracy",
      desc: "Full digital workflow from scan to delivery. CAD articulation eliminates the cumulative errors of analog processes.",
      accent: "bg-emerald-500",
    },
    {
      title: "Efficiency",
      desc: "Fast turnaround without cutting corners. Digital-first means fewer remakes, fewer adjustments, and faster chair time.",
      accent: "bg-violet-500",
    },
  ];

  return (
    <section ref={ref} className="section-pad py-24 md:py-32">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 md:mb-16">
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            Our Values
          </span>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-4xl tracking-tight">
            What drives every case.
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {values.map((v, i) => (
            <div
              key={i}
              data-value-card
              className="bg-white card-radius p-6 border border-surface-300/50 shadow-sm hover:shadow-md transition-shadow duration-500"
            >
              <div className={`w-2 h-8 rounded-full ${v.accent} mb-5`} />
              <h3 className="font-heading font-bold text-lg mb-2">
                {v.title}
              </h3>
              <p className="text-navy/50 text-sm leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── CERTIFIED LABS MAP ─── */
function CertifiedLabs() {
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-map]", {
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
    <section ref={ref} className="section-pad py-16 md:py-24">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white card-radius-lg p-8 md:p-12 border border-surface-300/50 shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            <div>
              <div data-map className="flex items-center gap-2 mb-4">
                <Globe size={16} className="text-brand-500" />
                <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
                  Global Reach
                </span>
              </div>
              <h2
                data-map
                className="font-heading font-bold text-2xl md:text-3xl tracking-tight"
              >
                Olmos-Certified labs
                <br />
                <span className="text-brand-500">worldwide.</span>
              </h2>
              <p
                data-map
                className="mt-4 text-navy/50 text-sm leading-relaxed max-w-md"
              >
                Diamond Orthotic Laboratory is part of a select network of
                certified labs trained to fabricate Olmos Series orthotics.
                Serving dental professionals across multiple continents.
              </p>
              <div data-map className="mt-6 flex flex-wrap gap-3">
                <span className="px-3 py-1.5 rounded-full bg-brand-500/10 text-brand-500 text-xs font-semibold">
                  North America
                </span>
                <span className="px-3 py-1.5 rounded-full bg-brand-500/10 text-brand-500 text-xs font-semibold">
                  Australia
                </span>
                <span className="px-3 py-1.5 rounded-full bg-brand-500/10 text-brand-500 text-xs font-semibold">
                  Expanding
                </span>
              </div>
            </div>
            <div data-map>
              <img
                src="/images/certified-labs-map.png"
                alt="World map showing Olmos-certified lab locations"
                className="w-full h-auto rounded-2xl"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── FULL-WIDTH SLIDER ─── */
function Slider() {
  const [current, setCurrent] = useState(0);

  const slides = [
    { src: "/images/ddso-kit.webp", label: "Complete DDSO Patient Kit" },
    { src: "/images/onp-front.webp", label: "ONP — Front View" },
    { src: "/images/dorsal1.webp", label: "Dorsal Orthotic on Model" },
    { src: "/images/ddso-isometric.webp", label: "DDSO Anterior Isometric" },
    { src: "/images/onp-nylon.webp", label: "ONP Nylon — Studio" },
    { src: "/images/od-pmt.webp", label: "OD PMT Orthotic" },
  ];

  const slide = (dir) => {
    setCurrent((prev) => {
      const next = prev + dir;
      if (next < 0) return slides.length - 1;
      if (next >= slides.length) return 0;
      return next;
    });
  };

  useEffect(() => {
    const interval = setInterval(() => slide(1), 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative w-full overflow-hidden py-16 md:py-24 bg-surface-100">
      <div className="section-pad mb-8 flex items-center justify-between">
        <div>
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            Our Work
          </span>
          <h2 className="mt-2 font-heading font-bold text-2xl md:text-3xl tracking-tight">
            Crafted with precision.
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => slide(-1)}
            className="w-10 h-10 rounded-full border border-surface-300/50 flex items-center justify-center text-navy/40 hover:text-navy hover:bg-surface-200/60 transition-colors"
            aria-label="Previous slide"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => slide(1)}
            className="w-10 h-10 rounded-full border border-surface-300/50 flex items-center justify-center text-navy/40 hover:text-navy hover:bg-surface-200/60 transition-colors"
            aria-label="Next slide"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="relative w-full overflow-hidden">
        <div
          className="flex transition-transform duration-700 ease-out"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {slides.map((s, i) => (
            <div key={i} className="w-full flex-shrink-0 px-4 md:px-8">
              <div className="relative w-full aspect-[16/9] md:aspect-[21/9] rounded-[2rem] overflow-hidden bg-white border border-surface-300/50">
                <img
                  src={s.src}
                  alt={s.label}
                  className="w-full h-full object-contain bg-surface-50 p-4"
                  loading="lazy"
                />
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-navy/60 to-transparent">
                  <span className="text-white text-sm font-medium">
                    {s.label}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 mt-6">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === current ? "w-6 bg-brand-500" : "w-1.5 bg-navy/10"
            }`}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </section>
  );
}

/* ─── DIGITAL WORKFLOW SECTION ─── */
function DigitalWorkflow() {
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-workflow]", {
        y: 40,
        opacity: 0,
        duration: 0.7,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 70%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  const steps = [
    {
      icon: Cpu,
      step: "01",
      title: "Intraoral Scan",
      desc: "Digital impressions replace traditional molds. Precision data from the very first step.",
    },
    {
      icon: Microscope,
      step: "02",
      title: "CAD Design",
      desc: "Computerized articulation with Olmos-Method parameters. Every surface calculated.",
    },
    {
      icon: Award,
      step: "03",
      title: "3D Fabrication",
      desc: "SLS printing in biocompatible nylon. Quality verified before shipping.",
    },
  ];

  return (
    <section ref={ref} className="section-pad py-24 md:py-32">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 text-center">
          <span
            data-workflow
            className="font-mono text-xs text-navy/40 uppercase tracking-widest"
          >
            How We Work
          </span>
          <h2
            data-workflow
            className="mt-3 font-heading font-bold text-3xl md:text-4xl tracking-tight"
          >
            End-to-end digital workflow.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((s, i) => (
            <div
              key={i}
              data-workflow
              className="relative bg-white card-radius p-8 border border-surface-300/50 shadow-sm hover:shadow-md transition-shadow duration-500"
            >
              <span className="font-mono text-brand-500/30 text-5xl font-bold absolute top-4 right-6">
                {s.step}
              </span>
              <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center mb-5">
                <s.icon size={18} className="text-brand-500" />
              </div>
              <h3 className="font-heading font-bold text-lg mb-2">
                {s.title}
              </h3>
              <p className="text-navy/50 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>

        {/* Ambient image */}
        <div data-workflow className="mt-12 relative w-full aspect-[21/9] rounded-[2rem] overflow-hidden">
          <img
            src="https://images.unsplash.com/photo-1581093458791-9d42e3c9e8b0?auto=format&fit=crop&w=1920&q=80"
            alt="3D printing technology"
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-navy/40 to-brand-500/20" />
        </div>
      </div>
    </section>
  );
}

/* ─── STATS BAR ─── */
function Stats() {
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-stat]", {
        y: 30,
        opacity: 0,
        duration: 0.7,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 80%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  const stats = [
    { value: "100%", label: "Digital Workflow" },
    { value: "<2wk", label: "Turnaround" },
    { value: "FDA", label: "Cleared Devices" },
    { value: "1", label: "Lab · Every Protocol" },
  ];

  return (
    <section ref={ref} className="section-pad py-16 md:py-24">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {stats.map((s, i) => (
            <div
              key={i}
              data-stat
              className="text-center p-6 rounded-[2rem] bg-white border border-surface-300/50"
            >
              <div className="font-heading font-bold text-3xl md:text-4xl text-brand-500 tracking-tight">
                {s.value}
              </div>
              <div className="mt-2 font-mono text-xs text-navy/40 uppercase tracking-wider">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── CTA ─── */
function AboutCTA() {
  return (
    <section className="section-pad py-16 md:py-24">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="font-heading font-bold text-2xl md:text-4xl tracking-tight">
          Ready to partner with
          <span className="font-drama italic text-brand-500"> Diamond?</span>
        </h2>
        <p className="mt-4 text-navy/50 text-base max-w-lg mx-auto">
          Join the network of dental professionals who trust Diamond Orthotic
          Laboratory for protocol-driven precision.
        </p>
        <Link
          to="/contact"
          className="btn-magnetic group mt-8 inline-flex px-8 py-4 rounded-full bg-accent-500 text-white font-semibold"
        >
          <span className="btn-bg bg-accent-600 rounded-full" />
          <span className="relative z-10 flex items-center gap-2">
            Contact Our Lab
            <ArrowRight
              size={16}
              className="group-hover:translate-x-1 transition-transform"
            />
          </span>
        </Link>
      </div>
    </section>
  );
}

/* ─── PAGE EXPORT ─── */
export function AboutPage() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <>
      <AboutHero />
      <Mission />
      <DrOlmos />
      <Values />
      <DigitalWorkflow />
      <CertifiedLabs />
      <Slider />
      <Stats />
      <AboutCTA />
    </>
  );
}
