import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { playOnView } from "../../lib/playOnView";
import {
  ArrowRight,
  GraduationCap,
  Compass,
  Globe2,
  Layers,
  BookOpen,
  Calendar,
  ExternalLink,
  Phone,
  Sparkles,
} from "lucide-react";

const LEVELS = [
  {
    level: "Beginning",
    tag: "Foundations",
    Icon: Compass,
    body: "Introduction to TMD and Dental Sleep Medicine protocols. The diagnostic framework, Olmos Series appliance overview, and clinical triage fundamentals.",
    audience: "New to TMD / OSA treatment",
  },
  {
    level: "Intermediate",
    tag: "Protocol",
    Icon: Layers,
    body: "Comprehensive diagnosis, appliance selection criteria, phonetic bite registration, impression technique, and patient management systems.",
    audience: "Dentists building a TMJ practice",
  },
  {
    level: "Advanced",
    tag: "Mastery",
    Icon: Sparkles,
    body: "Complex case management, integration with sleep medicine workflows, data-driven treatment outcomes, and advanced Olmos protocol application.",
    audience: "Experienced practitioners",
  },
];

const FOCUS = [
  {
    Icon: BookOpen,
    title: "TMD Training",
    body: "Temporomandibular disorder diagnosis and the Olmos Orthotic protocol — built around restoring function, not just managing symptoms.",
  },
  {
    Icon: GraduationCap,
    title: "Dental Sleep Medicine",
    body: "Oral appliance therapy for obstructive sleep apnea and snoring. FDA-cleared device selection, titration, and long-term patient management.",
  },
  {
    Icon: Globe2,
    title: "Integrated Care",
    body: "How dentistry connects to neurology, otolaryngology, and physical therapy in craniofacial pain treatment — the cross-disciplinary approach that defines the centre model.",
  },
];

const LOCATIONS = [
  { flag: "🇺🇸", label: "United States", note: "Multiple regional sessions annually" },
  { flag: "🇨🇦", label: "Canada",        note: "Scheduled throughout the year" },
  { flag: "🇦🇺", label: "Australia",     note: "Regional Olmos Method training" },
];

function Hero() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-crs-hero]", {
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
      className="relative h-[80dvh] min-h-[540px] flex items-end overflow-hidden bg-navy section-pad"
    >
      <div className="absolute inset-0 opacity-[0.12]">
        <img
          src="https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1920&q=80"
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/70 to-navy/30" />
      <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/40 to-transparent" />

      <div className="relative z-10 pb-16 md:pb-24 w-full max-w-6xl mx-auto">
        <div className="max-w-3xl">
        <span
          data-crs-hero
          className="font-mono text-xs text-on-dark/40 uppercase tracking-widest"
        >
          Dr. Steven Olmos · Courses
        </span>
        <h1 data-crs-hero className="mt-4 text-on-dark">
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[0.95]">
            Train with the
          </span>
          <span className="block font-drama italic text-6xl sm:text-7xl md:text-9xl tracking-tight leading-[0.88] text-brand-500">
            protocol&apos;s author.
          </span>
        </h1>
        <p
          data-crs-hero
          className="mt-6 text-on-dark/50 text-base md:text-lg max-w-xl leading-relaxed"
        >
          Continued education from TMJ &amp; Sleep Therapy Centres
          International — the clinical network Dr. Olmos founded. Beginning,
          intermediate, and advanced training in TMD and Dental Sleep
          Medicine.
        </p>
        </div>
      </div>
    </section>
  );
}

function Intro() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-crs-intro]",
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
    <section ref={ref} className="section-pad py-24 md:py-28">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-14">
        <div className="lg:col-span-2">
          <span
            data-crs-intro
            className="font-mono text-xs text-navy/40 uppercase tracking-widest"
          >
            The Program
          </span>
          <h2
            data-crs-intro
            className="mt-3 font-heading font-bold text-3xl md:text-4xl tracking-tight"
          >
            Education directed by{" "}
            <span className="font-drama italic text-brand-500">
              Dr. Olmos.
            </span>
          </h2>
        </div>
        <div className="lg:col-span-3 space-y-5 text-navy/60 leading-relaxed">
          <p data-crs-intro>
            TMJ &amp; Sleep Therapy Centres International is recognized as a
            leader in continued education, training, and resources for the
            dental profession. The program delivers an integrated approach
            to care — in-depth diagnosis, the latest treatment technologies,
            patient management systems, integrated software, and training
            for every level of a dentist&apos;s practice.
          </p>
          <p data-crs-intro>
            All education is directed by Dr. Steven R. Olmos, whose
            commitment to helping patients overcome sleep breathing
            disorders, craniofacial pain, and TMD has made him world-renown.
            Dr. Olmos&apos; system for triage, diagnosis, and treatment is
            noted for providing successful treatment results — and is the
            driving force behind{" "}
            <Link
              to="/resources/certified-labs"
              className="text-brand-500 font-semibold hover:underline"
            >
              60+ Centres across 7 countries
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}

