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

/**
 * The billing cycle an instant belongs to, e.g. "2026-08". One successful
 * charge per enrollment per cycle — this is the idempotency anchor.
 */
export function cycleKeyFor(date, timeZone) {
  const { year, month } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}`;
}
