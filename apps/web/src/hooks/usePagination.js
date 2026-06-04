import { useEffect, useMemo, useState } from "react";

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Client-side pagination state for an already-loaded array.
 *
 * Returns the current page slice plus setters/metadata. Automatically clamps
 * `page` back into range when the underlying items or pageSize change, so
 * callers don't need to manually reset on search/filter changes.
 */
export function usePagination(items, { initialPageSize = DEFAULT_PAGE_SIZE } = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  return {
    page,
    setPage,
    pageSize,
    setPageSize: (n) => {
      setPageSize(n);
      setPage(1);
    },
    paged,
    total,
    totalPages,
    rangeStart,
    rangeEnd,
  };
}
