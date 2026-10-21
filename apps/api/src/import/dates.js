/**
 * Day helpers shared by every import mapper (invoices, orders, balances).
 * Dates travel as "YYYY-MM-DD" lab-local days; a timestamp column gets that
 * day at lab noon so the lab-local day never shifts.
 */

/** The "YYYY-MM-DD" at the start of an ISO-ish string; null otherwise. */
export const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** A lab-local calendar day as an instant at 17:00 UTC (11:00–12:00 in San Antonio): the day never shifts. */
export const labNoon = (isoDay) => new Date(`${isoDay}T17:00:00Z`);
