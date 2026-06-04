import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { PRODUCTS } from "../../data/products";
import { ProductViewer } from "./ProductViewer";

gsap.registerPlugin(ScrollTrigger);

/**
 * Product selector that sits directly under the navbar.
 *
 * No headings or marketing copy — pages render an intro section AFTER this,
 * where the page's real <h1> lives.
 *
 * Props:
 *  - tabs: [{ key, label, sub }] — keys must exist in PRODUCTS
 *  - ctaTo: where the viewer CTA links (default "/submit-case")
 *  - ctaLabel: button label (default "Submit Digital Rx")
 */
export function ProductCatalog({
  tabs,
  ctaTo = "/submit-case",
  ctaLabel = "Submit Digital Rx",
}) {
  const [active, setActive] = useState(tabs[0].key);
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-catalog-anim]", {
        y: 24,
        opacity: 0,
        duration: 0.7,
        stagger: 0.08,
        ease: "power3.out",
        delay: 0.1,
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  const product = PRODUCTS[active];

  return (
    <section ref={ref} className="section-pad pt-28 md:pt-32 pb-12 md:pb-16">
      <div className="max-w-6xl mx-auto">
        {/* Tabs */}
        <div
          data-catalog-anim
          className="flex flex-wrap items-center gap-2 mb-6 md:mb-8"
        >
          {tabs.map(({ key, label, sub }) => (
            <button
              key={key}
              onClick={() => setActive(key)}
              className={`px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${
                active === key
                  ? "bg-brand-500 text-white"
                  : "bg-surface-200/60 text-ink/50 hover:text-ink hover:bg-surface-300/60"
              }`}
            >
              {label}
              {sub && (
                <span className="hidden sm:inline text-xs opacity-60"> · {sub}</span>
              )}
            </button>
          ))}
        </div>

        {/* Active product */}
        <div data-catalog-anim>
          <ProductViewer
            key={active}
            product={product}
            ctaTo={ctaTo}
            ctaLabel={ctaLabel}
          />
        </div>

        {/* Rx-only notice */}
        <div
          data-catalog-anim
          className="mt-6 text-[11px] font-mono text-ink/40 tracking-wide"
        >
          Rx-only · Submit through the Digital Rx form. Requires a licensed dentist.
        </div>
      </div>
    </section>
  );
}
