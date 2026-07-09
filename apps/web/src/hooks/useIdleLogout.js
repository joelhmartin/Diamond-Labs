import { useEffect } from "react";
import { useAuthStore, IDLE_TIMEOUT_MS } from "../stores/auth.store.js";

export { IDLE_TIMEOUT_MS };

/**
 * HIPAA §164.312(a)(2)(iii) — Automatic logoff.
 *
 * Optional convenience hook for mounting the idle-logoff watcher at an
 * authenticated app shell. The watcher is ALSO armed automatically by the auth
 * store's subscription whenever the user becomes authenticated, so mounting this
 * hook is not strictly required — but doing so is safe: startIdleWatch /
 * stopIdleWatch are idempotent and a single set of activity listeners/timer is
 * shared regardless of how many times the watch is (re)started.
 *
 * Mount ONCE (e.g. in the authenticated shell) if you want React-lifecycle
 * control over the watcher.
 */
export function useIdleLogout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const startIdleWatch = useAuthStore((s) => s.startIdleWatch);
  const stopIdleWatch = useAuthStore((s) => s.stopIdleWatch);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    startIdleWatch();
    return () => stopIdleWatch();
  }, [isAuthenticated, startIdleWatch, stopIdleWatch]);
}
