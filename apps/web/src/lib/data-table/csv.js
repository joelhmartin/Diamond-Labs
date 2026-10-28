/**
 * CSV export for DataTable rows. A column exports `exportValue(row)` when it
 * has one, else its cell when the cell is a plain string or number (rendered
 * nodes export blank). `export: false` leaves a column out.
 */

export function toCsv(rows, columns) {
  const cols = columns.filter((c) => c.export !== false);
  const header = cols.map((c) => quote(typeof c.header === "string" ? c.header : c.id));
  const lines = rows.map((row) => cols.map((c) => quote(cellValue(c, row))).join(","));
  return [header.join(","), ...lines].join("\r\n");
}

function cellValue(column, row) {
  const v = column.exportValue ? column.exportValue(row) : column.cell(row);
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** RFC 4180: wrap in quotes when the field holds a comma, quote or line break; double inner quotes. */
function quote(s) {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
