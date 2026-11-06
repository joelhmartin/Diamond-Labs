/**
 * The built-in CSV format: a header of field labels, then one line per row.
 * Each cell is written by its field's type through the shared `csvValue`
 * (`reports/columns.js`), the same cell a report's on-screen table and its
 * selected-rows export write, and encoded by the shared `csvRow`. Field types
 * are the column types (`COLUMN_TYPES`): `money` is integer cents written as
 * "1234.50", `date` a calendar day (in the field's `timeZone`, default UTC).
 */
import { csvRow } from "./csv.js";
import { csvValue } from "../reports/columns.js";

export const csvFormat = Object.freeze({
  key: "csv",
  label: "CSV",
  extension: "csv",
  contentType: "text/csv; charset=utf-8",
  bom: true, // the BOM makes Excel read the file as UTF-8
  supports: () => true,
  header: (source) => csvRow(source.fields.map((f) => f.label)),
  serializeRow: (row, source) => csvRow(source.fields.map((f) => csvValue(f, row[f.key]))),
});
