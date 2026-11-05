import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polls a count (`fetchCount() → number`) every `intervalMs` while the tab is
 * visible. Hidden tabs do not poll; becoming visible refreshes at once.
 * Returns the count, `refresh()` to re-read it, and `setCount` for optimistic updates.
 */
export function useUnreadPoll(fetchCount, { intervalMs = 60_000 } = {}) {
  const [count, setCount] = useState(0);
  const fetchRef = useRef(fetchCount);
  fetchRef.current = fetchCount;

  const refresh = useCallback(async () => {
    try {
      const n = await fetchRef.current();
      if (Number.isFinite(n)) setCount(n);
    } catch {
      // keep the last known count; the next tick tries again
    }
  }, []);

  useEffect(() => {
    const visible = () => document.visibilityState !== "hidden";
    let timer = null;
    const start = () => { if (timer == null) timer = setInterval(refresh, intervalMs); };
    const stop = () => { clearInterval(timer); timer = null; };
    const onVisibility = () => {
      if (visible()) { refresh(); start(); } else stop();
    };
    if (visible()) { refresh(); start(); }
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refresh, intervalMs]);

  return { count, refresh, setCount };
}
