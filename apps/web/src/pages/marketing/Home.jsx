import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  Scan,
  PenTool,
  Printer,
  ChevronRight,
  Activity,
  Shield,
  Moon,
  Clock,
} from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

/* ─── NOISE OVERLAY ─── */
function NoiseOverlay() {
  return (
    <svg className="noise-overlay" width="100%" height="100%">
      <filter id="noise">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.8"
          numOctaves="4"
          stitchTiles="stitch"
        />
      </filter>
      <rect width="100%" height="100%" filter="url(#noise)" />
    </svg>
  );
}

/* ─── HERO ─── */
function Hero() {
  const heroRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-hero-anim]", {
        y: 40,
        opacity: 0,
        duration: 1,
        stagger: 0.08,
        ease: "power3.out",
        delay: 0.3,
      });
      gsap.from("[data-hero-product]", {
        x: 80,
        opacity: 0,
        duration: 1.2,
        ease: "power3.out",
        delay: 0.6,
      });
    }, heroRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={heroRef}
      className="relative h-[100dvh] min-h-[600px] flex items-end overflow-hidden"
    >
      {/* Background stage */}
      <div className="absolute inset-0">
        <img
          src="/images/hero-stage-bg.webp"
          alt=""
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/30 to-transparent" />
      </div>

      {/* Product image */}
      <img
        data-hero-product
        src="/images/hero-ddso-reflection.webp"
        alt="DDSO orthotic device"
        className="absolute right-0 md:right-[5%] bottom-[-5%] w-[55%] md:w-[45%] max-w-[700px] h-auto object-contain z-[1] pointer-events-none"
      />

      {/* Content */}
      <div className="relative z-10 section-pad pb-16 md:pb-24 max-w-3xl">
        <div data-hero-anim className="mb-4">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 text-white/70 text-xs font-mono tracking-wider">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-500" />
            </span>
            OLMOS-METHOD CERTIFIED LAB
          </span>
        </div>

        <h1 data-hero-anim className="text-white">
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight leading-[0.95]">
            Precision is the
          </span>
          <span className="block font-drama italic text-6xl sm:text-7xl md:text-8xl lg:text-[10rem] tracking-tight leading-[0.85] text-brand-500">
            Protocol.
          </span>
        </h1>

        <p
          data-hero-anim
          className="mt-6 text-white/60 text-base md:text-lg max-w-lg leading-relaxed"
        >
          The only orthotic lab built around the Olmos Series system. Digital
          workflow. Clinical accuracy. Every appliance, every time.
        </p>

        <div data-hero-anim className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            to="/contact"
            className="btn-magnetic group px-7 py-3.5 rounded-full bg-accent-500 text-white font-semibold text-sm"
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
          <Link
            to="/products"
            className="px-7 py-3.5 rounded-full border border-white/20 text-white/80 font-medium text-sm hover:bg-white/10 transition-colors duration-300"
          >
            View Products
          </Link>
        </div>

        <div
          data-hero-anim
          className="mt-12 flex items-center gap-8 text-white/40 text-xs font-mono"
        >
          <span>Quality</span>
          <span className="w-1 h-1 rounded-full bg-white/20" />
          <span>Commitment</span>
          <span className="w-1 h-1 rounded-full bg-white/20" />
          <span>Accuracy</span>
          <span className="w-1 h-1 rounded-full bg-white/20" />
          <span>Efficiency</span>
        </div>
      </div>
    </section>
  );
}

/* ─── FEATURES ─── */

