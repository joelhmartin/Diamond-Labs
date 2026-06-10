import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { playOnView } from "../../lib/playOnView";
import {
  ArrowRight,
  Scan,
  PenTool,
  Printer,
  ShieldCheck,
  Truck,
  Layers,
  FileSignature,
  Archive,
  Gauge,
} from "lucide-react";

const PIPELINE = [
  {
    step: "01",
    Icon: Scan,
    title: "Intraoral Scan",
    body: "Digital capture from your scanner (Medit, iTero, 3Shape, Primescan) eliminates traditional impressions. We accept STL and native files.",
    detail: "Submitted via Digital Rx portal · HIPAA-compliant upload",
  },
  {
    step: "02",
    Icon: FileSignature,
    title: "Digital Bite Registration",
    body: "Captured in the phonetic position for Olmos Day appliances. Hammular notches and incisive papilla preserved for D3D-Matrix mounting.",
    detail: "Phonetic bite · Articulator transfer",
  },
  {
    step: "03",
    Icon: PenTool,
    title: "CAD Articulation",
    body: "Each case designed in CAD with Olmos-Method parameters — vertical dimension, rotation, cant, and protrusion all calculated per protocol.",
    detail: "Every micron calculated · Every occlusal surface mapped",
  },
  {
    step: "04",
    Icon: Printer,
    title: "SLS Fabrication",
    body: "3D printed in biocompatible PA12 nylon at sub-millimeter tolerance. Thin, comfortable, durable — and digitally archived for reprint.",
    detail: "Material: MED-Grade PA2200 · Process: Selective Laser Sintering",
  },
  {
    step: "05",
    Icon: ShieldCheck,
    title: "Quality Verification",
    body: "Dimensional check against the design file. Every appliance verified before it leaves the lab.",
    detail: "Dimensional QA · Finishing · Sterilization",
  },
  {
    step: "06",
    Icon: Truck,
    title: "Ship with Tracking",
    body: "Shipped with tracking, a care kit, and insertion instructions. Delivery notification sent to your practice.",
    detail: "FedEx · Tracking generated automatically",
  },
];

const ADVANTAGES = [
  {
    Icon: Archive,
    title: "Digital Reprint — No New Records",
    body: "Every case is digitally archived. Lost, broken, or worn appliances can be reprinted from the original design without re-scanning the patient.",
  },
  {
    Icon: Gauge,
    title: "10-Business-Day Turnaround",
    body: "End-to-end digital pipeline delivers a finished appliance from receipt to ship in under 2 weeks — no analog bottlenecks.",
  },
  {
    Icon: Layers,
    title: "Protocol-Consistent Output",
    body: "Computer-aided articulation means every technician, every shift, produces an appliance built to the same Olmos-Method parameters.",
  },
];

function Hero() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-dw-hero]", {
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
          src="https://images.unsplash.com/photo-1581093588401-fbb62a02f120?auto=format&fit=crop&w=1920&q=80"
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
          data-dw-hero
          className="font-mono text-xs text-white/40 uppercase tracking-widest"
        >
          Digital Workflow
        </span>
        <h1 data-dw-hero className="mt-4 text-white">
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[0.95]">
            Scan to ship
          </span>
          <span className="block font-drama italic text-6xl sm:text-7xl md:text-9xl tracking-tight leading-[0.88] text-brand-500">
            in 10 days.
          </span>
        </h1>
        <p
          data-dw-hero
          className="mt-6 text-white/50 text-base md:text-lg max-w-xl leading-relaxed"
        >
          Full digital fabrication pipeline. No analog guesswork. Every
          appliance archived, every occlusal surface calculated, every
          turnaround predictable.
        </p>
        </div>
      </div>
    </section>
  );
}

