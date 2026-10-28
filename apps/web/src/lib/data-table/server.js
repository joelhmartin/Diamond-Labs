/** useDataTable's { page, pageSize, q } → the `limit` / `offset` / `q` query the paged list endpoints take. */
export function pageParams({ page, pageSize, q }) {
  const out = { limit: pageSize, offset: (page - 1) * pageSize };
  const text = typeof q === "string" ? q.trim() : "";
  if (text) out.q = text;
  return out;
}
