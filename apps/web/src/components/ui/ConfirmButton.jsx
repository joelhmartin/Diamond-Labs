import { useEffect, useRef, useState } from "react";

/**
 * A button that asks twice instead of using a browser dialog: the first click
 * arms it ("Click again to …"), a second click within `windowMs` runs the
 * action. For irreversible or outward-facing actions: issue, void, email, remove.
 */
export function ConfirmButton({ onConfirm, children, confirmLabel = "Click again to confirm", className = "", disabled = false, windowMs = 4000 }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const click = async () => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), windowMs);
      return;
    }
    clearTimeout(timer.current);
    setArmed(false);
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={click}
      disabled={disabled || busy}
      className={`${className} ${armed ? "ring-2 ring-red-400 ring-offset-1" : ""} disabled:opacity-50`}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
