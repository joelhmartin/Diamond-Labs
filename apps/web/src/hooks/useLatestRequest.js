import { useCallback, useEffect, useRef } from "react";

/**
 * Last-request-wins guard. Returns `run(promiseFactory)` resolving to
 * `{ stale, value }`; `stale` is true when a newer `run` started (or the
 * component unmounted) before this one settled, so the caller drops it.
 * A rejection rejects only when the request is still the newest; a stale
 * failure resolves `{ stale: true }`.
 */
export function useLatestRequest() {
  const seq = useRef(0);
  useEffect(() => () => { seq.current += 1; }, []);
  return useCallback(async (promiseFactory) => {
    const mine = ++seq.current;
    try {
      const value = await promiseFactory();
      return { stale: mine !== seq.current, value };
    } catch (err) {
      if (mine !== seq.current) return { stale: true, value: undefined };
      throw err;
    }
  }, []);
}
