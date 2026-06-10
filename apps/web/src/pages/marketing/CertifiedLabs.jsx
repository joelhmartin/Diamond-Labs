import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import {
  ArrowRight,
  ExternalLink,
  Phone,
  MapPin,
  Star,
  Workflow,
} from "lucide-react";
import { playOnView } from "../../lib/playOnView";

const REGIONS = [
  {
    flag: "🇺🇸",
    label: "United States",
    labs: [
      {
        name: "Diamond Orthotic Laboratory International",
        locator: "La Mesa, California",
        href: "https://www.diamondorthoticlab.com",
        display: "diamondorthoticlab.com",
        phone: "619.724.6400",
        featured: true,
      },
      {
        name: "John's Dental Laboratory",
        locator: "Terre Haute, Indiana",
        href: "https://www.johnsdental.com",
        display: "johnsdental.com",
      },
    ],
  },
  {
    flag: "🇨🇦",
    label: "Canada",
    labs: [
      {
        name: "Orthodent",
        locator: "Canada",
        href: "https://www.orthodent.ca",
        display: "orthodent.ca",
      },
      {
        name: "Echlon Laboratory",
        locator: "Canada",
        phone: "877.505.5441",
      },
    ],
  },
  {
    flag: "🇦🇺",
    label: "Australia",
    labs: [
      {
        name: "Airway Centric Orthotics",
        locator: "Australia",
        href: "https://www.airwaycentricorthotics.com",
        display: "airwaycentricorthotics.com",
      },
    ],
  },
];

function Hero() {
  const ref = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-lab-hero]", {
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
          src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1920&q=80"
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/70 to-transparent/40" />
      <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/40 to-transparent" />

      <div className="relative z-10 pb-16 md:pb-24 w-full max-w-6xl mx-auto">
        <div className="max-w-3xl">
        <span
          data-lab-hero
          className="font-mono text-xs text-white/40 uppercase tracking-widest"
        >
          Certified Laboratories
        </span>
        <h1 data-lab-hero className="mt-4 text-white">
          <span className="block font-heading font-bold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[0.95]">
            One protocol.
          </span>
          <span className="block font-drama italic text-6xl sm:text-7xl md:text-9xl tracking-tight leading-[0.88] text-brand-500">
            Seven labs.
          </span>
        </h1>
        <p
          data-lab-hero
          className="mt-6 text-white/50 text-base md:text-lg max-w-xl leading-relaxed"
        >
          Dr. Olmos has partnered with and certified 7 laboratories in the
          US, Canada, and Australia with the ability and commitment to
          produce orthotics to the quality and accuracy this treatment
          demands.
        </p>
        </div>
      </div>
    </section>
  );
}

function Standard() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-std]",
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
            data-std
            className="font-mono text-xs text-navy/40 uppercase tracking-widest"
          >
            The Standard
          </span>
          <h2
            data-std
            className="mt-3 font-heading font-bold text-3xl md:text-4xl tracking-tight"
          >
            Integrating form with{" "}
            <span className="font-drama italic text-brand-500">
              function.
            </span>
          </h2>
        </div>
        <div className="lg:col-span-3 space-y-5 text-navy/60 leading-relaxed">
          <p data-std>
            TMJ &amp; Sleep Certified Labs share a commitment to excellence.
            Each lab has given their assurance that products using the Olmos
            protocol will meet the consistent high quality we all expect and
            demand for our patients.
          </p>
          <p data-std>
            Continued training in the Olmos Protocol is provided to each
            certified laboratory and its technicians. Ongoing controls are
            in place to ensure quality as well as your satisfaction.
          </p>
          <p data-std>
            The certified lab program is administered by{" "}
            <span className="text-navy font-semibold">Matt Rago</span>,
            Director of International Laboratory Certification, together
            with{" "}
            <Link
              to="/about/dr-olmos"
              className="text-brand-500 font-semibold hover:underline"
            >
              Dr. Olmos
            </Link>
            . They are available for technical support questions from labs,
            doctors, and staff.
          </p>
        </div>
      </div>
    </section>
  );
}

