import { isStagingBuild } from "../../lib/app-env.js";

/** Fixed, high-contrast strip shown only in staging builds (VITE_APP_ENV=staging). */
export default function StagingBanner({ appEnv = import.meta.env.VITE_APP_ENV }) {
  if (!isStagingBuild(appEnv)) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 2147483647,
        background: "#ffd400",
        color: "#000",
        textAlign: "center",
        fontWeight: 700,
        fontSize: "13px",
        letterSpacing: "0.04em",
        padding: "6px 12px",
        borderTop: "2px solid #000",
        pointerEvents: "none",
      }}
    >
      STAGING — test data, sandbox payments
    </div>
  );
}
