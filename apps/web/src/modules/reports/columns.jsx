/**
 * Report column specs (data from the API) -> DataTable columns. Cells and CSV
 * both go through the shared formatCell / csvValue, so the screen, the
 * selected-rows CSV and the server CSV agree.
 */
import { Link } from "react-router-dom";
import { formatCell, csvValue } from "@my-app/shared";

const RIGHT = new Set(["money", "int", "pct", "duration_days"]);
const TEXT = new Set(["text", "link", "badge"]);

/** "/x/{id}" filled from the row (URL-encoded). Null when any field is missing, so no broken link. */
export function fillTemplate(template, row) {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, field) => {
    const v = row?.[field];
    if (v === undefined || v === null || v === "") missing = true;
    return encodeURIComponent(String(v ?? ""));
  });
  return missing ? null : out;
}

/** The raw value a column sorts on: link/badge objects by label, everything else as-is. */
function sortKey(value) {
  if (value && typeof value === "object" && !(value instanceof Date)) return value.label ?? "";
  return value;
}

/** useDataTable sort -> the server's `sort` query ("id" ascending, "-id" descending). */
export function sortParam(sort) {
  if (!sort?.id) return undefined;
  return sort.dir === "desc" ? `-${sort.id}` : sort.id;
}

export function toTableColumns(specs = []) {
  return specs.map((spec) => {
    const text = (row) => formatCell(spec, row?.[spec.id]);
    return {
      id: spec.id,
      header: spec.label ?? spec.id,
      align: spec.align ?? (RIGHT.has(spec.type) ? "right" : "left"),
      className: RIGHT.has(spec.type) ? "tabular-nums" : undefined,
      cell: (row) => {
        const shown = text(row);
        const to = spec.link && shown !== "" ? fillTemplate(spec.link, row) : null;
        return to ? <Link to={to} className="text-brand-600 hover:underline">{shown}</Link> : shown;
      },
      exportValue: (row) => csvValue(spec, row?.[spec.id]),
      sortValue: spec.sortable === false ? undefined : (row) => sortKey(row?.[spec.id]),
      searchText: TEXT.has(spec.type) ? text : undefined,
    };
  });
}

/** Client-side search across the text-like columns. */
export function searchRows(columns) {
  const searchable = columns.filter((c) => c.searchText);
  return (row, q) => {
    const needle = q.toLowerCase();
    return searchable.some((c) => c.searchText(row).toLowerCase().includes(needle));
  };
}
