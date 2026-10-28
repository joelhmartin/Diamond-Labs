/**
 * Client-mode table pipeline: search → filters → sort, then page. Pure, so the
 * hook and any page that needs the same answer (counts, exports) agree.
 */

/** Blank string, null/undefined, false (an off toggle) and empty lists mean "no filter". */
export function isEmptyFilterValue(v) {
  if (v == null || v === false) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function applyClient(rows, { q, filters = {}, sort, searchFn, filterDefs = [], columns = [] } = {}) {
  let out = rows;
  const query = typeof q === "string" ? q.trim() : "";
  if (query && searchFn) out = out.filter((row) => searchFn(row, query));

  for (const def of filterDefs) {
    const value = filters[def.id];
    if (!def.match || isEmptyFilterValue(value)) continue;
    out = out.filter((row) => def.match(row, value));
  }

  const column = sort?.id ? columns.find((c) => c.id === sort.id) : null;
  if (column?.sortValue) {
    const sign = sort.dir === "desc" ? -1 : 1;
    out = out
      .map((row, index) => ({ row, index, key: column.sortValue(row) }))
      .sort((a, b) => compareKeys(a.key, b.key, sign) || a.index - b.index)
      .map((x) => x.row);
  }
  return out === rows ? rows.slice() : out;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Blanks always sort last, whichever direction. */
function compareKeys(a, b, sign) {
  const aBlank = a == null || a === "";
  const bBlank = b == null || b === "";
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1;
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (typeof a === "number" && typeof b === "number") return sign * (a - b);
  return sign * collator.compare(String(a), String(b));
}

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const DEFAULT_PAGE_SIZE = 20;

export function pageSlice(rows, page, pageSize) {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}
