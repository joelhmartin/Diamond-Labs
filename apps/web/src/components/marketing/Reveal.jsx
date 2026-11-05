import { useEffect, useRef } from "react";
import gsap from "gsap";
import { playOnView } from "../../lib/playOnView";
import { prefersReducedMotion } from "../../lib/reducedMotion";

/* Fade-and-rise once when `el` scrolls into view. Skipped entirely under
   reduced motion. Returns a cleanup function. Content is only hidden from
   inside this function (never in markup), and playOnView uses a live
   IntersectionObserver so it still reveals after route changes or fast scrolls. */
export function revealOnView(el) {
  if (!el || prefersReducedMotion()) return () => {};
  let stop;
  const ctx = gsap.context(() => {
    const tween = gsap.fromTo(
      el,
      { y: 40, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.8, ease: "power3.out", paused: true }
    );
    stop = playOnView(el, tween);
  }, el);
  return () => {
    stop?.();
    ctx.revert();
  };
}

/* One quiet reveal per section: wrap a section's content, no per-child stagger. */
export function Reveal({ as: Tag = "section", className, children, ...rest }) {
  const ref = useRef(null);
  useEffect(() => revealOnView(ref.current), []);
  return (
    <Tag ref={ref} className={className} {...rest}>
      {children}
    </Tag>
  );
}