/* Card 1: Diagnostic Shuffler */
function DiagnosticShuffler() {
  const [order, setOrder] = useState([0, 1, 2]);

  useEffect(() => {
    const interval = setInterval(() => {
      setOrder((prev) => {
        const next = [...prev];
        next.unshift(next.pop());
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const cards = [
    {
      label: "Olmos Protocol Assessment",
      status: "Complete",
      color: "bg-brand-500",
    },
    {
      label: "Digital Articulation Review",
      status: "In Progress",
      color: "bg-accent-500",
    },
    {
      label: "Clinical Verification",
      status: "Pending",
      color: "bg-emerald-500",
    },
  ];

  return (
    <div className="bg-white card-radius p-6 md:p-8 border border-surface-300/50 shadow-sm hover:shadow-md transition-shadow duration-500 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <Shield size={16} className="text-brand-500" />
        <h3 className="font-heading font-bold text-base tracking-tight">
          Olmos-Method Expertise
        </h3>
      </div>
      <p className="text-navy/50 text-sm mb-6">
        The only lab built around the Olmos Series system. We understand the
        clinical protocol, not just the fabrication.
      </p>
      <div className="relative flex-1" style={{ minHeight: "140px" }}>
        {order.map((idx, pos) => (
          <div
            key={idx}
            className="absolute left-0 right-0 px-4 py-3 rounded-2xl border border-surface-300/50 shadow-sm transition-all duration-700"
            style={{
              top: pos * 8,
              zIndex: 3 - pos,
              opacity: pos === 0 ? 1 : 0.4 - pos * 0.15,
              transform: `scale(${1 - pos * 0.04})`,
              backgroundColor: pos === 0 ? "#FFFFFF" : "#F7F7F5",
              transitionTimingFunction:
                "cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            <div className="flex items-center justify-between" style={{ visibility: pos === 0 ? "visible" : "hidden" }}>
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full ${cards[idx].color}`}
                />
                <span className="text-sm font-medium text-navy/80">
                  {cards[idx].label}
                </span>
              </div>
              <span className="text-xs font-mono text-navy/40">
                {cards[idx].status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Card 2: Telemetry Typewriter */
function TelemetryTypewriter() {
  const [lines, setLines] = useState([]);
  const [currentLine, setCurrentLine] = useState("");
  const [charIndex, setCharIndex] = useState(0);
  const feedMessages = [
    "▸ Intraoral scan received — case #4012",
    "▸ CAD articulation parameters loaded",
    "▸ Olmos-Method bite registration verified",
    "▸ Material: Nylon PA12 — biocompatible",
    "▸ 3D print queue: position 2 of 8",
    "▸ Quality control: dimensional check passed",
    "▸ Appliance shipped — tracking generated",
    "▸ Digital workflow cycle: 4.2 days avg",
  ];
  const lineIndex = useRef(0);

  useEffect(() => {
    const msg = feedMessages[lineIndex.current % feedMessages.length];
    if (charIndex < msg.length) {
      const timeout = setTimeout(
        () => {
          setCurrentLine(msg.slice(0, charIndex + 1));
          setCharIndex(charIndex + 1);
        },
        20 + Math.random() * 30
      );
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => {
        setLines((prev) => [...prev.slice(-4), msg]);
        setCurrentLine("");
        setCharIndex(0);
        lineIndex.current += 1;
      }, 1200);
      return () => clearTimeout(timeout);
    }
  }, [charIndex]);

  return (
    <div className="bg-white card-radius p-6 md:p-8 border border-surface-300/50 shadow-sm hover:shadow-md transition-shadow duration-500 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <Activity size={16} className="text-brand-500" />
        <h3 className="font-heading font-bold text-base tracking-tight">
          Digital-First Precision
        </h3>
      </div>
      <p className="text-navy/50 text-sm mb-4">
        Full digital workflow. No analog guesswork. Consistent, accurate
        appliances with fast turnaround.
      </p>
      <div className="flex-1 bg-navy/[0.03] rounded-2xl p-4 font-mono text-xs overflow-hidden">
        {lines.map((line, i) => (
          <div key={i} className="text-navy/40 leading-relaxed truncate">
            {line}
          </div>
        ))}
        <div className="text-navy/80 leading-relaxed">
          {currentLine}
          <span className="inline-block w-1.5 h-3.5 bg-brand-500 ml-0.5 animate-pulse rounded-sm" />
        </div>
      </div>
    </div>
  );
}

/* Card 3: TMJ + Sleep Under One Roof */
function TMJSleepCard() {
  const [phase, setPhase] = useState(0); // 0=TMJ visible, 1=Sleep visible

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase((prev) => (prev === 0 ? 1 : 0));
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-white card-radius p-6 md:p-8 border border-surface-300/50 shadow-sm hover:shadow-md transition-shadow duration-500 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <Moon size={16} className="text-brand-500" />
        <h3 className="font-heading font-bold text-base tracking-tight">
          TMJ + Sleep Under One Roof
        </h3>
      </div>
      <p className="text-navy/50 text-sm mb-4">
        Dual specialization in TMD orthotics and FDA-cleared sleep appliances.
        One lab, every case.
      </p>
      <div className="flex-1 bg-navy/[0.03] rounded-2xl p-5 overflow-hidden min-h-[140px] flex flex-col items-center justify-center">
        {/* SVG illustration: TMJ and Sleep side by side */}
        <div className="flex items-center justify-center gap-6 w-full">
          {/* TMJ figure */}
          <div className={`flex flex-col items-center transition-all duration-700 ${phase === 0 ? "opacity-100 scale-100" : "opacity-30 scale-95"}`}>
            <svg viewBox="0 0 80 90" className="w-16 h-20" fill="none">
              {/* Head */}
              <circle cx="40" cy="28" r="18" stroke="#0B1A2E" strokeWidth="1.5" fill="none" />
              {/* Jaw - offset to show pain */}
              <path d="M28 36 Q40 52 52 36" stroke="#0B1A2E" strokeWidth="1.5" fill="none" />
              {/* Pain lines */}
              <g className={`transition-opacity duration-500 ${phase === 0 ? "opacity-100" : "opacity-0"}`}>
                <line x1="58" y1="28" x2="66" y2="24" stroke="#E63B2E" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="58" y1="33" x2="68" y2="33" stroke="#E63B2E" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="58" y1="38" x2="66" y2="42" stroke="#E63B2E" strokeWidth="1.5" strokeLinecap="round" />
              </g>
              {/* Shoulders */}
              <path d="M20 58 Q40 48 60 58" stroke="#0B1A2E" strokeWidth="1.5" fill="none" />
              {/* Eyes - squinting in pain */}
              <line x1="33" y1="25" x2="37" y2="25" stroke="#0B1A2E" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="43" y1="25" x2="47" y2="25" stroke="#0B1A2E" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className={`mt-2 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all duration-500 ${
              phase === 0 ? "bg-brand-500 text-white" : "bg-surface-200/60 text-navy/30"
            }`}>
              TMD
            </span>
          </div>

          {/* Divider */}
          <div className="flex flex-col items-center gap-1">
            <div className="w-px h-12 bg-navy/10" />
            <span className="text-[9px] font-mono text-navy/20">+</span>
            <div className="w-px h-12 bg-navy/10" />
          </div>

          {/* Sleep figure */}
          <div className={`flex flex-col items-center transition-all duration-700 ${phase === 1 ? "opacity-100 scale-100" : "opacity-30 scale-95"}`}>
            <svg viewBox="0 0 80 90" className="w-16 h-20" fill="none">
              {/* Head - tilted on pillow */}
              <circle cx="38" cy="30" r="18" stroke="#0B1A2E" strokeWidth="1.5" fill="none" />
              {/* Closed eyes */}
              <path d="M31 27 Q34 29 37 27" stroke="#0B1A2E" strokeWidth="1.5" fill="none" />
              <path d="M41 27 Q44 29 47 27" stroke="#0B1A2E" strokeWidth="1.5" fill="none" />
              {/* Open mouth - snoring */}
              <ellipse cx="39" cy="37" rx="4" ry="3" stroke="#0B1A2E" strokeWidth="1.5" fill="none" />
              {/* Z's */}
              <g className={`transition-opacity duration-500 ${phase === 1 ? "opacity-100" : "opacity-0"}`}>
                <text x="56" y="18" fill="#13AEEF" fontSize="11" fontWeight="700" fontFamily="IBM Plex Mono, monospace">Z</text>
                <text x="63" y="10" fill="#13AEEF" fontSize="8" fontWeight="700" fontFamily="IBM Plex Mono, monospace" opacity="0.6">Z</text>
                <text x="68" y="4" fill="#13AEEF" fontSize="6" fontWeight="700" fontFamily="IBM Plex Mono, monospace" opacity="0.3">Z</text>
              </g>
              {/* Shoulders */}
              <path d="M18 58 Q38 48 58 58" stroke="#0B1A2E" strokeWidth="1.5" fill="none" />
            </svg>
            <span className={`mt-2 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all duration-500 ${
              phase === 1 ? "bg-accent-500 text-white" : "bg-surface-200/60 text-navy/30"
            }`}>
              Sleep
            </span>
          </div>
        </div>

        {/* "One Roof" bar */}
        <div className="mt-4 w-full flex items-center gap-2">
          <div className="flex-1 h-px bg-navy/10" />
          <span className="text-[9px] font-mono text-navy/25 uppercase tracking-widest">One Lab · Every Case</span>
          <div className="flex-1 h-px bg-navy/10" />
        </div>
      </div>
    </div>
  );
}

/* Card 4: Turnaround Timeline */
function TurnaroundTimeline() {
  const [filledDays, setFilledDays] = useState(0);
  const [activeLabel, setActiveLabel] = useState("");

  const totalDays = 10; // 2 weeks of weekdays
  const milestones = [
    { day: 1, label: "Order Received" },
    { day: 3, label: "Processing" },
    { day: 5, label: "Printing" },
    { day: 7, label: "Customizing" },
    { day: 9, label: "Shipping" },
    { day: 10, label: "Arrived!" },
  ];
  const isComplete = filledDays >= totalDays;

  useEffect(() => {
    let running = true;
    const runAnimation = async () => {
      while (running) {
        // Reset
        setFilledDays(0);
        setActiveLabel("");
        await wait(1000);
        if (!running) break;
        // Fill days sequentially over ~5 seconds
        for (let d = 0; d <= totalDays; d++) {
          if (!running) break;
          setFilledDays(d);
          const milestone = milestones.find((m) => m.day === d);
          if (milestone) setActiveLabel(milestone.label);
          await wait(450);
        }
        if (!running) break;
        // Hold on "Arrived!" for a beat
        await wait(3000);
      }
    };
    runAnimation();
    return () => { running = false; };
  }, []);

  const week1 = ["M", "T", "W", "T", "F"];
  const week2 = ["M", "T", "W", "T", "F"];

  return (
    <div className="bg-white card-radius p-6 md:p-8 border border-surface-300/50 shadow-sm hover:shadow-md transition-shadow duration-500 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <Clock size={16} className="text-brand-500" />
        <h3 className="font-heading font-bold text-base tracking-tight">
          2-Week Turnaround
        </h3>
      </div>
      <p className="text-navy/50 text-sm mb-4">
        From scan to delivery in 10 business days or less. No shortcuts — just
        an efficient digital pipeline.
      </p>
      <div className="flex-1 bg-navy/[0.03] rounded-2xl p-4 overflow-hidden min-h-[140px] flex flex-col justify-between">
        {/* Week rows */}
        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <span className="text-[10px] font-mono text-navy/30 uppercase">Week 1</span>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {week1.map((day, i) => {
                const dayIndex = i;
                const isFilled = dayIndex < filledDays;
                const isCurrent = dayIndex === filledDays - 1;
                return (
                  <div
                    key={i}
                    className={`h-7 rounded-lg flex items-center justify-center text-[10px] font-medium transition-all duration-200 ${
                      isComplete
                        ? "bg-emerald-500 text-white"
                        : isCurrent
                        ? "bg-brand-500 text-white ring-2 ring-brand-500/30 scale-105"
                        : isFilled
                        ? "bg-brand-500/80 text-white"
                        : "bg-surface-200/60 text-navy/30"
                    }`}
                  >
                    {day}
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <span className="text-[10px] font-mono text-navy/30 uppercase">Week 2</span>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {week2.map((day, i) => {
                const dayIndex = i + 5;
                const isFilled = dayIndex < filledDays;
                const isCurrent = dayIndex === filledDays - 1;
                return (
                  <div
                    key={i}
                    className={`h-7 rounded-lg flex items-center justify-center text-[10px] font-medium transition-all duration-200 ${
                      isComplete
                        ? "bg-emerald-500 text-white"
                        : isCurrent
                        ? "bg-brand-500 text-white ring-2 ring-brand-500/30 scale-105"
                        : isFilled
                        ? "bg-brand-500/80 text-white"
                        : "bg-surface-200/60 text-navy/30"
                    }`}
                  >
                    {day}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Active milestone label */}
        <div className="mt-3 flex items-center justify-center">
          <span
            className={`px-3 py-1.5 rounded-full text-[10px] font-semibold transition-all duration-300 ${
              activeLabel === "Arrived!"
                ? "bg-emerald-500 text-white"
                : activeLabel
                ? "bg-brand-500/10 text-brand-500"
                : "bg-transparent text-transparent"
            }`}
          >
            {activeLabel || "\u00A0"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Features() {
  const sectionRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-feature-card]", {
        y: 60,
        opacity: 0,
        duration: 0.8,
        stagger: 0.15,
        ease: "power3.out",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 75%",
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="section-pad py-24 md:py-32">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 md:mb-16">
          <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            Why Diamond
          </span>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-4xl tracking-tight text-balance">
            Built for the protocol.
            <br />
            <span className="text-brand-500">Not just the appliance.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div data-feature-card>
            <DiagnosticShuffler />
          </div>
          <div data-feature-card>
            <TelemetryTypewriter />
          </div>
          <div data-feature-card>
            <TMJSleepCard />
          </div>
          <div data-feature-card>
            <TurnaroundTimeline />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── PHILOSOPHY ─── */
function Philosophy() {
  const sectionRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-phil]", {
        y: 30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 65%" },
      });
      gsap.from("[data-phil-stat]", {
        y: 20,
        opacity: 0,
        duration: 0.6,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 50%" },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  const stats = [
    { value: "100%", label: "Digital Workflow" },
    { value: "<2wk", label: "Turnaround" },
    { value: "FDA", label: "510(k) Cleared" },
    { value: "50+", label: "Certified Labs" },
  ];

  return (
    <section
      ref={sectionRef}
      className="relative bg-navy overflow-hidden"
    >
      {/* Background layers */}
      <div className="absolute inset-0 opacity-[0.06]">
        <img
          src="https://images.unsplash.com/photo-1530497610245-94d3c16cda28?auto=format&fit=crop&w=1920&q=80"
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-navy via-transparent to-navy" />

      {/* Lottie animation — right side */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none hidden md:block">
        <iframe
          src="https://cdn.lottielab.com/l/Bqd8dkXRTJHiWh.html?speed=0.5"
          width="750"
          height="750"
          style={{ border: "none" }}
          loading="lazy"
          title="Decorative animation"
        />
      </div>

      <div className="relative z-10 section-pad py-28 md:py-40">
        <div className="max-w-6xl mx-auto">
          {/* Top label */}
          <div data-phil className="mb-6">
            <span className="font-mono text-[10px] text-white/25 uppercase tracking-[0.2em]">
              Our Philosophy
            </span>
          </div>

          <div data-phil className="mt-8">
            <h2 className="font-drama italic text-3xl sm:text-4xl md:text-5xl text-white leading-[1.1] tracking-tight">
              <span className="text-brand-400">Protocol-driven</span> precision
              for every{" "}
              <span className="relative inline-block">
                case
                <span className="absolute -bottom-1 left-0 w-full h-0.5 bg-accent-500 rounded-full" />
              </span>
              .
            </h2>
          </div>

          {/* Supporting text */}
          <div data-phil className="mt-10 md:mt-14 max-w-xl">
            <p className="text-white/40 text-sm md:text-base leading-relaxed">
              Every orthotic we fabricate follows the Olmos-Method protocol
              — digitally designed, SLS-printed to sub-millimeter tolerance,
              and quality-checked before it leaves our lab.
            </p>
          </div>

          {/* Stat bar */}
          <div className="mt-16 md:mt-20 pt-10 border-t border-white/10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
              {stats.map((s, i) => (
                <div key={i} data-phil-stat>
                  <span className="block font-heading font-bold text-3xl md:text-4xl text-white tracking-tight">
                    {s.value}
                  </span>
                  <span className="block font-mono text-[10px] text-white/30 uppercase tracking-wider mt-1">
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── STICKY PROTOCOL ─── */
function Protocol() {
  const sectionRef = useRef(null);
  const panelsRef = useRef([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const total = panelsRef.current.length;

      panelsRef.current.forEach((panel, i) => {
        // Pin ALL cards (including last)
        ScrollTrigger.create({
          trigger: panel,
          start: "top top",
          pin: true,
          pinSpacing: i === total - 1, // last card gets real spacing so it holds
          ...(i < total - 1
            ? {
                endTrigger: panelsRef.current[total - 1],
                end: "top top",
              }
            : {
                end: "+=50%", // last card holds for 50vh of scroll
              }),
        });

        // Fade/blur out all except the last card
        if (i < total - 1) {
          gsap.to(panel, {
            scale: 0.9,
            filter: "blur(12px)",
            opacity: 0.5,
            scrollTrigger: {
              trigger: panelsRef.current[i + 1],
              start: "top 60%",
              end: "top top",
              scrub: true,
            },
          });

          // Hide the pinned card once the next card fully arrives
          ScrollTrigger.create({
            trigger: panelsRef.current[i + 1],
            start: "top top",
            onEnter: () => (panel.style.visibility = "hidden"),
            onLeaveBack: () => (panel.style.visibility = "visible"),
          });
        }
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  const steps = [
    {
      step: "01",
      title: "Scan",
      desc: "Intraoral digital capture eliminates traditional impressions. Precision data from the first touch.",
      Icon: Scan,
      animation: <RotatingGeometry />,
    },
    {
      step: "02",
      title: "Design",
      desc: "CAD articulation with Olmos-Method parameters. Every micron calculated, every occlusal surface mapped.",
      Icon: PenTool,
      animation: <ScanningGrid />,
    },
    {
      step: "03",
      title: "Fabricate",
      desc: "3D printed in clinical-grade materials. Quality verified. Shipped with tracking and care kit.",
      Icon: Printer,
      animation: <PulsingWaveform />,
    },
  ];

  return (
    <section ref={sectionRef} className="relative">
      {steps.map((step, i) => (
        <div key={i}>
          {/* Spacer between cards gives scroll room for the "hold" */}
          {i > 0 && <div className="h-[40vh]" />}
          <div
            ref={(el) => (panelsRef.current[i] = el)}
            className="h-screen flex items-center justify-center"
            style={{ zIndex: i + 1 }}
          >
            <div className="section-pad w-full max-w-6xl mx-auto">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                <div>
                  <span className="font-mono text-brand-500 text-sm mb-4 block">
                    {step.step}
                  </span>
                  <h3 className="font-heading font-bold text-4xl md:text-6xl tracking-tight mb-4">
                    {step.title}
                  </h3>
                  <p className="text-navy/50 text-lg max-w-md leading-relaxed">
                    {step.desc}
                  </p>
                </div>
                <div className="flex items-center justify-center">
                  <div className="w-72 h-72 md:w-96 md:h-96 rounded-[3rem] flex items-center justify-center overflow-hidden">
                    {step.animation}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

/* SVG animations for protocol cards */
function RotatingGeometry() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.to("[data-rotate]", {
        rotation: 360,
        duration: 20,
        repeat: -1,
        ease: "none",
        transformOrigin: "center center",
      });
      gsap.to("[data-rotate-reverse]", {
        rotation: -360,
        duration: 30,
        repeat: -1,
        ease: "none",
        transformOrigin: "center center",
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 200 200"
      className="w-48 h-48 md:w-64 md:h-64"
    >
      <g data-rotate>
        <circle
          cx="100"
          cy="100"
          r="60"
          fill="none"
          stroke="#13AEEF"
          strokeWidth="0.5"
          opacity="0.4"
        />
        <circle
          cx="100"
          cy="100"
          r="45"
          fill="none"
          stroke="#13AEEF"
          strokeWidth="0.5"
          opacity="0.3"
        />
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <circle
            key={angle}
            cx={100 + 60 * Math.cos((angle * Math.PI) / 180)}
            cy={100 + 60 * Math.sin((angle * Math.PI) / 180)}
            r="3"
            fill="#13AEEF"
            opacity="0.6"
          />
        ))}
      </g>
      <g data-rotate-reverse>
        <rect
          x="65"
          y="65"
          width="70"
          height="70"
          fill="none"
          stroke="#13AEEF"
          strokeWidth="0.5"
          opacity="0.2"
          rx="4"
        />
        <rect
          x="78"
          y="78"
          width="44"
          height="44"
          fill="none"
          stroke="#13AEEF"
          strokeWidth="0.5"
          opacity="0.3"
          rx="4"
        />
      </g>
      <circle cx="100" cy="100" r="4" fill="#13AEEF" opacity="0.8" />
    </svg>
  );
}

function ScanningGrid() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.to("[data-scan-line]", {
        y: 160,
        duration: 2.5,
        repeat: -1,
        ease: "power1.inOut",
        yoyo: true,
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  const dots = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      dots.push(
        <circle
          key={`${row}-${col}`}
          cx={40 + col * 17}
          cy={20 + row * 20}
          r="2"
          fill="#13AEEF"
          opacity="0.15"
        />
      );
    }
  }

  return (
    <svg
      ref={ref}
      viewBox="0 0 200 200"
      className="w-48 h-48 md:w-64 md:h-64"
    >
      {dots}
      <line
        data-scan-line
        x1="30"
        y1="20"
        x2="170"
        y2="20"
        stroke="#13AEEF"
        strokeWidth="1"
        opacity="0.6"
      />
      <rect
        data-scan-line
        x="30"
        y="12"
        width="140"
        height="16"
        fill="url(#scanGradient)"
      />
      <defs>
        <linearGradient id="scanGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#13AEEF" stopOpacity="0" />
          <stop offset="50%" stopColor="#13AEEF" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#13AEEF" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function PulsingWaveform() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.to("[data-waveform]", {
        strokeDashoffset: -400,
        duration: 3,
        repeat: -1,
        ease: "none",
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 200 100"
      className="w-48 h-24 md:w-64 md:h-32"
    >
      <path
        data-waveform
        d="M0,50 L20,50 L25,50 L30,20 L35,80 L40,30 L45,70 L50,45 L55,55 L60,50 L80,50 L85,50 L90,15 L95,85 L100,25 L105,75 L110,40 L115,60 L120,50 L140,50 L145,50 L150,20 L155,80 L160,30 L165,70 L170,45 L175,55 L180,50 L200,50"
        fill="none"
        stroke="#13AEEF"
        strokeWidth="1.5"
        strokeDasharray="200"
        strokeDashoffset="0"
        opacity="0.6"
      />
      <path
        d="M0,50 L200,50"
        fill="none"
        stroke="#13AEEF"
        strokeWidth="0.3"
        opacity="0.2"
      />
    </svg>
  );
}

/* ─── CTA SECTION ─── */
function CTASection() {
  const sectionRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-cta-anim]", {
        y: 40,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 75%",
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="section-pad py-24 md:py-32">
      <div className="max-w-4xl mx-auto text-center">
        <span
          data-cta-anim
          className="font-mono text-xs text-navy/40 uppercase tracking-widest"
        >
          Partner With Us
        </span>
        <h2
          data-cta-anim
          className="mt-4 font-heading font-bold text-3xl md:text-5xl tracking-tight"
        >
          Get the best for your
          <br />
          <span className="font-drama italic text-brand-500">
            patients.
          </span>
        </h2>
        <p
          data-cta-anim
          className="mt-6 text-navy/50 text-lg max-w-xl mx-auto leading-relaxed"
        >
          Whether you&apos;re treating TMJ disorders, sleep breathing
          conditions, or both — we&apos;re the lab that understands your
          protocol.
        </p>
        <div data-cta-anim className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/contact"
            className="btn-magnetic group px-8 py-4 rounded-full bg-accent-500 text-white font-semibold"
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
          <Link
            to="/products"
            className="px-8 py-4 rounded-full border border-surface-300 text-navy/70 font-medium hover:bg-surface-200/60 transition-colors duration-300"
          >
            View All Products
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─── UTILITY ─── */
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ─── PAGE EXPORT ─── */
export function HomePage() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <>
      <NoiseOverlay />
      <Hero />
      <Features />
      <Philosophy />
      <Protocol />
      <CTASection />
    </>
  );
}
