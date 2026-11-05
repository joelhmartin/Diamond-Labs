import { CalendarError } from "./errors.js";

/**
 * Pure calendar rules. Dates are "YYYY-MM-DD" strings in the calendar's own
 * timezone; all day math is Date.UTC on parsed parts, so DST never shifts a day.
 */

export const DEFAULT_CALENDAR = Object.freeze({
  key: "default",
  timezone: "UTC",
  leadDays: 0,
  closedWeekdays: [],
  holidays: new Set(),
  capacityBasis: "none",
  capacityByWeekday: {},
});

const NEAR_RATIO = 0.85;

const parts = (date) => date.split("-").map(Number);
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Normalise a stored row (jsonb columns) plus its holiday dates into a Calendar value. */
export function toCalendar(row, holidayDates = []) {
  const closed = Array.isArray(row?.closedWeekdays) ? row.closedWeekdays.map(Number) : [];
  const byDay = row?.capacityByWeekday && typeof row.capacityByWeekday === "object" ? row.capacityByWeekday : {};
  return {
    key: row?.key ?? DEFAULT_CALENDAR.key,
    timezone: row?.timezone ?? DEFAULT_CALENDAR.timezone,
    leadDays: row?.leadDays ?? 0,
    closedWeekdays: closed,
    holidays: new Set(holidayDates),
    capacityBasis: row?.capacityBasis ?? "none",
    capacityByWeekday: byDay,
  };
}

/** "YYYY-MM-DD" of `instant` as seen in `timezone`. */
export function dateIn(timezone, instant = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekdayOf(date) {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date, n) {
  const [y, m, d] = parts(date);
  return fromMs(Date.UTC(y, m - 1, d + n));
}

export function isOpen(date, calendar) {
  return !calendar.closedWeekdays.includes(weekdayOf(date)) && !calendar.holidays.has(date);
}

/** First open day at or beyond `date` in direction `step` (+1 / -1). */
function scan(date, step, calendar) {
  const limit = 366 + (calendar.holidays?.size ?? 0);
  let cur = date;
  for (let i = 0; i <= limit; i += 1) {
    if (isOpen(cur, calendar)) return cur;
    cur = addDays(cur, step);
  }
  throw new CalendarError("NO_OPEN_DAYS", "The calendar has no open day.");
}

/** `date` itself when open, otherwise the next open day. */
export function nextOpenDay(date, calendar) {
  return scan(date, 1, calendar);
}

function stepBusiness(date, n, step, calendar) {
  let cur = scan(date, step, calendar);
  for (let left = n; left > 0; left -= 1) cur = scan(addDays(cur, step), step, calendar);
  return cur;
}

/** The start day is not counted; closed weekdays and holidays are skipped. n = 0 on a closed day rolls forward. */
export function addBusinessDays(date, n, calendar) {
  return stepBusiness(date, n, 1, calendar);
}

/** Mirror of addBusinessDays; n = 0 on a closed day rolls back to the previous open day. */
export function subtractBusinessDays(date, n, calendar) {
  return stepBusiness(date, n, -1, calendar);
}

/** Open days in (from, to]; negative when `to` is before `from`. */
export function businessDaysBetween(from, to, calendar) {
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  const [lo, hi] = sign > 0 ? [from, to] : [to, from];
  let count = 0;
  for (let cur = addDays(lo, 1); cur <= hi; cur = addDays(cur, 1)) {
    if (isOpen(cur, calendar)) count += 1;
  }
  return sign * count;
}

/** null = no limit; 0 on a closed day; otherwise that weekday's limit. */
export function capacityFor(date, calendar) {
  if (calendar.capacityBasis === "none") return null;
  if (!isOpen(date, calendar)) return 0;
  const limit = calendar.capacityByWeekday?.[weekdayOf(date)];
  return limit == null ? null : limit;
}

export function loadLevel(count, capacity) {
  if (capacity == null) return "none";
  if (count > capacity) return "over";
  if (capacity > 0 && count / capacity >= NEAR_RATIO) return "near";
  return "under";
}

/** One entry per day in [from, to]. `counts` is a Map<date, number>. */
export function calendarDays(calendar, from, to, counts = new Map()) {
  const out = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const capacity = capacityFor(date, calendar);
    const count = counts.get(date) ?? 0;
    out.push({
      date,
      weekday: weekdayOf(date),
      open: isOpen(date, calendar),
      holiday: calendar.holidayLabels?.get(date) ?? (calendar.holidays.has(date) ? "Holiday" : null),
      capacity,
      count,
      level: loadLevel(count, capacity),
    });
  }
  return out;
}
