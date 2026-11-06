/** useDataTable's { page, pageSize, q } → the `limit` / `offset` / `q` query the paged list endpoints take. */
export function pageParams({ page, pageSize, q }) {
  const out = { limit: pageSize, offset: (page - 1) * pageSize };
  const text = typeof q === "string" ? q.trim() : "";
  if (text) out.q = text;
  return out;
}

/**
 * Every row of a paged list, for a dropdown that needs the whole set (never a silent cap).
 * `getPage({ limit, offset }) → { rows, total }`; pages until `total` rows are in (or a page comes back empty).
 */
export async function fetchAllRows(getPage, pageSize = 200) {
  const all = [];
  for (;;) {
    const { rows, total } = await getPage({ limit: pageSize, offset: all.length });
    all.push(...rows);
    if (!rows.length || all.length >= total) return all;
  }
}
