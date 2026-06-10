/* Play a paused GSAP tween when `el` enters the viewport.

   Reliable replacement for ScrollTrigger entrance animations, which
   occasionally get stuck at opacity:0 when their trigger positions are
   cached before fonts / images / async content (e.g. ProductCatalog) settle.
   IntersectionObserver re-evaluates against the live layout, so reveals never
   freeze regardless of when the section actually lands on screen.

   Usage:
     const tween = gsap.fromTo("[data-x]", { y: 30, opacity: 0 },
       { y: 0, opacity: 1, duration: 0.8, stagger: 0.1, ease: "power3.out", paused: true });
     cleanup = playOnView(ref.current, tween);
     // in the effect's return: () => { cleanup?.(); ctx.revert(); }
*/
export function playOnView(el, tween, { threshold = 0.15 } = {}) {
  if (!el || !tween) return () => {};
  const io = new IntersectionObserver(
    ([entry], obs) => {
      if (entry.isIntersecting) {
        tween.play();
        obs.disconnect();
      }
    },
    { threshold }
  );
  io.observe(el);
  return () => io.disconnect();
}
