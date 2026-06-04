import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  FileUp,
  FileDown,
  Download,
  ClipboardCheck,
  MessageSquare,
  PlayCircle,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

/* Play a paused tween when `el` enters the viewport. Reliable replacement
   for ScrollTrigger entrance animations that occasionally get stuck at
   opacity:0 when layout positions are cached before images/fonts settle. */
function playOnView(el, tween, { threshold = 0.15 } = {}) {
  if (!el || !tween) return () => {};
  const io = new IntersectionObserver(
    ([entry], obs) => {
      if (entry.isIntersecting) {
        tween.play();
        obs.disconnect();
      }
    },
    { threshold }
  );
  io.observe(el);
  return () => io.disconnect();
}

const PATHWAYS = [
  {
    tag: "Recommended",
    Icon: FileUp,
    title: "Digital Rx",
    lead: "Upload intraoral scans and Rx details directly through our HIPAA-compliant portal.",
    bullets: [
      "STL or native scanner files accepted",
      "Automatic case-number assignment",
      "Confirmation within one business day",
    ],
    ctaLabel: "Submit Digital Rx",
    ctaTo: "/submit-case",
    accent: true,
  },
  {
    tag: "Paper Form",
    Icon: FileDown,
    title: "Download &amp; Fax",
    lead: "Print the standard Rx form, complete by hand, and include with your shipment.",
    bullets: [
      "Olmos Orthotic Rx (PDF)",
      "Sleep Appliance Rx (PDF)",
      "Include with physical models or impressions",
    ],
    ctaLabel: "View Downloads",
    ctaTo: "/resources/downloads",
  },
  {
    tag: "Video Walk-Through",
    Icon: PlayCircle,
    title: "Watch the Demos",
    lead: "See instructional videos for impression taking, scanner protocols, and phonetic bite registration.",
    bullets: [
      "Impression-taking demonstrations",
      "Phonetic bite registration technique",
      "Device-specific instructions for use",
    ],
    ctaLabel: "Instructional Videos",
    ctaTo: "/resources/videos",
  },
];

const REQUIRED = [
  "Patient identifier (initials or internal chart ID — not PHI if possible)",
  "Prescribing dentist name, license, and practice contact",
  "Diagnosis — primary indication (TMD, OSA, bruxism, disc displacement, etc.)",
  "Device selection (Olmos Day variant, Night variant, DDSO, SomnoDent, Tap 3)",
  "Bite registration method (phonetic, centric, vertical dimension notes)",
  "Intraoral scans — upper, lower, and bite in STL or native format",
  "Ship-to address and requested delivery timeframe",
];

const TIPS = [
  {
    Icon: AlertCircle,
    title: "Capture the hammular notches",
    body: "Essential for D3D-Matrix mounting. If dragging occurs with Polyvinyl Siloxane, retake around posterior retention landmarks (ball clasps, thermoforming, rigid acrylic).",
  },
  {
    Icon: AlertCircle,
    title: "Phonetic position for Day appliances",
    body: "Olmos Day Orthotics are fabricated on the mandible for aesthetics and function. If the patient cannot speak with the appliance in place, they won&apos;t wear it.",
  },
  {
    Icon: AlertCircle,
    title: "Include incisive papilla",
    body: "Critical landmark for mounting procedures. Incomplete impressions around papilla and notches will delay the case until we can request a retake.",
  },
];

function Hero() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-rx-hero]", {
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
      className="relative h-[75dvh] min-h-[520px] flex items-end overflow-hidden bg-navy section-pad"
    >
      <div className="absolute inset-0 opacity-[0.1]">
        <img
          src="https://images.unsplash.com/photo-1582560469781-1965b9af903d?auto=format&fit=crop&w=1920&q=80"
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/70 to-navy/30" />
      <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/30 to-transparent" />

      <div className="relative z-10 pb-16 md:pb-24 w-full max-w-6xl mx-auto">
        <div className="max-w-3xl">
        <span
          data-rx-hero
          className="font-mono text-xs text-white/40 uppercase tracking-widest"
        >
          Prescription Workflow
        </span>
        <h1 data-rx-hero className="mt-4 text-white">
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[0.95]">
            How to send us
          </span>
          <span className="block font-drama italic text-6xl sm:text-7xl md:text-9xl tracking-tight leading-[0.88] text-brand-500">
            a case.
          </span>
        </h1>
        <p
          data-rx-hero
          className="mt-6 text-white/50 text-base md:text-lg max-w-xl leading-relaxed"
        >
          Three pathways, one protocol. Digital submission is fastest —
          paper forms and video walk-throughs are available if you&apos;d
          prefer.
        </p>
        </div>
      </div>
    </section>
  );
}