function LabCard({ lab }) {
  return (
    <div
      className={`card-radius p-6 md:p-7 border transition-all duration-500 flex flex-col ${
        lab.featured
          ? "bg-navy text-white border-navy-light hover:border-brand-400/40"
          : "bg-white border-surface-300/50 hover:border-brand-500/30 hover:shadow-lg hover:shadow-navy/5"
      }`}
    >
      {lab.featured && (
        <div className="flex items-center gap-2 mb-4">
          <Star size={12} className="text-brand-400 fill-brand-400" />
          <span className="font-mono text-[10px] text-brand-400 uppercase tracking-widest">
            Flagship
          </span>
        </div>
      )}
      <h3
        className={`font-heading font-bold text-lg tracking-tight leading-snug ${
          lab.featured ? "text-white" : "text-navy"
        }`}
      >
        {lab.name}
      </h3>
      <div
        className={`mt-2 flex items-center gap-2 text-xs ${
          lab.featured ? "text-white/50" : "text-navy/45"
        }`}
      >
        <MapPin size={12} />
        <span>{lab.locator}</span>
      </div>

      <div className="mt-5 space-y-2 flex-1">
        {lab.href && (
          <a
            href={lab.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`group/link inline-flex items-center gap-2 text-sm font-medium transition-colors ${
              lab.featured
                ? "text-brand-400 hover:text-brand-300"
                : "text-brand-500 hover:text-brand-600"
            }`}
          >
            {lab.display}
            <ExternalLink
              size={12}
              className="group-hover/link:translate-x-0.5 transition-transform"
            />
          </a>
        )}
        {lab.phone && (
          <div
            className={`flex items-center gap-2 text-sm ${
              lab.featured ? "text-white/70" : "text-navy/70"
            }`}
          >
            <Phone size={12} />
            <span className="font-mono">{lab.phone}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Directory() {
  const ref = useRef(null);
  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-region]",
        { y: 30, opacity: 0 },
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
        <div className="mb-12 md:mb-16">
          <div className="flex items-center gap-3 mb-4">
            <Workflow size={16} className="text-brand-500" />
            <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
              Phase I · Phase II · Sleep
            </span>
          </div>
          <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance max-w-3xl">
            Labs that stand ready to service your{" "}
            <span className="font-drama italic text-brand-500">
              appliance needs.
            </span>
          </h2>
        </div>

        <div className="space-y-12 md:space-y-16">
          {REGIONS.map((r) => (
            <div key={r.label} data-region>
              <div className="flex items-center gap-3 mb-6">
                <span className="text-2xl" aria-hidden>
                  {r.flag}
                </span>
                <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
                  {r.label}
                </span>
                <div className="flex-1 h-px bg-surface-300/60" />
                <span className="font-mono text-[10px] text-navy/30">
                  {r.labs.length}{" "}
                  {r.labs.length === 1 ? "laboratory" : "laboratories"}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
                {r.labs.map((lab) => (
                  <LabCard key={lab.name} lab={lab} />
                ))}
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
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-lab-cta]",
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
          data-lab-cta
          className="font-mono text-xs text-navy/40 uppercase tracking-widest"
        >
          Training &amp; Technical Support
        </span>
        <h2
          data-lab-cta
          className="mt-4 font-heading font-bold text-3xl md:text-5xl tracking-tight"
        >
          Need help with impressions or{" "}
          <span className="font-drama italic text-brand-500">
            orthotic repairs?
          </span>
        </h2>
        <p
          data-lab-cta
          className="mt-6 text-navy/50 text-base md:text-lg max-w-xl mx-auto"
        >
          Call Diamond Orthotic Lab directly for training on taking quality
          impressions or performing simple orthotic repairs and relines —
          save your practice time and money.
        </p>
        <div
          data-lab-cta
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
            className="px-8 py-4 rounded-full border border-surface-300 text-navy/70 font-medium hover:bg-surface-200/60 transition-colors duration-300"
          >
            Contact Form
            <ArrowRight size={14} className="inline ml-2" />
          </Link>
        </div>
      </div>
    </section>
  );
}

export function CertifiedLabsPage() {
  return (
    <>
      <Hero />
      <Standard />
      <Directory />
      <CTA />
    </>
  );
}
