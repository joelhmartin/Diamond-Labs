import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import {
  ArrowRight,
  Award,
  BookOpen,
  Globe2,
  GraduationCap,
  Microscope,
  Quote,
} from "lucide-react";
import { playOnView } from "../../lib/playOnView";

const CREDENTIALS = [
  { abbr: "DDS",      label: "Doctor of Dental Surgery — USC School of Dentistry" },
  { abbr: "DABCP",    label: "Diplomate, American Board of Craniofacial Pain" },
  { abbr: "DABCDSM",  label: "Diplomate, American Board of Craniofacial Dental Sleep Medicine" },
  { abbr: "DABDSM",   label: "Diplomate, American Board of Dental Sleep Medicine" },
  { abbr: "DAIPM",    label: "Diplomate, Academy of Integrative Pain Management" },
  { abbr: "FAAOP",    label: "Fellow, American Academy of Orofacial Pain" },
  { abbr: "FAACP",    label: "Fellow, American Academy of Craniofacial Pain" },
  { abbr: "FICCMO",   label: "Fellow, International College of Cranio-Mandibular Orthopedics" },
  { abbr: "FADI",     label: "Fellow, Academy of Dentistry International" },
  { abbr: "FIAO",     label: "Fellow, International Association of Orthodontics" },
  { abbr: "FACD",     label: "Fellow, American College of Dentists" },
];

const FOCUS_AREAS = [
  {
    Icon: Microscope,
    title: "Craniofacial Pain",
    copy: "Diagnosis and non-surgical treatment of chronic and acute orofacial pain — integrating dentistry, neurology, and physical therapy.",
  },
  {
    Icon: BookOpen,
    title: "TMD Research",
    copy: "Board certified by the American Board of Craniofacial Pain; leading protocols for temporomandibular disorder diagnosis and orthotic therapy.",
  },
  {
    Icon: GraduationCap,
    title: "Dental Sleep Medicine",
    copy: "Board certified in sleep-related breathing disorders; directs clinical research and education programs for dentists treating OSA.",
  },
];

function Hero() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-olmos-hero]", {
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
      className="relative h-[85dvh] min-h-[560px] flex items-end overflow-hidden bg-navy section-pad"
    >
      <div className="absolute inset-0 opacity-[0.12]">
        <img
          src="https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1920&q=80"
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/80 to-navy/60" />
      <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/40 to-transparent" />

      <div className="relative z-10 pb-16 md:pb-24 w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 lg:gap-16 items-end">
        <div className="max-w-4xl">
        <span
          data-olmos-hero
          className="font-mono text-xs text-on-dark/40 uppercase tracking-widest"
        >
          Founder · Protocol Architect
        </span>
        <h1 data-olmos-hero className="mt-4 text-on-dark">
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-7xl tracking-tight leading-[0.95]">
            Dr. Steven
          </span>
          <span className="block font-drama italic text-6xl sm:text-7xl md:text-9xl tracking-tight leading-[0.9] text-brand-500">
            Olmos, DDS.
          </span>
        </h1>
        <p
          data-olmos-hero
          className="mt-6 text-on-dark/50 text-base md:text-lg max-w-xl leading-relaxed"
        >
          Founder of TMJ &amp; Sleep Therapy Centres International. 35+ years
          in private practice. 30+ years devoted to research and treatment of
          craniofacial pain, TMD, and sleep-disordered breathing.
        </p>
        </div>

        {/* Portrait — right of the headline on desktop, stacked above it on
            mobile so the name still leads. Same asset as the About page. */}
        <div
          data-olmos-hero
          className="hidden lg:block shrink-0 w-56 xl:w-72 rounded-full overflow-hidden border-4 border-brand-500"
        >
          <img
            src="/images/dr-olmos.jpg"
            alt="Dr. Steven Olmos"
            className="w-full h-full object-cover"
            width="900"
            height="900"
          />
        </div>
      </div>
    </section>
  );
}

