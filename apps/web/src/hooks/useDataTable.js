import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { applyClient, pageSlice, isEmptyFilterValue, paginationProps } from "../lib/data-table/table-state.js";
import * as Sel from "../lib/data-table/selection.js";
import { useDebouncedValue } from "./useDebouncedValue.js";
import { useLatestRequest } from "./useLatestRequest.js";

const EMPTY = [];
const defaultGetRowId = (r) => r.id;
const always = () => true;

/**
 * State for one <DataTable>: search, filters, sort, paging and selection.
 *
 *   mode "client" — `rows` are already loaded; search (`searchFn`), filters
 *     (each FilterDef's `match`) and sort run in the browser. Optional
 *     `loading`, `error` and `reload` pass the caller's fetch state through so
 *     the table shows it.
 *   mode "server" — `fetchPage({ page, pageSize, q, filters, sort })` returns
 *     `{ rows, total }`. `q` is debounced 300 ms, only the newest response is
 *     kept, and `deps` (fixed length) refetch when they change.
 *
 * `urlKey` mirrors q, filters and page into search params prefixed
 * `<urlKey>.` (e.g. `inv.status`), so a reload or shared link keeps them.
 * Changing q, filters or sort resets to page 1 and clears the selection;
 * paging keeps it. Must render inside a Router.
 */
export function useDataTable(options) {
  const {
    mode = "client",
    rows: clientRows,
    fetchPage,
    searchFn,
    filters: filterDefs = EMPTY,
    initialFilters,
    initialPageSize = 20,
    initialSort = null,
    urlKey,
    getRowId = defaultGetRowId,
    isRowSelectable = always,
    deps = EMPTY,
  } = options;
  const server = mode === "server";

  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => {
    const fromUrl = urlKey ? readUrlState(searchParams, urlKey, filterDefs) : { filters: {} };
    return { q: "", page: 1, ...fromUrl, filters: { ...initialFilters, ...fromUrl.filters } };
  });
  const [q, setQState] = useState(initial.q);
  const [filters, setFilters] = useState(initial.filters);
  const [sort, setSortState] = useState(initialSort);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [sel, setSel] = useState(Sel.emptySelection);
  const debouncedQ = useDebouncedValue(q, 300);

  // Columns live on <DataTable>; it registers them (in a layout effect, every time the array
  // changes) so client sort can read sortValue. Pages often pass a fresh array each render, so
  // state is set only when the shape actually changed: an unconditional same-value setState from
  // a layout effect can't always bail out early and loops render → effect → render.
  const columnsRef = useRef(EMPTY);
  const columnsKeyRef = useRef("");
  const [columnsKey, setColumnsKey] = useState("");
  const registerColumns = useCallback((columns) => {
    columnsRef.current = columns;
    const key = columns.map((c) => `${c.id}${c.sortValue ? "*" : ""}`).join("|");
    if (key === columnsKeyRef.current) return;
    columnsKeyRef.current = key;
    setColumnsKey(key);
  }, []);

  const resetView = () => { setPage(1); setSel(Sel.clear()); };
  const setQ = (v) => { setQState(v); resetView(); };
  const setFilter = (id, v) => { setFilters((f) => ({ ...f, [id]: v })); resetView(); };
  const resetFilters = () => { setFilters(initialFilters ?? {}); setQState(""); resetView(); };
  const setSort = (next) => { setSortState(next); resetView(); };

  const remote = useServerRows({
    enabled: server, fetchPage, deps, getRowId, setSel,
    request: { page, pageSize, q: debouncedQ, filters, sort },
  });

  // Client pipeline. searchFn/filterDefs are read through a ref so inline definitions don't recompute every render.
  const fnRef = useRef({ searchFn, filterDefs });
  fnRef.current = { searchFn, filterDefs };
  const allRows = server ? EMPTY : clientRows ?? EMPTY;
  const matching = useMemo(
    () => (server ? EMPTY : applyClient(allRows, { q, filters, sort, ...fnRef.current, columns: columnsRef.current })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- columnsKey stands in for columnsRef
    [server, allRows, q, filters, sort, columnsKey],
  );

  const total = server ? remote.total : matching.length;
  const pagination = paginationProps({ total, page, pageSize, setPage, setPageSize: setPageSizeState });
  const { totalPages } = pagination;
  useEffect(() => {
    if (total > 0 && page > totalPages) setPage(totalPages);
  }, [total, page, totalPages]);

  const visible = useMemo(
    () => (server ? remote.rows : pageSlice(matching, pagination.page, pageSize)),
    [server, remote.rows, matching, pagination.page, pageSize],
  );

  useEffect(() => {
    if (server) return;
    setSel((s) => (s.ids.size === 0 ? s : shrinkTo(s, allRows.map(getRowId))));
  }, [server, allRows, getRowId]);

  useUrlMirror({ urlKey, filterDefs, searchParams, setSearchParams, state: { q: debouncedQ, filters, page } });

  const selection = useSelectionApi({
    sel, setSel, visible, matching: server ? null : matching, allRows,
    knownRows: remote.knownRows, getRowId, isRowSelectable,
  });

  return {
    rows: visible,
    matchingRows: matching, // client mode: every row passing search + filters (for totals); empty in server mode
    total,
    loading: server ? remote.loading : Boolean(options.loading),
    error: server ? remote.error : options.error ?? null,
    reload: server ? remote.reload : options.reload ?? noop,
    q, setQ, filters, setFilter, resetFilters, sort, setSort,
    pagination,
    selection,
    filterDefs,
    getRowId,
    isRowSelectable,
    mode,
    registerColumns,
  };
}