function Pathways() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-path]",
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
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
      <div className="max-w-6xl mx-auto">
        <div className="mb-10 md:mb-12 max-w-2xl">
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            Submission Pathways
          </span>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance">
            Pick the route that fits your{" "}
            <span className="font-drama italic text-brand-500">practice.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {PATHWAYS.map((p) => (
            <div
              key={p.title}
              data-path
              className={`card-radius p-7 md:p-8 border flex flex-col transition-all duration-500 ${
                p.accent
                  ? "bg-navy text-white border-navy-light hover:border-brand-400/40"
                  : "bg-white border-surface-300/50 hover:border-brand-500/30 hover:shadow-lg hover:shadow-navy/5"
              }`}
            >
              <div className="flex items-center justify-between mb-6">
                <span
                  className={`font-mono text-[10px] uppercase tracking-widest ${
                    p.accent ? "text-brand-400" : "text-navy/40"
                  }`}
                >
                  {p.tag}
                </span>
                <div
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
                    p.accent
                      ? "bg-brand-500/10 border border-brand-500/20"
                      : "bg-surface-100 border border-surface-300/50"
                  }`}
                >
                  <p.Icon
                    size={18}
                    className={p.accent ? "text-brand-400" : "text-navy/60"}
                  />
                </div>
              </div>

              <h3
                className={`font-heading font-bold text-2xl tracking-tight ${
                  p.accent ? "text-white" : "text-navy"
                }`}
                dangerouslySetInnerHTML={{ __html: p.title }}
              />
              <p
                className={`mt-3 text-sm md:text-base leading-relaxed ${
                  p.accent ? "text-white/60" : "text-navy/55"
                }`}
              >
                {p.lead}
              </p>

              <ul className="mt-5 space-y-2 flex-1">
                {p.bullets.map((b, i) => (
                  <li
                    key={i}
                    className={`flex gap-2.5 text-sm leading-snug ${
                      p.accent ? "text-white/60" : "text-navy/60"
                    }`}
                  >
                    <CheckCircle2
                      size={13}
                      className={`mt-1 flex-shrink-0 ${
                        p.accent ? "text-brand-400" : "text-brand-500"
                      }`}
                    />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <Link
                to={p.ctaTo}
                className={`mt-7 inline-flex items-center gap-2 text-sm font-semibold ${
                  p.accent
                    ? "text-brand-400 hover:text-brand-300"
                    : "text-brand-500 hover:text-brand-600"
                }`}
              >
                {p.ctaLabel}
                <ArrowRight size={14} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Required() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-req]",
        { y: 24, opacity: 0 },
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
    <section ref={ref} className="section-pad py-24 md:py-28 bg-surface-100">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-14">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <ClipboardCheck size={16} className="text-brand-500" />
            <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
              What to Include
            </span>
          </div>
          <h2 className="font-heading font-bold text-3xl md:text-4xl tracking-tight">
            Every case needs{" "}
            <span className="font-drama italic text-brand-500">
              these details.
            </span>
          </h2>
          <p className="mt-4 text-navy/55 leading-relaxed">
            Missing information is the single biggest cause of delays.
            Here&apos;s what we need before fabrication can start.
          </p>
        </div>
        <div className="lg:col-span-3 space-y-2.5">
          {REQUIRED.map((r, i) => (
            <div
              key={i}
              data-req
              className="bg-white card-radius px-5 py-4 border border-surface-300/40 flex gap-3 items-start"
            >
              <span className="font-mono text-[11px] text-brand-500 tracking-widest mt-0.5 flex-shrink-0">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-sm text-navy/70 leading-snug">{r}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Tips() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-tip]",
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
        <div className="mb-10 md:mb-12 max-w-2xl">
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            Pro Tips
          </span>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance">
            Small details that{" "}
            <span className="font-drama italic text-brand-500">
              save the case.
            </span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TIPS.map((t) => (
            <div
              key={t.title}
              data-tip
              className="bg-white card-radius p-7 border border-surface-300/50 hover:border-accent-500/30 hover:shadow-lg hover:shadow-navy/5 transition-all duration-500"
            >
              <div className="w-11 h-11 rounded-2xl bg-accent-500/10 border border-accent-500/20 flex items-center justify-center mb-5">
                <t.Icon size={18} className="text-accent-500" />
              </div>
              <h3
                className="font-heading font-bold text-lg tracking-tight"
                dangerouslySetInnerHTML={{ __html: t.title }}
              />
              <p
                className="mt-2 text-navy/55 text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: t.body }}
              />
            </div>
          ))}
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
        "[data-rx-cta]",
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
    <section ref={ref} className="section-pad py-24 md:py-28 bg-surface-100">
      <div className="max-w-3xl mx-auto text-center">
        <span
          data-rx-cta
          className="font-mono text-xs text-navy/40 uppercase tracking-widest"
        >
          Need Help?
        </span>
        <h2
          data-rx-cta
          className="mt-4 font-heading font-bold text-3xl md:text-5xl tracking-tight"
        >
          Unsure about a case?
          <br />
          <span className="font-drama italic text-brand-500">
            Call the lab first.
          </span>
        </h2>
        <p
          data-rx-cta
          className="mt-6 text-navy/50 text-base md:text-lg max-w-xl mx-auto"
        >
          Our technicians can walk you through impression technique,
          appliance selection, or device-specific requirements before you
          submit.
        </p>
        <div
          data-rx-cta
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <a
            href="tel:+16197246400"
            className="btn-magnetic group px-8 py-4 rounded-full bg-brand-500 text-white font-semibold"
          >
            <span className="btn-bg bg-brand-600 rounded-full" />
            <span className="relative z-10 flex items-center gap-2">
              <MessageSquare size={14} />
              Call 619.724.6400
            </span>
          </a>
          <Link
            to="/resources/downloads"
            className="px-8 py-4 rounded-full border border-surface-300 text-navy/70 font-medium hover:bg-white transition-colors duration-300 inline-flex items-center gap-2"
          >
            <Download size={14} />
            Download PDF Forms
          </Link>
        </div>
      </div>
    </section>
  );
}

export function RxInstructionsPage() {
  return (
    <>
      <Hero />
      <Pathways />
      <Required />
      <Tips />
      <CTA />
    </>
  );
}
