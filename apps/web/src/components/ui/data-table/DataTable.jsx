import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, ChevronRight, Loader2 } from "lucide-react";
import { Pagination } from "../Pagination.jsx";
import { errorText } from "../../../lib/requests.js";
import { groupRows } from "../../../lib/data-table/table-state.js";
import { toCsv, downloadCsv } from "../../../lib/data-table/csv.js";
import { DataTableToolbar } from "./DataTableToolbar.jsx";
import { BulkBar } from "./BulkBar.jsx";

/**
 * Esc that means something else: typed in a field, or an open dialog is taking it (it closes the
 * modal; the selection behind it stays).
 */
function escapeBelongsElsewhere(e) {
  const t = e.target;
  if (t?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog'], [aria-modal='true']")) return true;
  return Boolean(document.querySelector("[role='dialog'], [aria-modal='true']"));
}

/** "Select <first text cell>" so each row's checkbox is named for the row it picks. */
function rowLabelFor(row, columns) {
  for (const col of columns) {
    if (col.export === false && !col.exportValue) continue;
    const v = col.exportValue ? col.exportValue(row) : col.cell(row);
    if ((typeof v === "string" && v.trim()) || typeof v === "number") return `Select ${v}`;
  }
  return "Select row";
}

/** Clicks on these inside a row never select it and never fire onRowClick. */
const IGNORE = "a, button, input, select, textarea, label, [data-row-ignore]";
const ALIGN = { left: "text-left", right: "text-right", center: "text-center" };

/**
 * The one list table. State comes from `useDataTable`; columns describe the
 * cells. Selection: checkbox or ⌘/Ctrl-click toggles, Shift-click extends from
 * the anchor, a plain click runs `onRowClick` (or selects only that row when
 * there is none), Esc clears. `highlightRowId` marks one row (a deep link's
 * target: aria-current and a ring) and scrolls it into view once.
 *
 * `renderExpanded(row)` shows a detail row under an expanded row; `canExpand(row)`
 * (optional) limits the expander to the rows that have one (default: every row).
 *
 * `exportAll` (optional): a function that exports the whole result (every
 * matching row, not just this page; e.g. a server CSV). When set, the toolbar
 * shows "Export CSV" for it; the selected-rows export in the bulk bar is separate.
 */
export function DataTable({
  table,
  columns,
  bulkActions,
  onRowClick,
  rowClassName,
  highlightRowId = null,
  renderExpanded,
  canExpand,
  footer,
  toolbarRight,
  searchable = true,
  searchPlaceholder,
  itemLabel = "rows",
  exportable = true,
  exportFileName = "export.csv",
  exportAll,
  exportFilteredList = false,
  emptyText = "Nothing to show.",
  notice,
  selectable = true,
  dense = false,
  paginated = true,
  groupBy,
}) {
  const { selection, registerColumns } = table;
  const [openId, setOpenId] = useState(null);
  const shiftHeld = useShiftHeld();
  const scrollToHighlight = useScrollOnce(highlightRowId);

  useLayoutEffect(() => registerColumns(columns), [registerColumns, columns]);

  // `exportFilteredList` (client mode): the toolbar gets an "Export CSV" that saves the filtered list, for a table with no row selection (so no bulk bar to export from).
  const exportFiltered = !exportAll && exportFilteredList && table.mode === "client"
    ? () => downloadCsv(exportFileName, toCsv(table.matchingRows, columns))
    : exportAll;

  const hasSelection = selectable && selection.count > 0;
  useEffect(() => {
    if (!hasSelection) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented && !escapeBelongsElsewhere(e)) selection.clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasSelection, selection]);

  const handleRowClick = (e, row) => {
    const inner = e.target.closest?.(IGNORE);
    if (inner && e.currentTarget.contains(inner)) return;
    const modified = e.shiftKey || e.metaKey || e.ctrlKey;
    if (selectable && (modified || !onRowClick)) selection.click(row, e);
    else onRowClick?.(row, e);
  };

  const colSpan = columns.length + (selectable ? 1 : 0) + (renderExpanded ? 1 : 0);
  const cellPad = dense ? "px-4 py-2" : "px-4 py-3";

  const renderRow = (row) => {
    const id = table.getRowId(row);
    const selected = selection.isSelected(id);
    const canSelect = table.isRowSelectable(row);
    const open = openId === id;
    const expanded = open ? renderExpanded?.(row) : null;
    const highlighted = highlightRowId != null && id === highlightRowId;
    return (
      <Fragment key={id}>
        <tr
          ref={highlighted ? scrollToHighlight : undefined}
          aria-current={highlighted ? "true" : undefined}
          onClick={(e) => handleRowClick(e, row)}
          onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
          className={[
            "border-t border-surface-300/40 transition-colors",
            selected ? "bg-brand-500/5" : "hover:bg-surface-50/60",
            shiftHeld && "select-none",
            (onRowClick || selectable) && "cursor-pointer",
            highlighted && "outline outline-2 -outline-offset-2 outline-brand-500/60",
            rowClassName?.(row),
          ].filter(Boolean).join(" ")}
        >
          {selectable && (
            <td className={`${cellPad} w-10`}>
              <input
                type="checkbox"
                aria-label={rowLabelFor(row, columns)}
                checked={selected}
                disabled={!canSelect}
                onChange={() => {}}
                onClick={(e) => selection.click(row, { shiftKey: e.shiftKey, metaKey: true })}
                className="accent-brand-500"
              />
            </td>
          )}
          {renderExpanded && (
            <td className={`${cellPad} w-8`}>
              {(!canExpand || canExpand(row)) && (
                <button
                  type="button"
                  aria-label={open ? "Collapse row" : "Expand row"}
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : id)}
                  className="rounded-md p-0.5 text-navy/40 hover:bg-surface-200 hover:text-navy"
                >
                  <ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
                </button>
              )}
            </td>
          )}
          {columns.map((col) => (
            <td key={col.id} className={`${cellPad} text-sm text-navy ${ALIGN[col.align ?? "left"]} ${col.className ?? ""}`}>
              {col.cell(row)}
            </td>
          ))}
        </tr>
        {expanded != null && (
          <tr className="border-t border-surface-300/40 bg-surface-50/40">
            <td colSpan={colSpan} className="px-4 py-4">{expanded}</td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div className="space-y-3">
      {hasSelection ? (
        <BulkBar table={table} columns={columns} bulkActions={bulkActions} exportable={exportable} exportFileName={exportFileName} />
      ) : (
        <DataTableToolbar table={table} searchable={searchable} searchPlaceholder={searchPlaceholder} toolbarRight={toolbarRight} exportAll={exportFiltered} />
      )}
      {selectable && selection.allMatchingAvailable && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-500/5 px-4 py-2 text-xs text-navy/70">
          All {table.rows.filter(table.isRowSelectable).length} on this page are selected.
          <button type="button" onClick={selection.selectAllMatching} className="font-medium text-brand-600 hover:underline">
            Select all {selection.matchingCount} matching
          </button>
        </div>
      )}
      {notice}
      <div className="overflow-hidden rounded-2xl border border-surface-300/50 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <TableHead table={table} columns={columns} selectable={selectable} expandable={Boolean(renderExpanded)} />
            <tbody className={table.loading && table.rows.length > 0 ? "opacity-60 transition-opacity" : undefined}>
              <BodyState table={table} colSpan={colSpan} emptyText={emptyText} />
              {groupBy
                ? groupRows(table.rows, groupBy.key).map((group, i) => (
                  <Fragment key={`group:${i}:${group.key}`}>
                    <GroupHeader group={group} header={groupBy.header} colSpan={colSpan} selectable={selectable} selection={selection} isRowSelectable={table.isRowSelectable} getRowId={table.getRowId} />
                    {group.rows.map(renderRow)}
                  </Fragment>
                ))
                : table.rows.map(renderRow)}
            </tbody>
            {footer && <tfoot className="border-t border-surface-300/50">{footer}</tfoot>}
          </table>
        </div>
      </div>
      {paginated && table.total > 0 && <Pagination {...table.pagination} itemLabel={itemLabel} />}
    </div>
  );
}