function noop() {}

/** prune(), but keeps the same object when nothing was dropped (no extra render). */
function shrinkTo(sel, presentIds) {
  const next = Sel.prune(sel, presentIds);
  return next.ids.size === sel.ids.size && next.anchor === sel.anchor ? sel : next;
}

function useServerRows({ enabled, fetchPage, deps, request, getRowId, setSel }) {
  const latest = useLatestRequest();
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const knownRows = useRef(new Map());
  const pruneNext = useRef(false);
  const [rows, setRows] = useState(EMPTY);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const { page, pageSize, q, filters, sort } = request;

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    latest(() => fetchRef.current({ page, pageSize, q, filters, sort }))
      .then(({ stale, value }) => {
        if (stale) return;
        const pageRows = value?.rows ?? EMPTY;
        for (const r of pageRows) knownRows.current.set(getRowId(r), r);
        setRows(pageRows);
        setTotal(value?.total ?? pageRows.length);
        setError(null);
        setLoading(false);
        if (pruneNext.current) {
          pruneNext.current = false;
          setSel((s) => shrinkTo(s, pageRows.map(getRowId)));
        }
      })
      .catch((err) => {
        setError(err);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller deps are spread in on purpose
  }, [enabled, latest, page, pageSize, q, filters, sort, tick, ...deps]);

  // After a reload (usually a bulk action), rows that left the list drop out of the selection.
  const reload = useCallback(() => {
    pruneNext.current = true;
    setTick((t) => t + 1);
  }, []);

  return { rows, total, loading, error, reload, knownRows: knownRows.current };
}

function useSelectionApi({ sel, setSel, visible, matching, allRows, knownRows, getRowId, isRowSelectable }) {
  const pageIds = visible.filter(isRowSelectable).map(getRowId);
  const matchingIds = matching ? matching.filter(isRowSelectable).map(getRowId) : EMPTY;
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => sel.ids.has(id));
  const allMatchingAvailable = Boolean(matching) && pageAllSelected && matchingIds.some((id) => !sel.ids.has(id));

  const selectedRows = useMemo(() => {
    if (sel.ids.size === 0) return EMPTY;
    if (matching) return allRows.filter((r) => sel.ids.has(getRowId(r)));
    return [...sel.ids].map((id) => knownRows.get(id)).filter(Boolean);
    // `visible` changes on every server fetch, which is when knownRows (a stable Map) gets fresh row objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visible stands in for knownRows' contents
  }, [sel, matching, allRows, knownRows, getRowId, visible]);

  return {
    ids: sel.ids,
    count: sel.ids.size,
    isSelected: (id) => sel.ids.has(id),
    click(row, event = {}, orderedIds = pageIds) {
      if (!isRowSelectable(row)) return;
      const id = getRowId(row);
      const range = Boolean(event.shiftKey);
      const toggle = !range && Boolean(event.metaKey || event.ctrlKey);
      setSel((s) => Sel.clickRow(s, { id, orderedIds, range, toggle, replace: !range && !toggle }));
    },
    togglePage: (on) => setSel((s) => Sel.setPage(s, pageIds, on)),
    pageAllSelected,
    pageSomeSelected: pageIds.some((id) => sel.ids.has(id)),
    selectAllMatching: () => setSel((s) => Sel.selectAll(s, matchingIds)),
    allMatchingAvailable,
    matchingCount: matchingIds.length,
    clear: () => setSel(Sel.clear()),
    selectedRows,
  };
}

// ---- URL mirroring -------------------------------------------------------

function readUrlState(params, urlKey, filterDefs) {
  const key = (k) => `${urlKey}.${k}`;
  const filters = {};
  for (const def of filterDefs) {
    const k = key(def.id);
    if (!params.has(k)) continue;
    if (def.type === "multiselect") filters[def.id] = params.getAll(k);
    else if (def.type === "toggle") filters[def.id] = params.get(k) === "1";
    else filters[def.id] = params.get(k);
  }
  const out = { filters };
  if (params.has(key("q"))) out.q = params.get(key("q"));
  const page = Number(params.get(key("page")));
  if (Number.isInteger(page) && page > 1) out.page = page;
  return out;
}

function writeUrlState(params, urlKey, { q, filters, page }, filterDefs) {
  const next = new URLSearchParams(params);
  for (const k of [...next.keys()]) if (k.startsWith(`${urlKey}.`)) next.delete(k);
  if (q && q.trim()) next.set(`${urlKey}.q`, q);
  for (const def of filterDefs) {
    const v = filters[def.id];
    if (isEmptyFilterValue(v)) continue;
    const k = `${urlKey}.${def.id}`;
    if (Array.isArray(v)) v.forEach((item) => next.append(k, item));
    else next.set(k, v === true ? "1" : String(v));
  }
  if (page > 1) next.set(`${urlKey}.page`, String(page));
  return next;
}

function useUrlMirror({ urlKey, filterDefs, searchParams, setSearchParams, state }) {
  const { q, filters, page } = state;
  useEffect(() => {
    if (!urlKey) return;
    const next = writeUrlState(searchParams, urlKey, { q, filters, page }, filterDefs);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterDefs is read, not watched
  }, [urlKey, q, filters, page, searchParams, setSearchParams]);
}
