/**
 * Report parameter specs and date-range resolution. Pure and timezone-aware:
 * all calendar maths runs on "YYYY-MM-DD" strings (via UTC day numbers), never
 * on millisecond offsets across local midnight, so DST cannot shift a day.
 */
export const PARAM_TYPES = Object.freeze(["dateRange", "date", "select", "multiselect", "number", "toggle", "lookup"]);

export const DATE_PRESETS = Object.freeze([
  "today", "yesterday", "last7", "last30", "mtd", "lastMonth", "qtd", "ytd", "lastYear", "last12m",
]);

const DAY_MS = 86400000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written "YYYY-MM-DD". */
export function isIsoDate(s) {
  const m = typeof s === "string" ? ISO_RE.exec(s) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const toNum = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const fromNum = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** "YYYY-MM-DD" shifted by `n` calendar days (negative goes back). */
export const addDays = (iso, n) => fromNum(toNum(iso) + n);
/** Month may be out of 1..12 (Date.UTC rolls the year). */
const ymd = (y, m, d) => fromNum(Date.UTC(y, m - 1, d) / DAY_MS);

/** Every "YYYY-MM-DD" from `from` to `to`, inclusive (empty when from > to). For zero-filling day buckets. */
export function daysBetween(from, to) {
  const out = [];
  for (let n = toNum(from), end = toNum(to); n <= end; n += 1) out.push(fromNum(n));
  return out;
}

/** Every "YYYY-MM" from the month of `from` to the month of `to`, inclusive. */
export function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** "YYYY-MM-DD" of `now` as seen in `tz`. */
export function localDay(now, tz = "UTC") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Validation message for a custom { from, to } range, or null when fine. */
export function checkCustomRange(range, { maxDays } = {}) {
  if (!range || !isIsoDate(range.from) || !isIsoDate(range.to)) return "Enter a valid start and end date";
  if (range.from > range.to) return "Start date is after the end date";
  const span = toNum(range.to) - toNum(range.from) + 1;
  if (maxDays && span > maxDays) return `Range is longer than ${maxDays} days`;
  return null;
}

function presetRange(preset, today) {
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "today": return [today, today];
    case "yesterday": { const d = addDays(today, -1); return [d, d]; }
    case "last7": return [addDays(today, -6), today];
    case "last30": return [addDays(today, -29), today];
    case "mtd": return [ymd(y, m, 1), today];
    case "lastMonth": return [ymd(y, m - 1, 1), addDays(ymd(y, m, 1), -1)];
    case "qtd": return [ymd(y, Math.floor((m - 1) / 3) * 3 + 1, 1), today];
    case "ytd": return [ymd(y, 1, 1), today];
    case "lastYear": return [ymd(y - 1, 1, 1), ymd(y - 1, 12, 31)];
    case "last12m": return [ymd(y, m - 11, 1), today]; // 11 whole months back plus this month
    default: return null;
  }
}

/**
 * Resolve a preset name or custom { from, to } into inclusive "YYYY-MM-DD"
 * ends plus the equal-length period immediately before (`previous`).
 */
export function resolveDateRange(value, now, tz = "UTC", { maxDays } = {}) {
  let from;
  let to;
  if (typeof value === "string") {
    const r = presetRange(value, localDay(now, tz));
    if (!r) throw new Error(`Unknown date preset "${value}"`);
    [from, to] = r;
  } else {
    const problem = checkCustomRange(value, { maxDays });
    if (problem) throw new Error(problem);
    ({ from, to } = value);
  }
  const len = toNum(to) - toNum(from) + 1;
  const prevTo = addDays(from, -1);
  return { from, to, previous: { from: addDays(prevTo, -(len - 1)), to: prevTo } };
}
