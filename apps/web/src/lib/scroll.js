import gsap from "gsap";

/**
 * Layouts that scroll an inner box rather than the document (e.g. AppShell's
 * `<main class="overflow-auto">`) mark that box with this attribute. Those
 * nodes belong to the layout route, so they survive child navigations and
 * keep their scrollTop unless it is reset explicitly.
 */
export const SCROLL_CONTAINER_ATTR = "data-scroll-container";

/**
 * Put every scrollable surface back at the top after a route change.
 *
 * `behavior: "instant"` is required, not cosmetic: `html` sets
 * `scroll-behavior: smooth`, which would make this an async animation that
 * ScrollTrigger.refresh() can snapshot mid-flight and restore.
 */
export function resetScrollPositions({ win = globalThis.window, doc = globalThis.document } = {}) {
  win?.scrollTo?.({ top: 0, left: 0, behavior: "instant" });

  const containers = doc?.querySelectorAll?.(`[${SCROLL_CONTAINER_ATTR}]`) ?? [];
  for (const el of containers) {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  }
}

const MAX_STEP_SECONDS = 1 / 15; // keeps a stalled frame from becoming a jump
const ARRIVED_PX = 0.5;
const ARRIVED_PX_PER_SECOND = 20;

let glide = null;

export const isGliding = () => glide !== null;

/* Moves the window to `top` on a critically damped spring. Calling it again during a
   glide changes the destination and keeps the current speed, so the motion stays smooth
   however often the destination changes. smoothTime is roughly how long the page takes
   to cover most of the distance. `behavior: "instant"` is required for the reason given
   above. */
export function glideTo(top, { smoothTime = 0.3, onComplete, onInterrupt } = {}) {
  const speed = glide?.speed ?? 0;
  const position = glide?.position ?? window.scrollY;
  glide?.interrupt();

  const current = { position, speed };
  const stop = () => {
    gsap.ticker.remove(tick);
    if (glide === current) glide = null;
  };
  function tick(_time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, MAX_STEP_SECONDS);
    const omega = 2 / smoothTime;
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const offset = current.position - top;
    const pull = (current.speed + omega * offset) * dt;
    current.speed = (current.speed - omega * pull) * decay;
    current.position = top + (offset + pull) * decay;
    if (Math.abs(current.position - top) < ARRIVED_PX && Math.abs(current.speed) < ARRIVED_PX_PER_SECOND) {
      window.scrollTo({ top, behavior: "instant" });
      stop();
      onComplete?.();
      return;
    }
    window.scrollTo({ top: current.position, behavior: "instant" });
  }
  current.interrupt = () => {
    stop();
    onInterrupt?.();
  };
  glide = current;
  gsap.ticker.add(tick);
  return current;
}
