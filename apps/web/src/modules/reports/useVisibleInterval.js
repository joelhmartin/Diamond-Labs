import { useEffect, useRef } from "react";

/**
 * Call `callback` every `intervalMs` while the page is visible and `enabled`.
 * Hidden stops it; becoming visible again calls it at once and resumes; turning
 * `enabled` off or unmounting stops it. The latest `callback` is always used.
 * Shared by FeedTile (30 s polling) and the report Wall view (60 s re-run).
 */
export function useVisibleInterval(callback, intervalMs, enabled = true) {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const start = () => { timer ??= setInterval(() => ref.current?.(), intervalMs); };
    const stop = () => { clearInterval(timer); timer = null; };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") stop();
      else if (timer === null) {
        ref.current?.();
        start();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs]);
}
