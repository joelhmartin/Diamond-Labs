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
