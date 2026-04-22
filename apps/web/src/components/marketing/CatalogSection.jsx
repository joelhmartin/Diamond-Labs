import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useCatalogStore } from "../../stores/catalog.store";
import { CatalogCard } from "./CatalogCard";
import { CatalogDetail } from "./CatalogDetail";

gsap.registerPlugin(ScrollTrigger);

const ALL = "All";

export function CatalogSection() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(ALL);
  const [detail, setDetail] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-cat-head]", {
        y: 24,
        opacity: 0,
        duration: 0.7,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 80%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  const products = useCatalogStore((s) => s.products);
  const categories = useMemo(
    () => Array.from(new Set(products.flatMap((p) => p.categories))).sort(),
    [products]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.active) return false;
      if (active !== ALL && !p.categories.includes(active)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.categories.join(" ").toLowerCase().includes(q) ||
        p.id.toString().includes(q)
      );
    });
  }, [query, active, products]);

  return (
    <section
      ref={ref}
      id="catalog"
      className="section-pad py-16 md:py-24 bg-surface-100 border-t border-surface-300/50"
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8 md:mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div data-cat-head>
            <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
              Shop Accessories &amp; Supplies
            </span>
            <h2 className="mt-3 font-heading font-bold text-3xl md:text-5xl tracking-tight text-balance">
              Lab-direct tools,{" "}
              <span className="font-drama italic text-brand-500">
                shipped fast.
              </span>
            </h2>
            <p className="mt-4 max-w-xl text-navy/55 leading-relaxed">
              Cleaners, polishing wheels, burs, bite registration, shipping
              supplies — everything you need between cases. Orthotics are
              Rx-only and submitted through the Digital Rx form.
            </p>
          </div>

          {/* Search */}
          <div data-cat-head className="relative md:w-80 flex-shrink-0">
            <Search
              size={16}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-navy/30"
            />
            <input
              type="text"
              placeholder="Search products…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-11 pr-10 py-3 rounded-full bg-white border border-surface-300/60 text-sm placeholder:text-navy/30 focus:outline-none focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/10 transition-all"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full hover:bg-surface-200 flex items-center justify-center text-navy/40"
                aria-label="Clear"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Filter chips */}
        <div
          data-cat-head
          className="mb-8 flex items-center gap-2 overflow-x-auto scrollbar-hide pb-2"
        >
          <div className="flex items-center gap-2 text-[10px] font-mono text-navy/40 uppercase tracking-widest pr-2 flex-shrink-0">
            <SlidersHorizontal size={12} />
            Filter
          </div>
          <Chip label={ALL} active={active === ALL} onClick={() => setActive(ALL)} />
          {categories.map((c) => (
            <Chip
              key={c}
              label={c}
              active={active === c}
              onClick={() => setActive(c)}
            />
          ))}
        </div>

        {/* Results count */}
        <div className="mb-5 text-xs font-mono text-navy/40">
          {filtered.length} {filtered.length === 1 ? "product" : "products"}
          {active !== ALL && (
            <>
              {" "}in <span className="text-navy/60">{active}</span>
            </>
          )}
          {query && (
            <>
              {" "}matching{" "}
              <span className="text-navy/60">&ldquo;{query}&rdquo;</span>
            </>
          )}
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-navy/40 text-sm">
              No products match your search. Try different keywords or clear
              the filter.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5">
            {filtered.map((p) => (
              <CatalogCard
                key={p.id}
                product={p}
                onOpen={() => setDetail(p)}
              />
            ))}
          </div>
        )}
      </div>

      {detail && (
        <CatalogDetail product={detail} onClose={() => setDetail(null)} />
      )}
    </section>
  );
}

function Chip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-semibold transition-all duration-300 ${
        active
          ? "bg-navy text-white"
          : "bg-white text-navy/60 border border-surface-300/50 hover:border-brand-500/30 hover:text-navy"
      }`}
    >
      {label}
    </button>
  );
}
