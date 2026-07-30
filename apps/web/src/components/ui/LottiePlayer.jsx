import { useEffect, useRef } from "react";

/* Self-hosted Lottie player.

   Renders a Lottie JSON served from our own origin as inline SVG. Deliberately
   NOT an <iframe> to a third-party CDN — the site's CSP only allows
   frame-src 'self' + Authorize.net, so hosted-player embeds get blocked in
   production.

   The player itself is dynamically imported (and the JSON only fetched) once
   the element scrolls into view, so neither lands in the initial bundle. Uses
   the `lottie_light` build: SVG renderer, no expression evaluator, so nothing
   calls eval() and script-src 'self' stays intact.

   Usage:
     <LottiePlayer src="/animations/hero-lottie.json" width={750} height={680} />
*/
export default function LottiePlayer({
  src,
  className = "",
  loop = true,
  autoplay = true,
  style,
  ariaHidden = true,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let anim = null;
    let cancelled = false;

    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const load = async () => {
      const { default: lottie } = await import(
        "lottie-web/build/player/lottie_light"
      );
      if (cancelled) return;
      anim = lottie.loadAnimation({
        container: el,
        renderer: "svg",
        loop,
        autoplay: autoplay && !reduceMotion,
        path: src,
        rendererSettings: { progressiveLoad: true },
      });
      // Reduced motion: show the composition, hold it still.
      if (reduceMotion) anim.addEventListener("DOMLoaded", () => anim.goToAndStop(0, true));
    };

    const io = new IntersectionObserver(
      ([entry], obs) => {
        if (entry.isIntersecting) {
          obs.disconnect();
          load();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);

    return () => {
      cancelled = true;
      io.disconnect();
      anim?.destroy();
    };
  }, [src, loop, autoplay]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={style}
      aria-hidden={ariaHidden || undefined}
    />
  );
}
