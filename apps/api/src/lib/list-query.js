/**
 * Shared bits of the paged list endpoints (invoices, lab orders, payments,
 * shipments). A list is "paged" only when the caller sends `limit`; without it
 * each endpoint keeps its legacy capped response.
 */

/** { limit, offset } when the query asked for a page (offset defaults to 0), else null. */
export function pageOf(query = {}) {
  if (query.limit == null) return null;
  return { limit: query.limit, offset: query.offset ?? 0 };
}

/** The rows of a page out of an in-memory list. */
export function sliceRows(rows, page) {
  return rows.slice(page.offset, page.offset + page.limit);
}

/** A `%q%` pattern for ILIKE/LIKE with the user's own %, _ and \ made literal. */
export function containsPattern(q) {
  return `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** A `q%` pattern (prefix match), same escaping. */
export function prefixPattern(q) {
  return `${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
