/**
 * Calendar maths for AutoPay, evaluated in the LAB's timezone.
 *
 * Uses Intl rather than a date library — the repo has no date dependency and
 * this needs exactly one thing: what day is it where the lab is. Doing this in
 * UTC would charge a whole cohort a day early for any run before ~05:00 UTC.
 */

/** Lab-local calendar parts for an instant. `month` is 1-based. */
export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

/** Days in a 1-based month. Day 0 of the next month is the last of this one. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The day this month that a `dayOfMonth` preference actually charges on.
 * A doctor who picked the 31st is charged on Feb 28 (29 in a leap year) rather
 * than skipped — otherwise short months would silently miss a cycle.
 */
export function resolveChargeDay(year, month, dayOfMonth) {
  return Math.min(Number(dayOfMonth), daysInMonth(year, month));
}

/** Is an enrollment due on this instant, in lab time? */
export function isDueOn(dayOfMonth, date, timeZone) {
  const { year, month, day } = zonedParts(date, timeZone);
  return day === resolveChargeDay(year, month, dayOfMonth);
}

/** Format a 1-based (year, month) as the "YYYY-MM" cycle key string. */
function formatCycleKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * The billing cycle an instant belongs to, e.g. "2026-08". One successful
 * charge per enrollment per cycle — this is the idempotency anchor.
 */
export function cycleKeyFor(date, timeZone) {
  const { year, month } = zonedParts(date, timeZone);
  return formatCycleKey(year, month);
}

/**
 * Walk a 1-based (year, month, day) forward by `days` calendar days. Pure
 * calendar arithmetic via Date.UTC — no timezone conversion happens here, we
 * are just counting days on a calendar page, not consulting a clock.
 */
function addDays(year, month, day, days) {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** RETRY_OFFSETS_DAYS — decline retries fire on charge-day + 2 and + 5 (spec). */
const RETRY_OFFSETS_DAYS = [2, 5];

/**
 * Is `date` (in `timeZone`) a scheduled decline-RETRY day for this
 * `dayOfMonth` preference — day+2 or day+5 after the (month-length-clamped)
 * charge day, correctly rolling into the following month? Returns
 * `{ offset, cycleKey }` on a match, `null` otherwise.
 *
 * `cycleKey` is the BASE cycle — the billing cycle of the charge day this
 * retry is retrying, NOT the calendar month `date` happens to land in. A
 * retry rolling into next month (dayOfMonth 30: charged Apr 30, retries May
 * 2/5) still belongs to April's cycle: the failure it's retrying was logged
 * against April, and a retry that goes on to SUCCEED must be stamped with
 * April too, or it would wrongly satisfy (and later block) May's own charge.
 * Callers must thread this value through instead of re-deriving the cycle
 * from `date` via `cycleKeyFor`.
 *
 * The offset is walked from the CHARGE day actually used that month
 * (`resolveChargeDay`), not the raw preference — a doctor who picked the
 * 31st charges on Feb 28, so their retries are Mar 2 / Mar 5, not a
 * nonexistent "Feb 33/36". Because the base charge day can fall in either
 * the current or the previous lab-local month (a late-month charge day's
 * +5 retry rolls into next month), both are checked — `date`'s own month
 * and the one before it are sufficient since the max offset is 5 days.
 */
export function isRetryDay(dayOfMonth, date, timeZone) {
  const { year, month, day } = zonedParts(date, timeZone);
  const prevMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

  for (const base of [{ year, month }, prevMonth]) {
    const chargeDay = resolveChargeDay(base.year, base.month, dayOfMonth);
    for (const offset of RETRY_OFFSETS_DAYS) {
      const target = addDays(base.year, base.month, chargeDay, offset);
      if (target.year === year && target.month === month && target.day === day) {
        return { offset, cycleKey: formatCycleKey(base.year, base.month) };
      }
    }
  }
  return null;
}
