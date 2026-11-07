import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import gsap from "gsap";
import { Search, X } from "lucide-react";
import { useCatalogStore } from "../../stores/catalog.store";
import { CatalogCard } from "./CatalogCard";
import { CatalogDetail } from "./CatalogDetail";
import { usePagination } from "../../hooks/usePagination.js";
import { Pagination } from "../ui/Pagination.jsx";
import { playOnView } from "../../lib/playOnView";
import { categoryCounts, inCategory, searchCatalog } from "../../lib/catalogFilter";

const PAGE_SIZES = [12, 24, 48];
const NAVBAR_CLEARANCE_PX = 112; // matches the sidebar's lg:top-28

export function CatalogSection() {
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(null);
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const ref = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-cat-head]",
        { y: 24, opacity: 0 },
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

  /* The router does not follow #catalog on its own, and the shop link from checkout uses it. */
  useEffect(() => {
    if (hash === "#catalog") ref.current?.scrollIntoView({ behavior: "instant" });
    // Only on arrival: changing category drops the hash and must not move the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const products = useCatalogStore((s) => s.products);
  const matches = useMemo(() => searchCatalog(products, query), [products, query]);
  const categories = useMemo(() => categoryCounts(products, matches), [products, matches]);

  // The category lives in the URL, so refresh, back and shared links all keep it.
  const requested = params.get("category");
  const category = categories.some((c) => c.name === requested) ? requested : null;
  const filtered = useMemo(() => inCategory(matches, category), [matches, category]);

  const pagination = usePagination(filtered, {
    initialPageSize: PAGE_SIZES[0],
    resetKey: `${category}|${query.trim().toLowerCase()}`,
  });

  function chooseCategory(name) {
    setParams(name ? { category: name } : {}, { preventScrollReset: true });
  }

  function clearFilters() {
    setQuery("");
    chooseCategory(null);
  }

  /* A shorter list or a new page must not leave the visitor below the products they asked for. */
  const arrived = useRef(false);
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    const top = searchRef.current?.getBoundingClientRect().top ?? 0;
    if (top < NAVBAR_CLEARANCE_PX) {
      window.scrollTo({ top: window.scrollY + top - NAVBAR_CLEARANCE_PX });
    }
  }, [pagination.page, pagination.pageSize, category]);

  return (
    <section
      ref={ref}
      id="catalog"
      className="section-pad py-16 md:py-24 bg-surface-100 border-t border-surface-300/50"
    >
      <div className="max-w-6xl mx-auto">
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

        <div ref={searchRef} data-cat-head className="relative mt-8 md:mt-10">
          <Search
            size={16}
            className="absolute left-5 top-1/2 -translate-y-1/2 text-navy/30"
          />
          <input
            type="text"
            placeholder="Search products…"
            aria-label="Search products"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-12 pr-11 py-3.5 rounded-full bg-white border border-surface-300/60 text-sm placeholder:text-navy/30 focus:outline-none focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/10 transition-all"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full hover:bg-surface-200 flex items-center justify-center text-navy/40"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="mt-6 lg:mt-10 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
          <CategoryList
            categories={categories}
            active={category}
            total={matches.length}
            onChoose={chooseCategory}
          />

          <div className="mt-6 lg:mt-0 min-w-0">
            <p className="mb-4 text-xs font-mono text-navy/40" aria-live="polite">
              {filtered.length} {filtered.length === 1 ? "product" : "products"}
              {category && (
                <>
                  {" "}in <span className="text-navy/60">{category}</span>
                </>
              )}
              {query.trim() && (
                <>
                  {" "}matching{" "}
                  <span className="text-navy/60">&ldquo;{query.trim()}&rdquo;</span>
                </>
              )}
            </p>

            {filtered.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-navy/50 text-sm">No products match.</p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-4 px-4 py-2 rounded-full text-xs font-semibold bg-navy text-white hover:bg-brand-500 transition-colors"
                >
                  Show all products
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
                  {pagination.paged.map((p) => (
                    <CatalogCard
                      key={p.id}
                      product={p}
                      onOpen={() => setDetail(p)}
                    />
                  ))}
                </div>
                <Pagination
                  {...pagination}
                  pageSizeOptions={PAGE_SIZES}
                  itemLabel="products"
                  className="mt-10 pt-6 border-t border-surface-300/50"
                />
              </>
            )}
          </div>
        </div>
      </div>

      {detail && (
        <CatalogDetail product={detail} onClose={() => setDetail(null)} />
      )}
    </section>
  );
}

/* A sticky sidebar from lg up, a row of swipeable chips below that. */
function CategoryList({ categories, active, total, onChoose }) {
  return (
    <nav aria-label="Product categories" className="min-w-0 lg:sticky lg:top-28 lg:self-start">
      <p className="hidden lg:block mb-3 px-4 font-mono text-[10px] text-navy/40 uppercase tracking-widest">
        Categories
      </p>
      <ul className="flex lg:flex-col gap-2 lg:gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1 lg:mx-0 lg:px-0 lg:pb-0">
        <CategoryItem label="All products" count={total} active={!active} onClick={() => onChoose(null)} />
        {categories.map((c) => (
          <CategoryItem
            key={c.name}
            label={c.name}
            count={c.count}
            active={active === c.name}
            onClick={() => onChoose(c.name)}
          />
        ))}
      </ul>
    </nav>
  );
}

function CategoryItem({ label, count, active, onClick }) {
  const tone = active
    ? "bg-navy text-white border-navy"
    : `bg-white lg:bg-transparent border-surface-300/50 lg:border-transparent hover:text-navy lg:hover:bg-white ${
        count === 0 ? "text-navy/30" : "text-navy/60"
      }`;
  return (
    <li className="flex-shrink-0">
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={`w-full flex items-center justify-between gap-3 px-4 py-2 lg:py-2.5 rounded-full border text-xs lg:text-sm font-semibold text-left whitespace-nowrap transition-colors duration-200 ${tone}`}
      >
        {label}
        <span className={`font-mono text-[11px] font-normal tabular-nums ${active ? "text-white/60" : "text-navy/35"}`}>
          {count}
        </span>
      </button>
    </li>
  );
}
