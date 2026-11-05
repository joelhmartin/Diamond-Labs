import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { playOnView } from "../../lib/playOnView";
import { HeroStage } from "../../components/marketing/HeroStage";
import { CtaBand } from "../../components/marketing/CtaBand.jsx";
import { RotatingGeometry, ScanningGrid, PulsingWaveform } from "../../components/marketing/ProtocolAnimations.jsx";
import LottiePlayer from "../../components/ui/LottiePlayer";
import {
  ArrowRight,
  ChevronRight,
  Activity,
  Shield,
  Moon,
  Clock,
} from "lucide-react";


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
      className="relative min-h-[100dvh] flex items-end overflow-hidden section-pad"
    >
      <HeroStage />

      {/* Content */}
      <div className="relative z-10 pt-44 pb-12 md:pt-48 md:pb-16 lg:pt-36 lg:pb-24 w-full max-w-6xl mx-auto">
        <div className="max-w-3xl">
        <div data-hero-anim className="mb-4">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-on-dark/70 font-mono text-xs font-semibold tracking-wider shadow-sm">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-500" />
            </span>
            TMD & SLEEP ORTHOTIC LAB
          </span>
        </div>

        <h1 data-hero-anim className="text-on-dark">
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight leading-[0.95]">
            Precision is the
          </span>
          <span className="block font-drama italic text-6xl sm:text-7xl md:text-8xl lg:text-[10rem] tracking-tight leading-[0.85] text-brand-500">
            Protocol.
          </span>
        </h1>

        <p
          data-hero-anim
          className="mt-6 text-on-dark/60 text-base md:text-lg max-w-lg leading-relaxed font-medium"
        >
          The orthotic lab for TMD and sleep dentistry. Digital workflow.
          Clinical accuracy. Every appliance, every time.
        </p>

        <div data-hero-anim className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            to="/contact"
            className="btn-magnetic group px-7 py-3.5 rounded-full bg-accent-500 text-white font-semibold text-sm shadow-xl shadow-accent-500/20"
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
            className="px-7 py-3.5 rounded-full bg-white/5 backdrop-blur-sm border border-white/20 text-white/80 font-semibold text-sm hover:bg-white/10 hover:shadow-sm transition-all duration-300"
          >
            View Products
          </Link>
        </div>

        <div
          data-hero-anim
          className="mt-10 md:mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 md:gap-x-8 text-on-dark/70 text-xs font-mono font-medium"
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
        {/* Product image — in-flow below text < lg, absolute-right at lg+ */}
        <img
          data-hero-product
          src="/images/hero-ddso-reflection.webp"
          alt="DDSO orthotic device"
          className="block mx-auto mt-8 w-[75%] max-w-[340px] h-auto object-contain pointer-events-none
                     lg:absolute lg:mt-0 lg:right-0 lg:-bottom-[5%] lg:w-[45%] lg:max-w-[700px] lg:mx-0 lg:z-[1]"
        />
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
      label: "Diamond Digital Sleep Orthotic",
      status: "Sleep",
      color: "bg-brand-500",
      image: "/images/ddso-post-iso.webp",
    },
    {
      label: "Olmos Neuromuscular Device",
      status: "TMD",
      color: "bg-accent-500",
      image: "/images/ond-overview.webp",
    },
    {
      label: "Olmos Neuromuscular Positioner",
      status: "TMD",
      color: "bg-emerald-500",
      image: "/images/onp-nylon4.webp",
    },
  ];

  return (
    <div className="bg-white card-radius p-6 md:p-8 border border-surface-300/50 shadow-sm hover:shadow-md transition-shadow duration-500 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <Shield size={16} className="text-brand-500" />
        <h3 className="font-heading font-bold text-base tracking-tight">
          Clinical Protocol Expertise
        </h3>
      </div>
      <p className="text-navy/70 text-sm mb-6">
        We understand the clinical protocol, not just the fabrication.
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
              backgroundColor: pos === 0 ? "rgb(var(--surface-50))" : "rgb(var(--surface-100))",
              transitionTimingFunction:
                "cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            <div className="flex items-center justify-between" style={{ visibility: pos === 0 ? "visible" : "hidden" }}>
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${cards[idx].color}`}
                />
                <img src={cards[idx].image} alt="" className="h-9 w-12 object-contain" />
                <span className="text-sm font-medium text-navy/80">
                  {cards[idx].label}
                </span>
              </div>
              <span className="text-xs font-mono text-navy/70">
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
    "▸ Intraoral scan — STL and native files accepted",
    "▸ Digital bite registration",
    "▸ CAD articulation to the parameters on your Rx",
    "▸ Printed in biocompatible PA12 nylon",
    "▸ Dimensional check against the design file",
    "▸ Shipped with tracking, care kit and instructions",
    "▸ Case archived digitally for reprint",
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
      <p className="text-navy/70 text-sm mb-4">
        Full digital workflow. Consistent, accurate appliances with fast
        turnaround.
      </p>
      <div className="flex-1 min-h-[9rem] bg-navy/[0.03] rounded-2xl p-4 font-mono text-xs overflow-hidden">
        {lines.map((line, i) => (
          <div key={i} className="text-navy/70 leading-relaxed">
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
      <p className="text-navy/70 text-sm mb-4">
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
              <circle cx="40" cy="28" r="18" stroke="rgb(var(--navy))" strokeWidth="1.5" fill="none" />
              {/* Jaw - offset to show pain */}
              <path d="M28 36 Q40 52 52 36" stroke="rgb(var(--navy))" strokeWidth="1.5" fill="none" />
              {/* Pain lines */}
              <g className={`transition-opacity duration-500 ${phase === 0 ? "opacity-100" : "opacity-0"}`}>
                <line x1="58" y1="28" x2="66" y2="24" stroke="rgb(var(--alert))" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="58" y1="33" x2="68" y2="33" stroke="rgb(var(--alert))" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="58" y1="38" x2="66" y2="42" stroke="rgb(var(--alert))" strokeWidth="1.5" strokeLinecap="round" />
              </g>
              {/* Shoulders */}
              <path d="M20 58 Q40 48 60 58" stroke="rgb(var(--navy))" strokeWidth="1.5" fill="none" />
              {/* Eyes - squinting in pain */}
              <line x1="33" y1="25" x2="37" y2="25" stroke="rgb(var(--navy))" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="43" y1="25" x2="47" y2="25" stroke="rgb(var(--navy))" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className={`mt-2 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all duration-500 ${
              phase === 0 ? "bg-brand-500 text-white" : "bg-surface-200/60 text-navy/70"
            }`}>
              TMD
            </span>
          </div>

          {/* Divider */}
          <div className="flex flex-col items-center gap-1">
            <div className="w-px h-12 bg-navy/10" />
            <span className="text-[9px] font-mono text-navy/70">+</span>
            <div className="w-px h-12 bg-navy/10" />
          </div>

          {/* Sleep figure */}
          <div className={`flex flex-col items-center transition-all duration-700 ${phase === 1 ? "opacity-100 scale-100" : "opacity-30 scale-95"}`}>
            <svg viewBox="0 0 80 90" className="w-16 h-20" fill="none">
              {/* Head - tilted on pillow */}
              <circle cx="38" cy="30" r="18" stroke="rgb(var(--navy))" strokeWidth="1.5" fill="none" />
              {/* Closed eyes */}
              <path d="M31 27 Q34 29 37 27" stroke="rgb(var(--navy))" strokeWidth="1.5" fill="none" />
              <path d="M41 27 Q44 29 47 27" stroke="rgb(var(--navy))" strokeWidth="1.5" fill="none" />
              {/* Open mouth - snoring */}
              <ellipse cx="39" cy="37" rx="4" ry="3" stroke="rgb(var(--navy))" strokeWidth="1.5" fill="none" />
              {/* Z's */}
              <g className={`transition-opacity duration-500 ${phase === 1 ? "opacity-100" : "opacity-0"}`}>
                <text x="56" y="18" fill="rgb(var(--brand-500))" fontSize="11" fontWeight="700" fontFamily="IBM Plex Mono, monospace">Z</text>
                <text x="63" y="10" fill="rgb(var(--brand-500))" fontSize="8" fontWeight="700" fontFamily="IBM Plex Mono, monospace" opacity="0.6">Z</text>
                <text x="68" y="4" fill="rgb(var(--brand-500))" fontSize="6" fontWeight="700" fontFamily="IBM Plex Mono, monospace" opacity="0.3">Z</text>
              </g>
              {/* Shoulders */}
              <path d="M18 58 Q38 48 58 58" stroke="rgb(var(--navy))" strokeWidth="1.5" fill="none" />
            </svg>
            <span className={`mt-2 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all duration-500 ${
              phase === 1 ? "bg-accent-500 text-white" : "bg-surface-200/60 text-navy/70"
            }`}>
              Sleep
            </span>
          </div>
        </div>

        {/* "One Roof" bar */}
        <div className="mt-4 w-full flex items-center gap-2">
          <div className="flex-1 h-px bg-navy/10" />
          <span className="text-[9px] font-mono text-navy/70 uppercase tracking-widest">One Lab · Every Case</span>
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
      <p className="text-navy/70 text-sm mb-4">
        From scan to delivery in 10 business days or less. No shortcuts — just
        an efficient digital pipeline.
      </p>
      <div className="flex-1 bg-navy/[0.03] rounded-2xl p-4 overflow-hidden min-h-[140px] flex flex-col justify-between">
        {/* Week rows */}
        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <span className="text-[10px] font-mono text-navy/70 uppercase">Week 1</span>
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
                        : "bg-surface-200/60 text-navy/70"
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
              <span className="text-[10px] font-mono text-navy/70 uppercase">Week 2</span>
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
                        : "bg-surface-200/60 text-navy/70"
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
                ? "bg-brand-500/10 text-brand-700"
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
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-feature-card]",
        { y: 60, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          stagger: 0.15,
          ease: "power3.out",
          paused: true,
        }
      );
      cleanup = playOnView(sectionRef.current, tween);
    }, sectionRef);
    return () => {
      cleanup?.();
      ctx.revert();
    };
  }, []);

  return (
    <section ref={sectionRef} className="section-pad py-24 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 md:mb-16">
          <span className="font-mono text-xs text-navy/70 uppercase tracking-widest">
            Why Diamond
          </span>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-4xl tracking-tight text-balance">
            Built for the protocol.
            <br />
            <span className="text-brand-700">Not just the appliance.</span>
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
    let cleanupPhil;
    let cleanupStat;
    const ctx = gsap.context(() => {
      const philTween = gsap.fromTo(
        "[data-phil]",
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
      cleanupPhil = playOnView(sectionRef.current, philTween);

      const statTween = gsap.fromTo(
        "[data-phil-stat]",
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
      cleanupStat = playOnView(sectionRef.current, statTween);
    }, sectionRef);
    return () => {
      cleanupPhil?.();
      cleanupStat?.();
      ctx.revert();
    };
  }, []);

  const stats = [
    { value: "19", label: "Lab Team Members" },
    { value: "<2wk", label: "Turnaround" },
    { value: "FDA", label: "510(k) Sleep Appliances" },
    { value: "3", label: "Countries With Certified Labs" },
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
        <LottiePlayer
          src="/animations/hero-lottie.json"
          style={{ width: 750, height: 680 }}
        />
      </div>

      <div className="relative z-10 section-pad py-28 md:py-40">
        <div className="max-w-6xl mx-auto">
          {/* Top label */}
          <div data-phil className="mb-6">
            <span className="font-mono text-[10px] font-semibold text-on-dark/60 uppercase tracking-[0.2em]">
              Our Philosophy
            </span>
          </div>

          <div data-phil className="mt-8">
            <h2 className="font-drama italic text-4xl sm:text-5xl md:text-6xl text-on-dark leading-[1.1] tracking-tight">
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
            <p className="text-on-dark/70 text-sm md:text-base font-medium leading-relaxed">
              Every orthotic we fabricate follows a documented clinical protocol
              and is quality-checked before it leaves our lab. Digital cases
              are designed in CAD, and printed appliances are SLS-printed to
              sub-millimeter tolerance.
            </p>
          </div>

          {/* Stat bar */}
          <div className="mt-16 md:mt-20 pt-10 border-t border-white/10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
              {stats.map((s, i) => (
                <div key={i} data-phil-stat>
                  <span className="block font-heading font-bold text-3xl md:text-4xl text-on-dark tracking-tight">
                    {s.value}
                  </span>
                  <span className="block font-mono text-[10px] font-semibold text-on-dark/60 uppercase tracking-wider mt-1">
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
  const steps = [
    {
      title: "Scan",
      desc: "Intraoral digital capture eliminates traditional impressions. Precision data from the first touch.",
      animation: <RotatingGeometry />,
    },
    {
      title: "Design",
      desc: "CAD articulation to the parameters on your Rx. Every occlusal surface mapped.",
      animation: <ScanningGrid />,
    },
    {
      title: "Fabricate",
      desc: "Printed appliances are made in biocompatible nylon. Quality verified. Shipped with tracking and care kit.",
      animation: <PulsingWaveform />,
    },
  ];

  /* Cards stack with CSS sticky at lg+, so scrolling past them can never leave
     blank space. */
  return (
    <section className="section-pad py-20 md:py-28">
      <ol className="max-w-6xl mx-auto space-y-6">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="lg:sticky relative overflow-hidden rounded-[2.5rem] md:rounded-[3rem] bg-white border border-navy/10 shadow-xl shadow-navy/10"
            style={{ top: 112 + i * 20 }}
          >
            <HeroStage tone="light" />
            <div className="relative z-10 grid lg:grid-cols-2 gap-8 items-center p-8 md:p-14 lg:min-h-[440px]">
              <div>
                <span aria-hidden="true" className="block font-drama italic lining-nums text-7xl md:text-8xl leading-none text-brand-600">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-heading font-bold text-4xl md:text-6xl tracking-tight text-navy">
                  {step.title}
                </h3>
                <p className="mt-4 text-navy/70 text-lg max-w-md leading-relaxed">{step.desc}</p>
              </div>
              <div className="flex items-center justify-center" aria-hidden="true">
                {step.animation}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ─── CTA SECTION ─── */
function CTASection() {
  return (
    <CtaBand
      title="Get the best for your"
      titleAccent="patients."
      intro={
        <>
          Whether you&apos;re treating TMJ disorders, sleep breathing
          conditions, or both — we&apos;re the lab that understands your
          protocol.
        </>
      }
      primary={{ label: "Contact Our Lab", to: "/contact" }}
      secondary={{ label: "View All Products", to: "/products" }}
      product="/images/cta-patients.webp"
      productAlt="Three smiling people, each holding a custom oral appliance"
      productFlush
    />
  );
}

/* ─── UTILITY ─── */
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ─── PAGE EXPORT ─── */
export function HomePage() {
  return (
    <>
      <Hero />
      <Features />
      <Philosophy />
      <Protocol />
      <CTASection />
    </>
  );
}
