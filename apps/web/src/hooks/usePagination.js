import { useMemo, useState } from "react";

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Client-side pagination state for an already-loaded array.
 *
 * Returns the current page slice plus setters/metadata. `page` stays in range
 * when the items or pageSize change, but staying in range is not the same as
 * starting over: pass everything that makes it a different list (search text,
 * filters) as `resetKey` and a change to it goes back to page 1. Leave it out
 * for a list that only refreshes, so a refetch keeps the visitor's place.
 *
 * Both are adjusted during render, so no frame shows the wrong page.
 */
export function usePagination(items, { initialPageSize = DEFAULT_PAGE_SIZE, resetKey } = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [seenResetKey, setSeenResetKey] = useState(resetKey);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey);
    setPage(1);
  } else if (page > totalPages) {
    setPage(totalPages);
  }

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
