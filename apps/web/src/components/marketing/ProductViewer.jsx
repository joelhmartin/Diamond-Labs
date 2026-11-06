import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ArrowRight, Box, Image as ImageIcon } from "lucide-react";
import { ModelViewer } from "../ModelViewer";

export function ProductViewer({
  product,
  ctaTo = "/contact",
  ctaLabel = "Request Information",
  onCta = null,
  registered = true,
  headingAs: Heading = "h2",
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [lookIdx, setLookIdx] = useState(0);
  const mainRef = useRef(null);

  const handleThumbClick = (idx) => {
    if (idx === activeIdx) return;
    const currentIs3D = product.images[activeIdx].is3D;
    const nextIs3D = product.images[idx].is3D;
    if (currentIs3D || nextIs3D || !mainRef.current) {
      setActiveIdx(idx);
      return;
    }
    gsap.to(mainRef.current, {
      opacity: 0,
      duration: 0.2,
      onComplete: () => {
        setActiveIdx(idx);
        gsap.to(mainRef.current, { opacity: 1, duration: 0.3 });
      },
    });
  };

  const activeItem = product.images[activeIdx];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-start rounded-[2.5rem] bg-white border border-surface-300/60 shadow-xl shadow-navy/10 p-4 md:p-6 lg:p-8">
      {/* Product stage */}
      <div className="lg:col-span-7">
        <div
          className={`relative aspect-[4/3] rounded-[2rem] overflow-hidden border ${
            activeItem.is3D
              ? "bg-navy border-navy"
              : "bg-gradient-to-br from-white via-surface-50 to-surface-100 border-surface-300/50"
          }`}
        >
          {!activeItem.is3D && (
            <div aria-hidden="true" className="absolute inset-x-[12%] bottom-[8%] h-[10%] rounded-full bg-navy/10 blur-2xl" />
          )}
          {activeItem.is3D ? (
            <ModelViewer
              model={{ device: activeItem.device, ...activeItem.looks[lookIdx] }}
              className="w-full h-full bg-navy text-white/80"
            />
          ) : activeItem.src ? (
            <img
              ref={mainRef}
              src={activeItem.src}
              alt={activeItem.label}
              className="relative w-full h-full object-contain p-6 md:p-10 drop-shadow-[0_18px_28px_rgba(0,20,60,0.18)]"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-navy/70">
              <ImageIcon size={40} />
              <span className="mt-3 text-sm">Image pending</span>
            </div>
          )}
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                activeItem.is3D ? "bg-white/15 text-white" : `${product.categoryBg} ${product.categoryColor}`
              }`}
            >
              {product.category}
            </span>
            {activeItem.is3D && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/15 text-white flex items-center gap-1">
                <Box size={10} />
                Interactive 3D
              </span>
            )}
          </div>
          {activeItem.is3D && activeItem.looks.length > 1 && (
            <MaterialPicker looks={activeItem.looks} active={lookIdx} onPick={setLookIdx} />
          )}
          {activeItem.is3D && (
            <div className="absolute top-5 right-4 text-xs text-white/70 pointer-events-none hidden sm:block">
              drag to rotate · scroll to zoom
            </div>
          )}
        </div>
        {/* Thumbnails */}
        <div className="mt-4 flex gap-3 overflow-x-auto scrollbar-hide p-1">
          {product.images.map((img, i) => (
            <button
              key={i}
              type="button"
              aria-label={img.label}
              aria-pressed={i === activeIdx}
              onClick={() => handleThumbClick(i)}
              className={`flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-2xl overflow-hidden border-2 bg-white transition-all duration-300 ${
                i === activeIdx
                  ? "border-brand-500 ring-4 ring-brand-500/20 shadow-md"
                  : "border-surface-300/60 hover:border-brand-300 hover:-translate-y-0.5"
              }`}
            >
              {img.is3D ? (
                <div className="w-full h-full bg-navy flex flex-col items-center justify-center gap-0.5">
                  <Box size={16} className="text-brand-400" />
                  <span className="text-[9px] font-mono text-white/70 leading-none">3D</span>
                </div>
              ) : (
                <img
                  src={img.src}
                  alt={img.label}
                  className="w-full h-full object-contain bg-white p-1.5"
                  loading="lazy"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Details */}
      <div className="lg:col-span-5 lg:py-2">
        <Heading className="font-heading font-bold text-3xl md:text-4xl tracking-tight text-navy">
          {product.name}
          {registered && <sup className="ml-0.5 text-base font-semibold text-navy/70">®</sup>}
        </Heading>
        <div className="mt-1 font-heading text-sm font-semibold text-brand-700">
          {product.fullName}
        </div>
        <p className="mt-4 text-navy/70 leading-relaxed">
          {product.tagline}
        </p>

        <div className="mt-6 rounded-[1.5rem] border border-surface-300/60 overflow-hidden">
          {product.specs.map((spec, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-4 px-5 py-3 odd:bg-surface-50"
            >
              <span className="text-sm text-navy/70">
                {spec.label}
              </span>
              <span className="text-sm font-semibold text-navy text-right">
                {spec.value}
              </span>
            </div>
          ))}
        </div>

        {onCta ? (
          <button
            type="button"
            onClick={onCta}
            className="btn-magnetic group mt-8 w-full px-6 py-3.5 rounded-full bg-accent-500 text-white font-semibold text-sm inline-flex justify-center"
          >
            <span className="btn-bg bg-accent-600 rounded-full" />
            <span className="relative z-10 flex items-center gap-2">
              {ctaLabel}
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform"
              />
            </span>
          </button>
        ) : (
          <Link
            to={ctaTo}
            className="btn-magnetic group mt-8 w-full px-6 py-3.5 rounded-full bg-accent-500 text-white font-semibold text-sm inline-flex justify-center"
          >
            <span className="btn-bg bg-accent-600 rounded-full" />
            <span className="relative z-10 flex items-center gap-2">
              {ctaLabel}
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform"
              />
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}

/* Material buttons over the 3D stage; the viewer repaints the trays in place. */
function MaterialPicker({ looks, active, onPick }) {
  return (
    <div role="group" aria-label="Material" className="absolute inset-x-4 bottom-4 flex flex-wrap items-center justify-center gap-2">
      {looks.map((look, i) => (
        <button
          key={look.label}
          type="button"
          aria-pressed={i === active}
          onClick={() => onPick(i)}
          className={`px-4 py-2 rounded-full text-xs font-semibold backdrop-blur-md transition-colors duration-200 ${
            i === active ? "bg-white text-navy" : "bg-white/10 text-white border border-white/20 hover:bg-white/20"
          }`}
        >
          {look.label}
        </button>
      ))}
    </div>
  );
}
