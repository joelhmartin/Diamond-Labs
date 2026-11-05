import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import gsap from "gsap";
import { playOnView } from "../../lib/playOnView";
import { prefersReducedMotion } from "../../lib/reducedMotion";

/* Closing call-to-action band, extracted from Home's CTA section.
   `titleAccent` and `eyebrow` exist only so Home renders exactly as before;
   interior pages omit both. Actions take `to` (router link) or `href`. */
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

export function CtaBand({ eyebrow, title, titleAccent, intro, primary, secondary }) {
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
          <p data-cta-anim className="mt-6 text-navy/50 text-lg max-w-xl mx-auto leading-relaxed">
            {intro}
          </p>
        )}
        <div data-cta-anim className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Action
            action={primary}
            className="btn-magnetic group px-8 py-4 rounded-full bg-accent-500 text-white font-semibold"
          >
            <span className="btn-bg bg-accent-600 rounded-full" />
            <span className="relative z-10 flex items-center gap-2">
              {primary.label}
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </span>
          </Action>
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
