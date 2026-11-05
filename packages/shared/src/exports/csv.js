/**
 * The one CSV field encoder, shared by the browser table export and the
 * server exporter so formula neutralizing cannot drift between them.
 */

export const CSV_EOL = "\r\n";

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[-+]?\d[\d,]*(\.\d+)?$/;

/**
 * Spreadsheet formula injection: Excel/Sheets run a cell that starts with
 * = + - @ (or a tab/CR before one). Prefix those with ' so they open as text.
 * Plain numbers ("-12.50") cannot be formulas and stay as they are.
 */
function neutralize(s) {
  return FORMULA_START.test(s) && !PLAIN_NUMBER.test(s) ? `'${s}` : s;
}

/** RFC 4180: wrap in quotes when the field holds a comma, quote or line break; double inner quotes. */
function quote(s) {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One encoded CSV field. null/undefined are empty; numbers and booleans are written as-is. */
export function csvField(value) {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return quote(neutralize(String(value)));
}

/** One encoded CSV line (no line ending). */
export function csvRow(values) {
  return values.map(csvField).join(",");
}
