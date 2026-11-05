import { useEffect, useRef } from "react";
import gsap from "gsap";

/* Shared interior-page hero. Two variants, both dark from the top edge so the
   white nav stays legible:
     image   — navy base, left-weighted scrim over a photo, min-h-[60dvh],
               content anchored bottom-left.
     compact — solid navy, short, left-aligned.
   Content is only hidden from inside the effect (gsap.from), so with
   prefers-reduced-motion — or before JS runs — it is fully visible. */
export function PageHero({ variant = "compact", title, titleAccent, intro, image, imageAlt = "", children }) {
  const ref = useRef(null);
  const isImage = variant === "image";

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return undefined;
    const ctx = gsap.context(() => {
      gsap.from("[data-hero-anim]", {
        y: 32,
        opacity: 0,
        duration: 0.9,
        stagger: 0.08,
        ease: "power3.out",
        delay: 0.15,
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={ref}
      className={`relative overflow-hidden bg-navy section-pad ${
        isImage ? "min-h-[60dvh] flex items-end pt-36 pb-12 md:pb-16" : "pt-36 pb-16"
      }`}
    >
      {isImage && image && (
        <>
          <img src={image} alt={imageAlt} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/70 to-navy/20" />
          <div className="absolute inset-0 bg-gradient-to-b from-navy/70 via-transparent to-navy/60" />
        </>
      )}
      <div className="relative z-10 w-full max-w-6xl mx-auto">
        <div className="max-w-3xl">
          <h1 data-hero-anim className="text-on-dark">
            <span className="block font-heading font-bold text-4xl md:text-6xl tracking-tight leading-[1.02]">
              {title}
            </span>
            {titleAccent && (
              <span className="block font-drama italic text-brand-500 text-4xl md:text-7xl tracking-tight leading-[1]">
                {titleAccent}
              </span>
            )}
          </h1>
          {intro && (
            <p data-hero-anim className="mt-6 text-on-dark/70 text-base md:text-lg max-w-xl leading-relaxed">
              {intro}
            </p>
          )}
          {children && (
            <div data-hero-anim className="mt-8 flex flex-wrap items-center gap-4">
              {children}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
