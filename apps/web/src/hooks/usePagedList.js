import { useEffect, useState } from "react";
import { pageSlice, paginationProps } from "../lib/data-table/table-state.js";

/**
 * Client-side paging for a plain list outside useDataTable. Goes back to page 1
 * when any of `resetKeys` (search text, filters) changes, and keeps the page
 * state itself clamped when the list shrinks, so clearing a filter never
 * jumps back to a stale high page.
 */
export function usePagedList(rows, { resetKeys = [], initialPageSize = 12 } = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, resetKeys);

  const pagination = paginationProps({ total: rows.length, page, pageSize, setPage, setPageSize });
  useEffect(() => {
    if (page !== pagination.page) setPage(pagination.page);
  }, [page, pagination.page]);

  return { pagination, paged: pageSlice(rows, pagination.page, pageSize), pageSize };
}