function Quotation() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-quote]",
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 1,
          stagger: 0.12,
          ease: "power3.out",
          paused: true,
        }
      );
      cleanup = playOnView(ref.current, tween);
    }, ref);
    return () => {
      cleanup?.();
      ctx.revert();
    };
  }, []);

  return (
    <section ref={ref} className="section-pad py-24 md:py-28">
      <div className="max-w-4xl mx-auto text-center">
        <Quote
          data-quote
          size={32}
          className="text-brand-500 mx-auto mb-6 opacity-60"
        />
        <p
          data-quote
          className="font-drama italic text-3xl md:text-5xl text-navy leading-[1.15] tracking-tight text-balance"
        >
          &ldquo;The more precise and accurate your diagnosis, the more
          specific and effective will be the{" "}
          <span className="text-brand-500">treatment</span>.&rdquo;
        </p>
        <div
          data-quote
          className="mt-8 font-mono text-[11px] text-navy/40 uppercase tracking-widest"
        >
          Dr. Steven Olmos · DDS
        </div>
      </div>
    </section>
  );
}

function Biography() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-bio]",
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
          paused: true,
        }
      );
      cleanup = playOnView(ref.current, tween);
    }, ref);
    return () => {
      cleanup?.();
      ctx.revert();
    };
  }, []);

  return (
    <section ref={ref} className="section-pad py-24 md:py-28 bg-surface-100">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-12 lg:gap-16">
        <div className="lg:col-span-2">
          <span
            data-bio
            className="font-mono text-xs text-navy/40 uppercase tracking-widest"
          >
            Biography
          </span>
          <h2
            data-bio
            className="mt-3 font-heading font-bold text-3xl md:text-4xl tracking-tight"
          >
            A life&apos;s work in{" "}
            <span className="font-drama italic text-brand-500">
              pain &amp; sleep
            </span>
            .
          </h2>
        </div>
        <div className="lg:col-span-3 space-y-5 text-navy/60 leading-relaxed">
          <p data-bio>
            Dr. Steven Olmos has been in private practice for more than{" "}
            <span className="text-navy font-semibold">35 years</span>, with
            the last <span className="text-navy font-semibold">30 years</span>{" "}
            devoted to research and treatment of craniofacial pain,
            temporomandibular disorder (TMD), and sleep-disordered breathing.
          </p>
          <p data-bio>
            He obtained his DDS from the University of Southern California
            School of Dentistry and is Board Certified in both Chronic Pain
            and Sleep Related Breathing Disorders by the American Board of
            Craniofacial Pain, the Academy of Integrative Pain Management,
            the American Board of Dental Sleep Medicine, and the American
            Board of Craniofacial Pain and Dental Sleep Medicine.
          </p>
          <p data-bio>
            Dr. Olmos is the founder of{" "}
            <span className="text-navy font-semibold">
              TMJ &amp; Sleep Therapy Centres International
            </span>
            , with over 60 centres in 7 countries dedicated exclusively to
            the diagnosis and treatment of craniofacial pain and sleep
            disorders. He currently directs research in these fields through
            data collection, focused on establishing protocols between
            dentistry and medicine for optimal treatment outcomes.
          </p>
        </div>
      </div>
    </section>
  );
}