function PipelineStats() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-dw-stat]",
        { y: 20, opacity: 0 },
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

  const items = [
    { value: "100%", label: "Digital Workflow" },
    { value: "<2wk", label: "Turnaround" },
    { value: "6", label: "Pipeline Stages" },
    { value: "∞", label: "Digital Reprints" },
  ];

  return (
    <section ref={ref} className="section-pad py-16 md:py-20 bg-navy border-b border-white/10">
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
        {items.map((s, i) => (
          <div key={i} data-dw-stat>
            <span className="block font-heading font-bold text-3xl md:text-4xl text-white tracking-tight">
              {s.value}
            </span>
            <span className="block font-mono text-[10px] text-white/30 uppercase tracking-wider mt-1">
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pipeline() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-stage]",
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.7,
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
    <section ref={ref} className="section-pad py-24 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 md:mb-16 max-w-2xl">
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            Pipeline
          </span>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance">
            Every case, the same{" "}
            <span className="font-drama italic text-brand-500">
              six stages.
            </span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
          {PIPELINE.map((s) => (
            <div
              key={s.step}
              data-stage
              className="group bg-white card-radius p-6 md:p-7 border border-surface-300/50 hover:border-brand-500/30 hover:shadow-lg hover:shadow-navy/5 transition-all duration-500"
            >
              <div className="flex items-center justify-between mb-5">
                <span className="font-mono text-[11px] text-brand-500 tracking-widest">
                  {s.step}
                </span>
                <div className="w-10 h-10 rounded-2xl bg-surface-100 border border-surface-300/50 flex items-center justify-center group-hover:bg-brand-500 group-hover:border-brand-500 transition-all duration-500">
                  <s.Icon
                    size={16}
                    className="text-navy/60 group-hover:text-white transition-colors duration-500"
                  />
                </div>
              </div>
              <h3 className="font-heading font-bold text-xl tracking-tight">
                {s.title}
              </h3>
              <p className="mt-2 text-navy/55 text-sm leading-relaxed">
                {s.body}
              </p>
              <div className="mt-5 pt-5 border-t border-surface-300/50 text-[11px] font-mono text-navy/35 tracking-wide leading-relaxed">
                {s.detail}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Advantages() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-adv]",
        { y: 30, opacity: 0 },
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
    <section ref={ref} className="section-pad py-24 md:py-28 bg-surface-100">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 md:mb-16 max-w-2xl">
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            Why Digital
          </span>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance">
            What you gain when the pipeline is{" "}
            <span className="font-drama italic text-brand-500">
              end-to-end digital.
            </span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {ADVANTAGES.map((a) => (
            <div
              key={a.title}
              data-adv
              className="bg-navy text-white card-radius p-8 border border-navy-light"
            >
              <div className="w-11 h-11 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mb-6">
                <a.Icon size={18} className="text-brand-400" />
              </div>
              <h3 className="font-heading font-bold text-xl tracking-tight text-white">
                {a.title}
              </h3>
              <p className="mt-3 text-white/55 text-sm md:text-base leading-relaxed">
                {a.body}
              </p>
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
        "[data-dw-cta]",
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
          data-dw-cta
          className="font-mono text-xs text-navy/40 uppercase tracking-widest"
        >
          Start a Case
        </span>
        <h2
          data-dw-cta
          className="mt-4 font-heading font-bold text-3xl md:text-5xl tracking-tight"
        >
          Got a scan?{" "}
          <span className="font-drama italic text-brand-500">
            Send it over.
          </span>
        </h2>
        <p
          data-dw-cta
          className="mt-6 text-navy/50 text-base md:text-lg max-w-lg mx-auto"
        >
          Upload through the Digital Rx portal and we&apos;ll confirm receipt
          within one business day.
        </p>
        <div
          data-dw-cta
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
            to="/resources/rx-instructions"
            className="px-8 py-4 rounded-full border border-surface-300 text-navy/70 font-medium hover:bg-surface-200/60 transition-colors duration-300"
          >
            Rx Instructions
          </Link>
        </div>
      </div>
    </section>
  );
}

export function DigitalWorkflowPage() {
  return (
    <>
      <Hero />
      <PipelineStats />
      <Pipeline />
      <Advantages />
      <CTA />
    </>
  );
}
