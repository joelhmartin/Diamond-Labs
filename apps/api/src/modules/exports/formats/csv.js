import { csvRow, toDecimalString } from "@my-app/shared";

/** One cell by field type: cents as "123.45", dates as YYYY-MM-DD, everything else as-is. */
function cell(value, type) {
  if (value == null) return null;
  if (type === "cents") return toDecimalString(value);
  if (type === "date") return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return value;
}

/** The built-in CSV format: header of field labels, one row per record. Fits every source. */
export const csvFormat = {
  key: "csv",
  label: "CSV",
  extension: "csv",
  contentType: "text/csv; charset=utf-8",
  bom: true, // the BOM makes Excel read the file as UTF-8
  supports: () => true,
  header: (source) => csvRow(source.fields.map((f) => f.label)),
  serializeRow: (row, source) => csvRow(source.fields.map((f) => cell(row[f.key], f.type))),
};
