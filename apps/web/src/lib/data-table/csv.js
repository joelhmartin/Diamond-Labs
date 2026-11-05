/**
 * CSV export for DataTable rows. A column exports `exportValue(row)` when it
 * has one, else its cell when the cell is a plain string or number (rendered
 * nodes export blank). `export: false` leaves a column out.
 */
import { csvRow, CSV_EOL } from "@my-app/shared";
import { saveBlob } from "../download.js";

export function toCsv(rows, columns) {
  const cols = columns.filter((c) => c.export !== false);
  const header = csvRow(cols.map((c) => (typeof c.header === "string" ? c.header : c.id)));
  const lines = rows.map((row) => csvRow(cols.map((c) => cellValue(c, row))));
  return [header, ...lines].join(CSV_EOL);
}

function cellValue(column, row) {
  const v = column.exportValue ? column.exportValue(row) : column.cell(row);
  // Rendered nodes (objects) export blank.
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null;
}

export function downloadCsv(filename, csv) {
  // The BOM makes Excel read the file as UTF-8 (accented names).
  saveBlob(filename, new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
}
