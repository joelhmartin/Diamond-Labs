import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { PRODUCTS } from "../../data/products";
import { prefersReducedMotion } from "../../lib/reducedMotion";
import { ProductViewer } from "./ProductViewer";

gsap.registerPlugin(ScrollTrigger);

/**
 * Product tabs plus the product viewer. The page supplies its own hero and
 * <h1>; the viewer's product name is an h2.
 *
 * Props:
 *  - tabs: [{ key, label, sub }] — keys must exist in PRODUCTS
 *  - ctaTo: where the viewer CTA links (default "/submit-case")
 *  - ctaLabel: button label (default "Submit Digital Rx")
 *  - notice: line under the viewer (default the Rx-only note; null for none)
 *  - spacing: section padding classes, so a page can tuck it under its hero
 *  - tone: section background class (default surface-100) so a page can keep
 *    the light/dark rhythm against its neighbours
 */
const RX_NOTICE = "Rx-only · Submit through the Digital Rx form. Requires a licensed dentist.";

export function ProductCatalog({
  tabs,
  ctaTo = "/submit-case",
  ctaLabel = "Submit Digital Rx",
  notice = RX_NOTICE,
  spacing = "pt-28 md:pt-32 pb-12 md:pb-16",
  tone = "bg-surface-100",
}) {
  const [active, setActive] = useState(tabs[0].key);
  const ref = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
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
    <section ref={ref} className={`section-pad ${tone} ${spacing}`}>
      <div className="max-w-6xl mx-auto">
        {/* Tabs */}
        <div
          data-catalog-anim
          className="flex flex-wrap items-center gap-2 mb-6 md:mb-8"
        >
          {tabs.map(({ key, label, sub }) => (
            <button
              key={key}
              type="button"
              aria-pressed={active === key}
              onClick={() => setActive(key)}
              className={`px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${
                active === key
                  ? "bg-brand-500 text-white shadow-md shadow-brand-500/30"
                  : "bg-white border border-surface-300/60 text-navy/70 hover:text-navy hover:-translate-y-0.5 hover:shadow-sm"
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
        {notice && (
          <p data-catalog-anim className="mt-6 text-xs text-navy/70">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