function GroupHeader({ group, header, colSpan, selectable, selection, isRowSelectable, getRowId }) {
  const boxRef = useRef(null);
  const ids = group.rows.filter(isRowSelectable).map(getRowId);
  const all = ids.length > 0 && ids.every((id) => selection.isSelected(id));
  const some = !all && ids.some((id) => selection.isSelected(id));
  useEffect(() => {
    if (boxRef.current) boxRef.current.indeterminate = some;
  }, [some]);
  return (
    <tr data-group={group.key} className="border-t border-surface-300/60 bg-surface-50">
      <td colSpan={colSpan} className="px-4 py-2 text-xs font-semibold text-navy/70">
        <span className="inline-flex items-center gap-3">
          {selectable && (
            <input
              ref={boxRef}
              type="checkbox"
              aria-label={`Select group ${group.key}`}
              checked={all}
              disabled={ids.length === 0}
              onChange={() => selection.toggleRows(group.rows, !all)}
              className="accent-brand-500"
            />
          )}
          {header ? header(group.key, group.rows) : group.key}
        </span>
      </td>
    </tr>
  );
}

function TableHead({ table, columns, selectable, expandable }) {
  const { selection, sort, setSort } = table;
  const boxRef = useRef(null);
  const some = selection.pageSomeSelected && !selection.pageAllSelected;
  useEffect(() => {
    if (boxRef.current) boxRef.current.indeterminate = some;
  }, [some]);
  const cycle = (id) => {
    if (sort?.id !== id) setSort({ id, dir: "asc" });
    else if (sort.dir === "asc") setSort({ id, dir: "desc" });
    else setSort(null);
  };

  return (
    <thead className="bg-surface-50 text-[10px] font-mono uppercase tracking-widest text-navy/40">
      <tr>
        {selectable && (
          <th className="w-10 px-4 py-3 text-left font-medium">
            <input
              ref={boxRef}
              type="checkbox"
              aria-label="Select page"
              checked={selection.pageAllSelected}
              disabled={table.rows.length === 0}
              onChange={() => selection.togglePage(!selection.pageAllSelected)}
              className="accent-brand-500"
            />
          </th>
        )}
        {expandable && <th className="w-8 px-4 py-3" aria-label="Expand" />}
        {columns.map((col) => {
          const align = ALIGN[col.align ?? "left"];
          const dir = sort?.id === col.id ? sort.dir : null;
          if (!col.sortValue) {
            return <th key={col.id} className={`px-4 py-3 font-medium ${align} ${col.headerClassName ?? ""}`}>{col.header}</th>;
          }
          return (
            <th
              key={col.id}
              aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
              className={`px-4 py-3 font-medium ${align} ${col.headerClassName ?? ""}`}
            >
              <button
                type="button"
                onClick={() => cycle(col.id)}
                className={`inline-flex items-center gap-1 uppercase tracking-widest hover:text-navy ${dir ? "text-navy/70" : ""}`}
              >
                {col.header}
                {dir === "asc" && <ArrowUp size={10} />}
                {dir === "desc" && <ArrowDown size={10} />}
              </button>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

/** Loading, error and empty states, drawn inside the table body. */
function BodyState({ table, colSpan, emptyText }) {
  if (table.rows.length > 0 && !table.error) return null;
  let content;
  if (table.error) {
    content = (
      <div className="flex flex-col items-center gap-2 text-navy/60">
        <AlertCircle size={20} className="text-red-500/50" />
        <span>{errorText(table.error)}</span>
        <button type="button" onClick={table.reload} className="text-xs font-medium text-brand-600 hover:underline">
          Retry
        </button>
      </div>
    );
  } else if (table.loading) {
    content = (
      <span className="inline-flex items-center gap-2 text-navy/40">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </span>
    );
  } else {
    content = <span className="text-navy/40">{emptyText}</span>;
  }
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm">{content}</td>
    </tr>
  );
}

/** True while Shift is down, so rows can turn off text selection during a range click. */
function useShiftHeld() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (e) => { if (e.key === "Shift") setHeld(true); };
    const up = (e) => { if (e.key === "Shift") setHeld(false); };
    const reset = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return held;
}

/** A ref callback that scrolls its element into view the first time it mounts for each `key`. */
function useScrollOnce(key) {
  const done = useRef(null);
  return useCallback((el) => {
    if (!el || key == null || done.current === key) return;
    done.current = key;
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [key]);
}
