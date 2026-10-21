/**
 * Day helpers shared by every import mapper (invoices, orders, balances).
 * Dates travel as "YYYY-MM-DD" lab-local days; a timestamp column gets that
 * day at lab noon so the lab-local day never shifts.
 */

/** The real calendar day "YYYY-MM-DD" at the start of an ISO-ish string; null otherwise. */
export const dayOf = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const day = v.slice(0, 10);
  const d = new Date(`${day}T00:00:00Z`);
  // Round-trip: reject days Date would silently move (2026-02-30) or cannot read (0000-00-00, 2026-13-45).
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day ? day : null;
};

/** A lab-local calendar day as an instant at 17:00 UTC (11:00–12:00 in San Antonio): the day never shifts. */
export const labNoon = (isoDay) => new Date(`${isoDay}T17:00:00Z`);