function Credentials() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-cred]",
        { y: 20, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.5,
          stagger: 0.04,
          ease: "power3.out",
          paused: true,
        }
      );
      cleanup = playOnView(ref.current, tween);
    }, ref);
    return () => {
      cleanup?.();
      ctx.revert();
    };
  }, []);

  return (
    <section ref={ref} className="section-pad py-24 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-10">
          <Award size={16} className="text-brand-500" />
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            Board Certifications &amp; Fellowships
          </span>
          <div className="flex-1 h-px bg-surface-300/60" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CREDENTIALS.map((c) => (
            <div
              key={c.abbr}
              data-cred
              className="bg-white card-radius p-5 border border-surface-300/50 hover:border-brand-500/30 hover:shadow-md transition-all duration-500 group"
            >
              <div className="font-heading font-bold text-xl tracking-tight text-navy group-hover:text-brand-500 transition-colors">
                {c.abbr}
              </div>
              <div className="text-navy/50 text-xs mt-1.5 leading-snug">
                {c.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function GlobalReach() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-reach]",
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
          paused: true,
        }
      );
      cleanup = playOnView(ref.current, tween);
    }, ref);
    return () => {
      cleanup?.();
      ctx.revert();
    };
  }, []);

  return (
    <section ref={ref} className="relative bg-navy overflow-hidden">
      <div className="absolute inset-0 opacity-[0.05]">
        <img
          src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1920&q=80"
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-navy via-transparent to-navy" />

      <div className="relative z-10 section-pad py-24 md:py-28">
        <div className="max-w-6xl mx-auto">
          <div data-reach className="flex items-center gap-3 mb-6">
            <Globe2 size={16} className="text-brand-400" />
            <span className="font-mono text-[10px] text-on-dark/30 uppercase tracking-[0.2em]">
              TMJ &amp; Sleep Therapy Centres International
            </span>
          </div>
          <h2
            data-reach
            className="font-heading font-bold text-4xl md:text-6xl text-on-dark tracking-tight leading-[1.05] text-balance"
          >
            <span className="text-brand-400">60+ centres.</span>{" "}
            <span className="font-drama italic">7 countries.</span>{" "}
            One protocol.
          </h2>
          <p
            data-reach
            className="mt-8 max-w-2xl text-on-dark/45 text-base md:text-lg leading-relaxed"
          >
            The network Dr. Olmos founded spans the US, Canada, Australia,
            and four additional countries — each centre dedicated
            exclusively to the diagnosis and treatment of craniofacial pain
            and sleep-disordered breathing. Diamond Orthotic Laboratory is
            the fabrication arm of that network.
          </p>

          <div className="mt-16 pt-10 border-t border-white/10 grid grid-cols-1 md:grid-cols-3 gap-8">
            {FOCUS_AREAS.map((f) => (
              <div key={f.title} data-reach>
                <f.Icon size={22} className="text-brand-400 mb-4" />
                <div className="font-heading font-bold text-lg text-on-dark tracking-tight">
                  {f.title}
                </div>
                <p className="text-on-dark/40 text-sm mt-2 leading-relaxed">
                  {f.copy}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CTA() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-olmos-cta]",
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
          paused: true,
        }
      );
      cleanup = playOnView(ref.current, tween);
    }, ref);
    return () => {
      cleanup?.();
      ctx.revert();
    };
  }, []);

  return (
    <section ref={ref} className="section-pad py-24 md:py-28">
      <div className="max-w-3xl mx-auto text-center">
        <span
          data-olmos-cta
          className="font-mono text-xs text-navy/40 uppercase tracking-widest"
        >
          Training &amp; Partnership
        </span>
        <h2
          data-olmos-cta
          className="mt-4 font-heading font-bold text-3xl md:text-5xl tracking-tight"
        >
          Build your practice around
          <br />
          <span className="font-drama italic text-brand-500">
            the Olmos Series.
          </span>
        </h2>
        <div
          data-olmos-cta
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <Link
            to="/resources/courses"
            className="btn-magnetic group px-8 py-4 rounded-full bg-accent-500 text-white font-semibold"
          >
            <span className="btn-bg bg-accent-600 rounded-full" />
            <span className="relative z-10 flex items-center gap-2">
              Training &amp; Courses
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform"
              />
            </span>
          </Link>
          <Link
            to="/resources/certified-labs"
            className="px-8 py-4 rounded-full border border-surface-300 text-navy/70 font-medium hover:bg-surface-200/60 transition-colors duration-300"
          >
            Certified Labs
          </Link>
        </div>
      </div>
    </section>
  );
}

export function DrOlmosPage() {
  return (
    <>
      <Hero />
      <Quotation />
      <Biography />
      <Credentials />
      <GlobalReach />
      <CTA />
    </>
  );
}
