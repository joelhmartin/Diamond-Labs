import { toDecimalString } from "../money.js";

/** Column specs and the one cell formatter shared by the screen and CSV export. */
export const COLUMN_TYPES = Object.freeze([
  "text", "int", "money", "date", "datetime", "pct", "duration_days", "link", "badge",
]);

const isNil = (v) => v === null || v === undefined || v === "";

/** Integer cents -> plain "-1234.50" (the shared money helper); "" when not a number. */
function plainMoney(value) {
  const n = Math.round(Number(value));
  return Number.isSafeInteger(n) ? toDecimalString(n) : "";
}

const isoDay = (parts) => `${parts.year}-${parts.month}-${parts.day}`;
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

// One formatter per zone (the options never vary): building an Intl.DateTimeFormat
// costs far more than using one, and a CSV export formats up to 100k cells.
const ZONED_FORMATS = new Map();

function zonedFormat(timeZone) {
  let format = ZONED_FORMATS.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    ZONED_FORMATS.set(timeZone, format);
  }
  return format;
}

function zoned(column, d) {
  return Object.fromEntries(zonedFormat(column.timeZone || "UTC").formatToParts(d).map((x) => [x.type, x.value]));
}

/** Calendar day. A plain "YYYY-MM-DD" passes through; a Date or timestamp is read in column.timeZone (default UTC). */
function dateOnly(column, value) {
  if (typeof value === "string" && PLAIN_DATE.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : isoDay(zoned(column, d));
}

function datetime(column, value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = zoned(column, d);
  return `${isoDay(p)} ${p.hour}:${p.minute}`;
}

const labelOf = (v) => (v && typeof v === "object" ? String(v.label ?? "") : String(v));

/** Display string for a cell. Null/undefined/"" -> "". */
export function formatCell(column, value) {
  if (isNil(value)) return "";
  switch (column.type) {
    case "money": {
      const plain = plainMoney(value);
      if (!plain) return "";
      const neg = plain.startsWith("-");
      const [whole, frac] = plain.replace("-", "").split(".");
      return `${neg ? "-" : ""}$${Number(whole).toLocaleString("en-US")}.${frac}`;
    }
    case "pct": return `${(Number(value) * 100).toFixed(1)}%`;
    case "int": return Number(value).toLocaleString("en-US");
    case "duration_days": {
      const n = Number(value);
      return `${Number.isInteger(n) ? n : n.toFixed(1)} d`;
    }
    case "date": return dateOnly(column, value);
    case "datetime": return datetime(column, value);
    case "link":
    case "badge": return labelOf(value);
    default: return String(value);
  }
}

/** A finite number with one decimal ("-5.0"), or as-is when `keepInteger` and whole ("3"); "" when not a number. */
const oneDecimal = (n, keepInteger) => (!Number.isFinite(n) ? "" : keepInteger && Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * CSV cell value. Numeric types are written as plain numbers a spreadsheet can
 * sum, so the shared encoder never prefixes them (negatives included):
 *   money          dollars, "1234.50"
 *   int            7
 *   pct            the percent figure, one decimal, no "%": 0.074 -> "7.4", -0.05 -> "-5.0"
 *   duration_days  the number of days, no " d": 3 -> "3", 3.25 -> "3.3"
 * Everything else is written as displayed. Column headers are unchanged.
 */
export function csvValue(column, value) {
  if (isNil(value)) return "";
  switch (column.type) {
    case "money": return plainMoney(value);
    case "int": return Number(value);
    case "pct": return oneDecimal(Number(value) * 100, false);
    case "duration_days": return oneDecimal(Number(value), true);
    default: return formatCell(column, value);
  }
}
