// Pure layout helpers for the calendar grid. Dates are "YYYY-MM-DD" strings; all math is UTC
// day arithmetic on the parsed parts, so daylight-saving never shifts a cell.

const DAY_MS = 86400000;
const parse = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const format = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date, n) => format(parse(date) + n * DAY_MS);
export const weekdayOf = (date) => new Date(parse(date)).getUTCDay();

/** The 7 days (Sunday first) of the week holding `anchorDate`. */
export function weekCells(anchorDate) {
  const start = addDays(anchorDate, -weekdayOf(anchorDate));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** 42 days (6 Sunday-first weeks) starting on the Sunday on or before the 1st of `anchorDate`'s month. */
export function monthCells(anchorDate) {
  const first = `${anchorDate.slice(0, 7)}-01`;
  const start = addDays(first, -weekdayOf(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The anchor one month or one week away. A month step lands on the 1st of the target month. */
export function shiftAnchor(anchorDate, view, direction) {
  if (view === "week") return addDays(anchorDate, 7 * direction);
  const [y, m] = anchorDate.split("-").map(Number);
  return format(Date.UTC(y, m - 1 + direction, 1));
}

/** The first and last date shown for this anchor and view (what to ask `…/days` for). */
export function rangeFor(anchorDate, view) {
  const cells = view === "week" ? weekCells(anchorDate) : monthCells(anchorDate);
  return { from: cells[0], to: cells[cells.length - 1] };
}

export const monthTitle = (anchorDate) =>
  new Date(parse(`${anchorDate.slice(0, 7)}-01`)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