function Levels() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-level]",
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.7,
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
    <section ref={ref} className="section-pad py-24 md:py-28 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 md:mb-16 max-w-2xl">
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            Course Levels
          </span>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance">
            Three tracks, one{" "}
            <span className="font-drama italic text-brand-500">
              progression.
            </span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {LEVELS.map((l, i) => (
            <div
              key={l.level}
              data-level
              className="bg-white card-radius p-8 border border-surface-300/50 hover:border-brand-500/30 hover:shadow-lg hover:shadow-navy/5 transition-all duration-500 flex flex-col"
            >
              <div className="flex items-center justify-between mb-6">
                <span className="font-mono text-[11px] text-brand-500 tracking-widest">
                  {String(i + 1).padStart(2, "0")} · {l.tag}
                </span>
                <div className="w-11 h-11 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
                  <l.Icon size={18} className="text-brand-500" />
                </div>
              </div>
              <h3 className="font-heading font-bold text-2xl tracking-tight">
                {l.level}
              </h3>
              <p className="mt-3 text-navy/55 text-sm md:text-base leading-relaxed flex-1">
                {l.body}
              </p>
              <div className="mt-6 pt-6 border-t border-surface-300/50">
                <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest">
                  Ideal for
                </div>
                <div className="mt-1.5 text-sm text-navy/80 font-medium">
                  {l.audience}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Focus() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-focus]",
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.7,
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
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 md:mb-16 max-w-2xl">
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            Focus Areas
          </span>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance">
            What you&apos;ll{" "}
            <span className="font-drama italic text-brand-500">study.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {FOCUS.map((f) => (
            <div
              key={f.title}
              data-focus
              className="bg-navy text-on-dark card-radius p-8 border border-navy-light"
            >
              <div className="w-11 h-11 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mb-5">
                <f.Icon size={18} className="text-brand-400" />
              </div>
              <h3 className="font-heading font-bold text-lg tracking-tight">
                {f.title}
              </h3>
              <p className="mt-2 text-on-dark/55 text-sm leading-relaxed">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Locations() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-loc]",
        { y: 24, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          stagger: 0.08,
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
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-10">
          <Globe2 size={16} className="text-brand-500" />
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            Where to Train
          </span>
          <div className="flex-1 h-px bg-surface-300/60" />
        </div>
        <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance max-w-2xl">
          Sessions held{" "}
          <span className="font-drama italic text-brand-500">
            across three continents.
          </span>
        </h2>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
          {LOCATIONS.map((l) => (
            <div
              key={l.label}
              data-loc
              className="bg-white card-radius p-6 border border-surface-300/50 flex items-center gap-4"
            >
              <span className="text-3xl" aria-hidden>
                {l.flag}
              </span>
              <div>
                <div className="font-heading font-semibold text-sm text-navy tracking-tight">
                  {l.label}
                </div>
                <div className="text-navy/45 text-xs mt-0.5">{l.note}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 bg-navy card-radius p-8 md:p-10 border border-navy-light flex flex-col md:flex-row md:items-center gap-6">
          <div className="w-12 h-12 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
            <Calendar size={18} className="text-brand-400" />
          </div>
          <div className="flex-1">
            <div className="font-heading font-bold text-lg text-on-dark tracking-tight">
              Upcoming course calendar
            </div>
            <p className="mt-1 text-on-dark/55 text-sm leading-relaxed">
              Dates and locations are scheduled throughout the year. For the
              current calendar, registration, and seat availability, contact
              the lab or visit TMJ &amp; Sleep Therapy Centres International
              directly.
            </p>
          </div>
          <a
            href="https://www.tmjtherapycentre.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors whitespace-nowrap"
          >
            TMJ &amp; Sleep Centres
            <ExternalLink size={14} />
          </a>
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
        "[data-crs-cta]",
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
          data-crs-cta
          className="font-mono text-xs text-navy/40 uppercase tracking-widest"
        >
          Enrollment
        </span>
        <h2
          data-crs-cta
          className="mt-4 font-heading font-bold text-3xl md:text-5xl tracking-tight"
        >
          Ready to expand your{" "}
          <span className="font-drama italic text-brand-500">
            knowledge?
          </span>
        </h2>
        <p
          data-crs-cta
          className="mt-6 text-navy/50 text-base md:text-lg max-w-lg mx-auto"
        >
          Call the lab for current session dates, curriculum, and
          registration — or reach us through the contact form.
        </p>
        <div
          data-crs-cta
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <a
            href="tel:+16197246400"
            className="btn-magnetic group px-8 py-4 rounded-full bg-accent-500 text-white font-semibold"
          >
            <span className="btn-bg bg-accent-600 rounded-full" />
            <span className="relative z-10 flex items-center gap-2">
              <Phone size={14} />
              Call 619.724.6400
            </span>
          </a>
          <Link
            to="/contact"
            className="px-8 py-4 rounded-full border border-surface-300 text-navy/70 font-medium hover:bg-surface-200/60 transition-colors duration-300 inline-flex items-center gap-2"
          >
            Contact Form
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

export function CoursesPage() {
  return (
    <>
      <Hero />
      <Intro />
      <Levels />
      <Focus />
      <Locations />
      <CTA />
    </>
  );
}
