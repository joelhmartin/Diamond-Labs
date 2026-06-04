import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight, Shield, Zap, Layers } from "lucide-react";
import { PRODUCTS } from "../../data/products";
import { ProductViewer } from "../../components/marketing/ProductViewer";
import { CatalogSection } from "../../components/marketing/CatalogSection";

gsap.registerPlugin(ScrollTrigger);


/* ─── FEATURE HIGHLIGHTS ─── */
function FeatureHighlights() {
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-highlight]", {
        y: 40,
        opacity: 0,
        duration: 0.7,
        stagger: 0.15,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 75%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  const highlights = [
    {
      icon: Shield,
      label: "Olmos-Method Certified",
      desc: "Every appliance follows the exact clinical parameters defined by Dr. Steven Olmos.",
    },
    {
      icon: Zap,
      label: "Digital-First Workflow",
      desc: "From intraoral scan to 3D print — no analog steps, no cumulative error.",
    },
    {
      icon: Layers,
      label: "Multiple Materials",
      desc: "Nylon PA12, Bioflex, Trutaine — each case matched to the optimal material.",
    },
  ];

  return (
    <section ref={ref} className="section-pad py-16 md:py-24">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        {highlights.map((h, i) => (
          <div
            key={i}
            data-highlight
            className="flex items-start gap-4 p-6 bg-white card-radius border border-surface-300/50"
          >
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center flex-shrink-0">
              <h.icon size={18} className="text-brand-500" />
            </div>
            <div>
              <h3 className="font-heading font-bold text-sm">{h.label}</h3>
              <p className="mt-1 text-navy/50 text-sm leading-relaxed">
                {h.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── PRODUCT HERO ─── */
function ProductHero() {
  const heroRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-phero]", {
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
      className="relative h-[50dvh] min-h-[380px] flex items-end overflow-hidden section-pad"
    >
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1581093458791-9d42e3c9e8b0?auto=format&fit=crop&w=1920&q=80"
          alt="Precision 3D printing"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/80 to-navy/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy via-transparent to-transparent" />
      </div>
      <div className="relative z-10 pb-12 md:pb-16 w-full max-w-6xl mx-auto">
        <div className="max-w-3xl">
        <span data-phero className="font-mono text-xs text-white/40 uppercase tracking-widest">
          Our Products
        </span>
        <h1 data-phero className="mt-4 text-white">
          <span className="block font-heading font-bold text-3xl sm:text-4xl md:text-6xl tracking-tight leading-[0.95]">
            Precision appliances for
          </span>
          <span className="block font-drama italic text-4xl sm:text-5xl md:text-7xl tracking-tight leading-[0.9] text-brand-500">
            every protocol.
          </span>
        </h1>
        </div>
      </div>
    </section>
  );
}

/* ─── PRODUCT TABS ─── */
function ProductTabs() {
  const [activeProduct, setActiveProduct] = useState("ddsoAnt");
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-product-entry]", {
        y: 40,
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
    <section ref={ref} className="section-pad pt-16 pb-16 md:pt-24 md:pb-24">
      <div className="max-w-6xl mx-auto">

        {/* Tabs */}
        <div data-product-entry className="flex flex-wrap items-center gap-2 mb-8">
          {[
            { key: "ddsoAnt",  label: "DDSO — Anterior",  sub: "Sleep Appliance" },
            { key: "ddsoPost", label: "DDSO — Posterior", sub: "Sleep Appliance" },
            { key: "ond",      label: "OND",              sub: "TMD Orthotic" },
            { key: "onp",      label: "ONP",              sub: "TMD Orthotic" },
          ].map(({ key, label, sub }) => (
            <button
              key={key}
              onClick={() => setActiveProduct(key)}
              className={`px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${
                activeProduct === key
                  ? "bg-brand-500 text-white"
                  : "bg-surface-200/60 text-navy/50 hover:text-navy hover:bg-surface-300/60"
              }`}
            >
              {label}
              <span className="hidden sm:inline text-xs opacity-60"> · {sub}</span>
            </button>
          ))}
        </div>

        {/* Active product */}
        <div data-product-entry>
          <ProductViewer
            key={activeProduct}
            product={PRODUCTS[activeProduct]}
          />
        </div>
      </div>
    </section>
  );
}

/* ─── CTA BAR ─── */
function ProductCTA() {
  return (
    <section className="section-pad py-16 md:py-24">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="font-heading font-bold text-2xl md:text-4xl tracking-tight">
          Questions about our products?
        </h2>
        <p className="mt-4 text-navy/50 text-base max-w-lg mx-auto">
          Our team is ready to discuss which appliance and material options are
          the best fit for your patients.
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
export function ProductPage() {
  return (
    <>
      <ProductHero />
      <ProductTabs />
      <CatalogSection />
      <FeatureHighlights />
      <ProductCTA />
    </>
  );
}
