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
}) {
  const [activeIdx, setActiveIdx] = useState(0);
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
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Main display */}
      <div className="lg:col-span-6">
        <div className="relative aspect-[4/3] rounded-[2rem] overflow-hidden bg-surface-100 border border-surface-300/50">
          {activeItem.is3D ? (
            <ModelViewer
              objPath={activeItem.objPath}
              mtlPath={activeItem.mtlPath}
              className="w-full h-full"
            />
          ) : activeItem.src ? (
            <img
              ref={mainRef}
              src={activeItem.src}
              alt={activeItem.label}
              className="w-full h-full object-contain p-8"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-navy/20">
              <ImageIcon size={40} />
              <span className="mt-3 text-xs font-mono uppercase tracking-widest">
                Image pending
              </span>
            </div>
          )}
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${product.categoryBg} ${product.categoryColor}`}
            >
              {product.category}
            </span>
            {activeItem.is3D && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-navy/80 text-white flex items-center gap-1">
                <Box size={10} />
                Interactive 3D
              </span>
            )}
          </div>
          {activeItem.is3D && (
            <div className="absolute bottom-4 right-4 text-[10px] font-mono text-white/30 pointer-events-none">
              drag to rotate · scroll to zoom
            </div>
          )}
        </div>
        {/* Thumbnails */}
        <div className="mt-4 flex gap-2 overflow-x-auto scrollbar-hide pb-2">
          {product.images.map((img, i) => (
            <button
              key={i}
              onClick={() => handleThumbClick(i)}
              className={`flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden border-2 transition-all duration-300 ${
                i === activeIdx
                  ? "border-brand-500 ring-2 ring-brand-500/20"
                  : "border-surface-300/50 hover:border-surface-400"
              }`}
            >
              {img.is3D ? (
                <div className="w-full h-full bg-navy flex flex-col items-center justify-center gap-0.5">
                  <Box size={16} className="text-brand-400" />
                  <span className="text-[9px] font-mono text-white/50 leading-none">3D</span>
                </div>
              ) : (
                <img
                  src={img.src}
                  alt={img.label}
                  className="w-full h-full object-contain bg-surface-50 p-1"
                  loading="lazy"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Details */}
      <div className="lg:col-span-6">
        <div className="font-heading font-bold text-3xl md:text-4xl tracking-tight">
          {product.name}
          {registered && (
            <span className="font-drama italic text-brand-500">®</span>
          )}
        </div>
        <div className="mt-1 font-heading text-sm text-navy/50">
          {product.fullName}
        </div>
        <p className="mt-4 text-navy/60 text-sm leading-relaxed">
          {product.tagline}
        </p>

        <div className="mt-6 space-y-3">
          {product.specs.map((spec, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 border-b border-surface-300/30"
            >
              <span className="text-xs font-mono text-navy/40 uppercase">
                {spec.label}
              </span>
              <span className="text-sm font-medium text-navy/80">
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
