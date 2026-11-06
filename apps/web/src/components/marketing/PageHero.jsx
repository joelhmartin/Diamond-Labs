import { useEffect, useRef } from "react";
import gsap from "gsap";
import { prefersReducedMotion } from "../../lib/reducedMotion";
import { HeroStage } from "./HeroStage";

/* Hero intro: staggered rise of [data-hero-anim] children. Does nothing under
   reduced motion. Returns the gsap context so the caller can revert it. */
export function playHeroIntro(root) {
  if (prefersReducedMotion()) return null;
  return gsap.context(() => {
    gsap.from("[data-hero-anim]", {
      y: 32,
      opacity: 0,
      duration: 0.9,
      stagger: 0.08,
      ease: "power3.out",
      delay: 0.15,
    });
  }, root);
}

/* Shared interior-page hero, on the home hero's backdrop so every page opens
   the same way. Dark from the top edge so the white nav stays legible.
     product — transparent appliance cut-out, right of the text at lg+ and below
               it on smaller screens.
     media   — any other element in that same slot, such as a Lottie.
     image   — full-bleed photo under a left-weighted scrim, for real lab photos.
   Content is only hidden from inside the effect (gsap.from), so with
   prefers-reduced-motion — or before JS runs — it is fully visible. */
export function PageHero({ variant = "compact", title, titleAccent, intro, image, imageAlt = "", product, productAlt = "", media, children }) {
  const ref = useRef(null);
  const isImage = variant === "image";
  const hasSideVisual = Boolean(product || media);

  useEffect(() => {
    const ctx = playHeroIntro(ref.current);
    return () => ctx?.revert();
  }, []);

  return (
    <section
      ref={ref}
      className={`relative overflow-hidden bg-navy section-pad ${
        isImage ? "min-h-[60dvh] flex items-end pt-36 pb-12 md:pb-16" : "pt-36 pb-16"
      } ${hasSideVisual ? "lg:min-h-[640px] lg:flex lg:items-center" : ""}`}
    >
      {!isImage && <HeroStage />}
      {isImage && image && (
        <>
          <img src={image} alt={imageAlt} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/70 to-navy/20" />
          <div className="absolute inset-0 bg-gradient-to-b from-navy/70 via-transparent to-navy/60" />
        </>
      )}
      <div className="relative z-10 w-full max-w-6xl mx-auto">
        <div className={hasSideVisual ? "lg:max-w-[52%]" : "max-w-3xl"}>
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
        {hasSideVisual && (
          <div className="mt-10 lg:mt-0 lg:absolute lg:right-0 lg:top-1/2 lg:-translate-y-1/2 lg:w-[46%] pointer-events-none">
            {media ? (
              <div data-hero-anim>{media}</div>
            ) : (
              <img
                data-hero-anim
                src={product}
                alt={productAlt}
                className="block w-[80%] max-w-[420px] mx-auto lg:w-auto lg:max-w-full lg:max-h-[420px] h-auto object-contain drop-shadow-[0_30px_50px_rgba(0,20,60,0.45)]"
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
