/* True when the visitor asked the OS/browser for reduced motion. Safe where
   matchMedia is missing (SSR, tests): returns false. */
export function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}
