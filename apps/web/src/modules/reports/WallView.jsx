import { useEffect, useId, useRef } from "react";
import { AlertTriangle, Minimize2, RefreshCw } from "lucide-react";
import { errorText } from "../../lib/requests.js";
import { useVisibleInterval } from "./useVisibleInterval.js";

export const WALL_RERUN_MS = 60000;

/** "Updated 3:04 PM" from the result's generatedAt, in the viewer's clock. */
const updatedText = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `Updated ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
};

/**
 * A report shown full screen for a wall display (a report with `display:
 * "wall"`): a fixed overlay with large type that re-runs the report every
 * 60 s while the page is visible. Esc or the Exit button closes it. `failed`
 * (the error of the latest re-run, while older figures are shown) adds a
 * "Couldn't refresh" badge; the caller keeps the last good data on screen.
 *
 *   <WallView title onExit rerun generatedAt failed?>{chart and table}</WallView>
 */
export function WallView({ title, onExit, rerun, generatedAt, failed = null, children }) {
  const titleId = useId();
  const exitRef = useRef(null);
  useVisibleInterval(rerun, WALL_RERUN_MS);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onExit(); };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    exitRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onExit]);

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby={titleId}
      className="fixed inset-0 z-50 space-y-6 overflow-y-auto bg-white p-6 text-lg md:p-10 [&_td]:text-lg [&_th]:text-base"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 id={titleId} className="font-heading text-4xl font-bold tracking-tight text-navy md:text-5xl">{title}</h1>
        <div className="flex items-center gap-4">
          {failed && (
            <span role="status" className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700" title={errorText(failed)}>
              <AlertTriangle size={14} aria-hidden="true" /> Couldn't refresh · showing the last figures
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 font-mono text-sm text-navy/50">
            <RefreshCw size={14} aria-hidden="true" /> {updatedText(generatedAt) || "Refreshes every minute"}
          </span>
          <button
            ref={exitRef} type="button" onClick={onExit} aria-label="Exit wall view"
            className="inline-flex items-center gap-2 rounded-full border border-surface-300 px-4 py-2 text-sm font-medium text-navy transition hover:scale-[1.03] hover:bg-surface-50"
          >
            <Minimize2 size={14} aria-hidden="true" /> Exit (Esc)
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
