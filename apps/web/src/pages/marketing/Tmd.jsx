import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  Sun,
  Moon,
  Activity,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { ProductCatalog } from "../../components/marketing/ProductCatalog";

gsap.registerPlugin(ScrollTrigger);

const TMD_TABS = [
  { key: "ond", label: "OND", sub: "Olmos Neuromuscular Device" },
  { key: "onp", label: "ONP", sub: "Olmos Neuromuscular Positioner" },
];

const DAY_ORTHOTICS = [
  {
    code: "OD — Acrylic",
    name: "Acrylic Day",
    tag: "Easily adjusted",
    bullets: [
      "All acrylic with ball clasps and braided lingual wire support",
      "Chronic disc-displacement or skeletal/muscular asymmetry",
      "Functions as a positioning stent to correct vertical dimension, rotation, cant, and protrusion",
      "Lingual anatomical ridge guides disclusion and protects the contralateral joint in working movements",
    ],
  },
  {
    code: "OD — Expansion",
    name: "Lingual Expansion",
    tag: "No occlusal coverage #22–27",
    bullets: [
      "Narrow arches and/or anterior crowding",
      "Minimal lingual interference required",
      "If lingual wire is activated, tooth movement may occur",
      "Lingual expander connection with open occlusal anteriors",
    ],
  },
  {
    code: "OD — PMT",
    name: "Thermoform",
    tag: "Most compact & comfortable",
    bullets: [
      "Narrow arches",
      "Inter-occlusal distances less than 1.5 mm",
      "Patients with allergies to metals or acrylics",
      "Not recommended for severe crowding or undercuts",
    ],
  },
  {
    code: "OD — Printed",
    name: "Nylon Printed",
    tag: "Digital fabrication",
    bullets: [
      "3D printed in biocompatible PA12 nylon",
      "Thin, comfortable, and durable",
      "Digitally archived — reprint without new records",
      "Ideal for patients with metal allergies",
    ],
  },
];

const NIGHT_ORTHOTICS = [
  {
    code: "ON-D",
    name: "Decompressor — Acrylic",
    Icon: Moon,
    summary:
      "Controls parafunctional activity and reduces the forces of clenching and grinding from chronic pain conditions.",
    bullets: [
      "Reduces inflammation (capsulitis)",
      "Indicated where there is no suspected apnea",
      "Digitally designed and 3D-printable in white biocompatible nylon",
      "Upper and lower elements disclosed with an anterior pad — crowded or worn teeth no longer a factor",
      "Digital fabrication allows a new appliance to be made if lost",
    ],
  },
  {
    code: "ON-P",
    name: "Positioner — PMT / Acrylic / Printed",
    Icon: Moon,
    summary:
      "Combines the deprogrammer with an anterior ring to position the mandible while supine. Improves airway patency when made in the phonetic position.",
    bullets: [
      "Indicated when there is suspected airway compromise or sleep disordered breathing",
      "Anterior ring provides space for the tongue at night",
      "Promotes forward mandibular movement",
      "Prevents locking in the supine position",
      "Improves airway and nasal obstruction",
      "Reduces clenching and grinding",
    ],
  },
];

const SYMPTOMS = [
  "Chronic recurring headaches",
  "Clicking, popping, or grating sounds in the jaw joints",
  "Earaches, congestion, or ringing in the ears",
  "Limited jaw opening or locking",
  "Neck and/or throat pain",
  "Difficulty closing the teeth together",
  "Pain behind the eyes",
  "Swallowing difficulty",
  "Pain in the tongue, gums, or cheek muscles",
  "Teeth grinding or clenching",
];

