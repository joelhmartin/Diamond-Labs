/**
 * Seazona's request limits, in one env-free module. seazona.service.js enforces
 * them and re-exports them; piece 5's operator CLIs import them from here so
 * their pacing and request estimates are derived from the service's numbers
 * (importing the service itself would load config/env.js).
 */
export const RATE_LIMIT_WINDOW_MS = 60_000;
// Deliberately under the documented 60: leaves headroom for clock skew and for
// any traffic from another process sharing this integration's quota.
export const MAX_REQUESTS_PER_WINDOW = 50;
// Seazona truncates the invoice and order lists at this many rows.
export const LIST_PAGE_CAP = 10_000;
