/**
 * Calendar-day arithmetic on "YYYY-MM-DD" strings, done in UTC so no zone or
 * DST shift can move a date. The one implementation for the API and the web:
 * anything that adds days to, or counts days between, plain dates uses these.
 * (Which day is "today" is a zone question: see isoDateIn.)
 */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function parts(iso) {
  const m = ISO_DAY.exec(typeof iso === "string" ? iso : "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True for a "YYYY-MM-DD" that names a real day (no 2026-02-30, no month 13). */
export function isCalendarDate(iso) {
  const p = parts(iso);
  if (!p) return false;
  const [y, m, d] = p;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * "YYYY-MM-DD" plus n calendar days (n may be negative). Throws RangeError on
 * anything not shaped YYYY-MM-DD; an impossible day rolls over (2026-02-30 +
 * 0 → 2026-03-02), which is how callers can detect one.
 */
export function addIsoDays(iso, n) {
  const p = parts(iso);
  if (!p) throw new RangeError(`Not a YYYY-MM-DD date: ${iso}`);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

/** Whole calendar days from a to b (negative when b is earlier). Throws RangeError on a malformed date. */
export function daysBetween(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) throw new RangeError(`Not a YYYY-MM-DD date: ${pa ? b : a}`);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / DAY_MS);
}
