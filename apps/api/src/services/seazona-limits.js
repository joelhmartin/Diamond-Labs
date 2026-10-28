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
// Seazona truncates the invoice list at this many rows.
export const LIST_PAGE_CAP = 10_000;
// The order list returns at most 100 rows per call (seen live 2026-10-26: a
// walk from 1900 came back with exactly 100 orders, Aug-Sep 2024).
export const ORDER_LIST_PAGE_CAP = 100;
