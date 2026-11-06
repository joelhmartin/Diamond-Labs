import { useEffect, useRef } from "react";
import { clsx } from "clsx";

/**
 * A right-hand side panel over a dimmed backdrop. Escape and a click on the
 * backdrop call `onClose`; focus moves into the panel on open; the panel is an
 * aria-modal dialog named `label`. The caller supplies the header and body as
 * children; `className` styles the panel (width, background).
 */
export function Drawer({ onClose, label, children, className }) {
  const panelRef = useRef(null);
  // Runs once per mount (onClose read through a ref): callers pass an inline
  // onClose, and re-running on every render would yank focus out of inputs.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault(); // tells a DataTable behind the drawer that this Esc was spent closing it
        onCloseRef.current?.();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={clsx("flex h-full w-full flex-col overflow-y-auto shadow-2xl focus:outline-none", className)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
