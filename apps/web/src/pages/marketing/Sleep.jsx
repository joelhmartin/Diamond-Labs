import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { ProductCatalog } from "../../components/marketing/ProductCatalog";

gsap.registerPlugin(ScrollTrigger);

const SLEEP_TABS = [
  { key: "ddsoAnt",  label: "DDSO — Anterior",  sub: "Sleep Appliance" },
  { key: "ddsoPost", label: "DDSO — Posterior", sub: "Sleep Appliance" },
];

const CORE_FEATURES = [
  {
    title: "Mandibular Repositioning",
    body: "Brings the base of the tongue forward, opening the oropharynx and strengthening the upper airway — greater resistance to airway collapse.",
  },
  {
    title: "MED-Grade Elastomeric Straps",
    body: "Allow lateral movement and prevent retrusion of the mandible. Available in a range of sizes and elasticity to provide useful feedback.",
  },
  {
    title: "Maximum Intraoral Volume",
    body: "Dual action of mandibular repositioning while maintaining maximum intraoral space for the tongue.",
  },
  {
    title: "Biocompatible PA2200 Nylon",
    body: "MED-Grade nylon allows a thin and comfortable device with unmatched durability.",
  },
  {
    title: "Reduced Forces on Teeth",
    body: "Delivered with an upper and lower splint that distributes forces throughout both arches.",
  },
  {
    title: "5-Year Unconditional Warranty",
    body: "Every DDSO ships with a 5-year warranty. Digital design allows replacements to be made without new records.",
  },
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
          className="font-mono text-xs text-navy/40 uppercase tracking-widest"
        >
          Sleep Appliances · FDA-Cleared
        </span>
        <h1
          data-intro
          className="mt-4 font-heading font-bold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[0.95] text-balance"
        >
          Mandibular advancement,{" "}
          <span className="font-drama italic text-brand-500">engineered.</span>
        </h1>
        <p
          data-intro
          className="mt-6 text-navy/55 text-base md:text-lg max-w-2xl leading-relaxed"
        >
          The Diamond Digital Sleep Orthotic (DDSO) is a custom CAD/CAM
          device for snoring and mild-to-moderate OSA in adults. Two
          configurations, four design options, fully digital.
        </p>
      </div>
    </section>
  );
}

function CoreFeatures() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-feat]", {
        y: 30,
        opacity: 0,
        duration: 0.6,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 75%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="section-pad py-24 md:py-28 bg-navy text-white">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 md:mb-16 max-w-2xl">
          <span className="font-mono text-xs text-white/40 uppercase tracking-widest">
            Core Features &amp; Benefits
          </span>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance">
            Built around the{" "}
            <span className="font-drama italic text-brand-400">airway.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
          {CORE_FEATURES.map((f) => (
            <div
              key={f.title}
              data-feat
              className="card-radius p-6 md:p-7 bg-navy-light border border-white/10"
            >
              <div className="flex gap-3">
                <CheckCircle2
                  size={16}
                  className="text-brand-400 flex-shrink-0 mt-0.5"
                />
                <div>
                  <h3 className="font-heading font-semibold text-base text-white tracking-tight">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-white/55 text-sm leading-relaxed">
                    {f.body}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-12 max-w-3xl text-[11px] font-mono text-white/30 leading-relaxed">
          FDA 510(k) cleared for the treatment of snoring and/or obstructive
          sleep apnea in adults. Additional modifications and attachments
          have not been reviewed or cleared by the FDA for the treatment of
          OSA.
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
    { value: "FDA", label: "510(k) Cleared" },
    { value: "5-yr", label: "Warranty" },
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

function CTA() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-sleep-cta]", {
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
    <section ref={ref} className="section-pad py-24 md:py-32">
      <div className="max-w-3xl mx-auto text-center">
        <span
          data-sleep-cta
          className="font-mono text-xs text-navy/40 uppercase tracking-widest"
        >
          Ready to Order?
        </span>
        <h2
          data-sleep-cta
          className="mt-4 font-heading font-bold text-3xl md:text-5xl tracking-tight"
        >
          Start a DDSO case through the{" "}
          <span className="font-drama italic text-brand-500">
            Digital Rx form.
          </span>
        </h2>
        <p
          data-sleep-cta
          className="mt-6 text-navy/50 text-base md:text-lg max-w-lg mx-auto"
        >
          All DDSO devices are Rx-only. Upload scans and Rx details through
          the HIPAA-compliant submission portal.
        </p>
        <div
          data-sleep-cta
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <Link
            to="/submit-case"
            className="btn-magnetic group px-8 py-4 rounded-full bg-accent-500 text-white font-semibold"
          >
            <span className="btn-bg bg-accent-600 rounded-full" />
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
            className="px-8 py-4 rounded-full border border-surface-300 text-navy/70 font-medium hover:bg-surface-200/60 transition-colors duration-300"
          >
            Talk to the Lab
          </Link>
        </div>
      </div>
    </section>
  );
}

export function SleepPage() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <>
      <ProductCatalog tabs={SLEEP_TABS} />
      <Intro />
      <Stats />
      <CoreFeatures />
      <CTA />
    </>
  );
}
