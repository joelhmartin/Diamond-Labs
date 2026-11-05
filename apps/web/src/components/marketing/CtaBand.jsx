import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import gsap from "gsap";
import { playOnView } from "../../lib/playOnView";
import { prefersReducedMotion } from "../../lib/reducedMotion";
import { HeroStage } from "./HeroStage";

/* Closing call-to-action band, extracted from Home's CTA section.
   `titleAccent` and `eyebrow` exist only so Home renders exactly as before;
   interior pages omit both. Passing `product` (a transparent appliance cut-out)
   turns the band into a dark panel on the hero backdrop; `productFlush` stands the
   image on the panel's bottom edge, for a photo cropped at the bottom. Actions take `to`
   (router link) or `href`. */
function Action({ action, className, children }) {
  if (action.href) {
    return (
      <a href={action.href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={action.to} className={className}>
      {children}
    </Link>
  );
}

function PrimaryAction({ action }) {
  return (
    <Action
      action={action}
      className="btn-magnetic group px-8 py-4 rounded-full bg-accent-500 text-white font-semibold"
    >
      <span className="btn-bg bg-accent-600 rounded-full" />
      <span className="relative z-10 flex items-center gap-2">
        {action.label}
        <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
      </span>
    </Action>
  );
}

export function CtaBand({ eyebrow, title, titleAccent, intro, primary, secondary, product, productAlt = "", productFlush = false }) {
  const sectionRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    let cleanup;
    const ctx = gsap.context(() => {
      const tween = gsap.fromTo(
        "[data-cta-anim]",
        { y: 40, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, stagger: 0.1, ease: "power3.out", paused: true }
      );
      cleanup = playOnView(sectionRef.current, tween);
    }, sectionRef);
    return () => {
      cleanup?.();
      ctx.revert();
    };
  }, []);

  if (product) {
    return (
      <section ref={sectionRef} className="section-pad py-20 md:py-28">
        <div className="relative overflow-hidden max-w-6xl mx-auto rounded-[2.5rem] md:rounded-[3rem] bg-navy">
          <HeroStage />
          <div className={`relative z-10 grid lg:grid-cols-2 gap-8 items-center p-8 md:p-14 ${productFlush ? "!pb-0" : ""}`}>
            <div className={productFlush ? "lg:pb-14" : undefined}>
              <h2 data-cta-anim className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-on-dark">
                {title}
                {titleAccent && (
                  <span className="block font-drama italic text-brand-400">{titleAccent}</span>
                )}
              </h2>
              {intro && (
                <p data-cta-anim className="mt-5 text-on-dark/75 text-lg leading-relaxed">
                  {intro}
                </p>
              )}
              <div data-cta-anim className="mt-8 flex flex-wrap items-center gap-4">
                <PrimaryAction action={primary} />
                {secondary && (
                  <Action
                    action={secondary}
                    className="px-8 py-4 rounded-full bg-white/5 border border-white/20 text-white/85 font-medium hover:bg-white/10 transition-colors duration-300"
                  >
                    {secondary.label}
                  </Action>
                )}
              </div>
            </div>
            <img
              data-cta-anim
              src={product}
              alt={productAlt}
              className={
                productFlush
                  ? "w-full max-w-[640px] mx-auto self-end h-auto object-contain"
                  : "w-[80%] max-w-[440px] mx-auto h-auto object-contain drop-shadow-[0_30px_50px_rgba(0,20,60,0.45)]"
              }
            />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className="section-pad py-24 md:py-28">
      <div className="max-w-4xl mx-auto text-center">
        {eyebrow && (
          <span data-cta-anim className="font-mono text-xs text-navy/40 uppercase tracking-widest">
            {eyebrow}
          </span>
        )}
        <h2 data-cta-anim className="mt-4 font-heading font-bold text-3xl md:text-5xl tracking-tight">
          {title}
          {titleAccent && (
            <>
              <br />
              <span className="font-drama italic text-brand-500">{titleAccent}</span>
            </>
          )}
        </h2>
        {intro && (
          <p data-cta-anim className="mt-6 text-navy/70 text-lg max-w-xl mx-auto leading-relaxed">
            {intro}
          </p>
        )}
        <div data-cta-anim className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <PrimaryAction action={primary} />
          {secondary && (
            <Action
              action={secondary}
              className="px-8 py-4 rounded-full border border-surface-300 text-navy/70 font-medium hover:bg-surface-200/60 transition-colors duration-300"
            >
              {secondary.label}
            </Action>
          )}
        </div>
      </div>
    </section>
  );
}
