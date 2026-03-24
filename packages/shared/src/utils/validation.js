/**
 * Slugify a string for URL-safe usage.
 */
export function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parse pagination params with defaults and max limits.
 */
export function parsePagination(query, defaults = { limit: 25, maxLimit: 100 }) {
  let page = parseInt(query?.page, 10) || 1;
  let limit = parseInt(query?.limit, 10) || defaults.limit;

  if (page < 1) page = 1;
  if (limit < 1) limit = 1;
  if (limit > defaults.maxLimit) limit = defaults.maxLimit;

  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
