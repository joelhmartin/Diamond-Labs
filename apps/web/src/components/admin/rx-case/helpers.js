
// ── Pure helpers (exported for tests) ───────────────────────────────────────

/**
 * Why the release button is disabled, in words. A greyed-out button with no
 * explanation is the thing staff will complain about; naming the selection
 * that blocks it turns a dead end into a next action.
 *
 * Mirrors the server's canRelease gate (case-gates.js): a case with nothing to
 * release is refused the same as a case with an unresolved line — both read
 * "This case has no lines to release." / "Needs a product code for: …" rather
 * than a generic disabled state.
 */
export function releaseBlockedReason(lines = []) {
  const emitting = lines.filter((l) => !l.noteOnly);
  if (emitting.length === 0) {
    return "This case has no lines to release.";
  }
  // Both halves of the server's rule, deliberately. canRelease blocks a line with
  // no seazonaCode REGARDLESS of what its status claims — it was made
  // self-sufficient precisely so a stale "confirmed" can't wave a codeless line
  // through. Mirroring only the status half would light up Release for a case the
  // server then refuses with a 422, which is the dead end this helper exists to
  // prevent.
  const blocking = emitting.filter((l) => l.status === "open" || !l.seazonaCode);
  if (blocking.length === 0) return null;
  const names = blocking.map((l) => l.sourceLabel || l.mapKey).filter(Boolean);
  return `Needs a product code for: ${names.join(", ")}`;
}

const STATUS_COLORS = {
  new: "bg-blue-500/10 text-blue-700",
  in_review: "bg-violet-500/10 text-violet-700",
  awaiting_doctor: "bg-amber-500/10 text-amber-700",
  failed: "bg-red-500/10 text-red-600",
  released: "bg-emerald-500/10 text-emerald-700",
  pushed: "bg-emerald-500/10 text-emerald-700",
  cancelled: "bg-gray-200 text-gray-700",
};

export function statusColor(s) {
  return STATUS_COLORS[s] || "bg-gray-200 text-gray-700";
}

export function errMsg(err) {
  return (
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    "Something went wrong."
  );
}

export function formatDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatBytes(b) {
  const n = Number(b);
  if (!n || Number.isNaN(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** "patientFirstName" / "patient_first_name" -> "Patient First Name" */
export function humanizeKey(key) {
  const spaced = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Render an arbitrary form-answer value (string, array, {first,last}, object) as text. */
export function formatAnswer(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const parts = value.map(formatAnswer).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    if ("first" in value || "last" in value) {
      const full = [value.first, value.last].filter(Boolean).join(" ");
      return full || null;
    }
    const parts = Object.entries(value)
      .map(([k, v]) => {
        const fv = formatAnswer(v);
        return fv ? `${humanizeKey(k)}: ${fv}` : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