function Intro() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-intro]", {
        y: 30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 80%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="section-pad py-16 md:py-24 border-t border-surface-300/40">
      <div className="max-w-4xl mx-auto">
        <span
          data-intro
          className="font-mono text-xs text-ink/40 uppercase tracking-widest"
        >
          Olmos Series · TMD Orthotics
        </span>
        <h1
          data-intro
          className="mt-4 font-heading font-bold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[0.95] text-balance"
        >
          Orthotics,{" "}
          <span className="font-drama italic text-brand-500">
            not splints.
          </span>
        </h1>
        <p
          data-intro
          className="mt-6 text-ink/55 text-base md:text-lg max-w-2xl leading-relaxed"
        >
          The Olmos Series is designed to correct skeletal, muscular,
          tendon, and ligament asymmetries — restoring function and
          reducing symptoms rather than simply protecting teeth.
        </p>
      </div>
    </section>
  );
}

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
    { value: "Olmos", label: "Series Certified" },
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
              <div className="mt-2 font-mono text-xs text-ink/40 uppercase tracking-wider">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Definition() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-def]", {
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
    <section ref={ref} className="section-pad py-24 md:py-28 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <div className="mb-10 flex items-center gap-3">
          <span className="font-mono text-xs text-ink/40 uppercase tracking-widest">
            Splint vs. Orthotic
          </span>
          <div className="flex-1 h-px bg-surface-300/60" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          <div
            data-def
            className="bg-white card-radius p-8 md:p-10 border border-surface-300/50"
          >
            <span className="font-mono text-[10px] text-ink/40 uppercase tracking-widest">
              Splint
            </span>
            <div className="mt-3 font-drama italic text-2xl md:text-3xl text-ink/70 leading-snug">
              &ldquo;A rigid or flexible appliance used to maintain in
              position a displaced or mobile part, or to keep in place and
              protect an injured part.&rdquo;
            </div>
          </div>
          <div
            data-def
            className="bg-diamond-100 card-radius p-8 md:p-10 border border-ink-light"
          >
            <span className="font-mono text-[10px] text-brand-400 uppercase tracking-widest">
              Orthotic
            </span>
            <div className="mt-3 font-drama italic text-2xl md:text-3xl text-ink leading-snug">
              &ldquo;An orthopedic appliance used to support, align, prevent
              or correct deformities, or to improve the function of movable
              parts.&rdquo;
            </div>
            <div className="mt-6 text-ink/40 text-xs font-mono tracking-widest uppercase">
              What we build.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DayOrthotics() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-day-card]", {
        y: 40,
        opacity: 0,
        duration: 0.7,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 75%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="section-pad py-24 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="mb-10 md:mb-12 max-w-2xl">
          <div className="flex items-center gap-3 mb-4">
            <Sun size={16} className="text-accent-500" />
            <span className="font-mono text-xs text-ink/40 uppercase tracking-widest">
              Olmos Day Orthotics
            </span>
          </div>
          <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance">
            Worn during function.{" "}
            <span className="font-drama italic text-brand-500">
              Made in the phonetic position.
            </span>
          </h2>
          <p className="mt-5 text-ink/55 leading-relaxed">
            Indicated for chronic joint inflammation and disc displacement.
            Can function as a positioning stent, correcting vertical
            dimension, rotational cant, and protrusive changes. Lingual
            anatomic ridges guide disclusion and protect the contralateral
            joints in working movements.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6">
          {DAY_ORTHOTICS.map((o) => (
            <div
              key={o.code}
              data-day-card
              className="bg-white card-radius p-6 md:p-7 border border-surface-300/50 hover:border-brand-500/30 hover:shadow-lg hover:shadow-ink/5 transition-all duration-500 flex flex-col"
            >
              <span className="font-mono text-[10px] text-brand-500 uppercase tracking-widest">
                {o.code}
              </span>
              <h3 className="mt-2 font-heading font-bold text-xl tracking-tight">
                {o.name}
              </h3>
              <div className="mt-1 text-xs text-ink/40 italic">{o.tag}</div>
              <ul className="mt-5 space-y-2.5 flex-1">
                {o.bullets.map((b, i) => (
                  <li
                    key={i}
                    className="flex gap-2.5 text-sm text-ink/60 leading-snug"
                  >
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-brand-500 flex-shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function NightOrthotics() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-night-card]", {
        y: 40,
        opacity: 0,
        duration: 0.8,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 75%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="section-pad py-24 md:py-28 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <div className="mb-10 md:mb-12 max-w-2xl">
          <div className="flex items-center gap-3 mb-4">
            <Moon size={16} className="text-brand-500" />
            <span className="font-mono text-xs text-white/80 uppercase tracking-widest">
              Olmos Night Orthotics
            </span>
          </div>
          <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance">
            Worn supine.{" "}
            <span className="font-drama italic text-brand-500">
              Built for the airway.
            </span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {NIGHT_ORTHOTICS.map((o) => (
            <div
              key={o.code}
              data-night-card
              className="bg-diamond-100 card-radius p-8 md:p-10 border border-ink-light"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
                  <o.Icon size={18} className="text-brand-400" />
                </div>
                <span className="font-mono text-[10px] text-brand-400 uppercase tracking-widest">
                  {o.code}
                </span>
              </div>
              <h3 className="font-heading font-bold text-2xl md:text-3xl text-ink tracking-tight leading-tight">
                {o.name}
              </h3>
              <p className="mt-4 text-ink/50 text-sm md:text-base leading-relaxed">
                {o.summary}
              </p>
              <ul className="mt-6 space-y-3">
                {o.bullets.map((b, i) => (
                  <li key={i} className="flex gap-3 text-sm text-ink/60">
                    <CheckCircle2
                      size={14}
                      className="text-brand-400 flex-shrink-0 mt-1"
                    />
                    <span className="leading-snug">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Symptoms() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-sym]", {
        y: 20,
        opacity: 0,
        duration: 0.5,
        stagger: 0.03,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 80%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="section-pad py-24 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <AlertCircle size={16} className="text-accent-500" />
          <span className="font-mono text-xs text-ink/40 uppercase tracking-widest">
            Signs &amp; Symptoms of TMJ
          </span>
          <div className="flex-1 h-px bg-surface-300/60" />
        </div>
        <h2 className="font-heading font-bold text-3xl md:text-4xl tracking-tight max-w-2xl text-balance">
          One joint. Many{" "}
          <span className="font-drama italic text-brand-500">disguises.</span>
        </h2>
        <p className="mt-4 max-w-2xl text-ink/55 leading-relaxed">
          TMD transcends the boundaries of dentistry, neurology, physical
          therapy, and psychology. Symptoms often involve more than one of
          the numerous TMJ components: muscles, nerves, tendons, ligaments,
          bones, and connective tissue.
        </p>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SYMPTOMS.map((s) => (
            <div
              key={s}
              data-sym
              className="flex items-center gap-3 bg-white card-radius px-5 py-4 border border-surface-300/40"
            >
              <Activity size={14} className="text-brand-500 flex-shrink-0" />
              <span className="text-sm text-ink/70">{s}</span>
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
    const ctx = gsap.context(() => {
      gsap.from("[data-tmd-cta]", {
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
    <section ref={ref} className="section-pad py-24 md:py-28 bg-surface-100">
      <div className="max-w-3xl mx-auto text-center">
        <span
          data-tmd-cta
          className="font-mono text-xs text-ink/40 uppercase tracking-widest"
        >
          Ready to Order?
        </span>
        <h2
          data-tmd-cta
          className="mt-4 font-heading font-bold text-3xl md:text-5xl tracking-tight"
        >
          Start an Olmos case through the{" "}
          <span className="font-drama italic text-brand-500">
            Digital Rx form.
          </span>
        </h2>
        <p
          data-tmd-cta
          className="mt-6 text-ink/50 text-base md:text-lg max-w-lg mx-auto"
        >
          All Olmos TMD orthotics are Rx-only. Appliance selection is driven
          by comprehensive diagnosis — unsure which variant fits? We&apos;ll
          help you decide.
        </p>
        <div
          data-tmd-cta
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <Link
            to="/submit-case"
            className="btn-magnetic group px-8 py-4 rounded-full bg-brand-500 text-white font-semibold"
          >
            <span className="btn-bg bg-brand-600 rounded-full" />
            <span className="relative z-10 flex items-center gap-2">
              Submit Digital Rx
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform"
              />
            </span>
          </Link>
          <Link
            to="/contact"
            className="px-8 py-4 rounded-full border border-surface-300 text-ink/70 font-medium hover:bg-white transition-colors duration-300"
          >
            Talk to the Lab
          </Link>
        </div>
      </div>
    </section>
  );
}

export function TmdPage() {
  return (
    <>
      <ProductCatalog tabs={TMD_TABS} />
      <Intro />
      <Stats />
      <Definition />
      <DayOrthotics />
      <NightOrthotics />
      <Symptoms />
      <CTA />
    </>
  );
}
