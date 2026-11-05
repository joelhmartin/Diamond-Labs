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

function zoned(column, d) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: column.timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
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

/** CSV cell value: money as plain "1234.50", ints as numbers, the rest as displayed. */
export function csvValue(column, value) {
  if (isNil(value)) return "";
  if (column.type === "money") {
    return plainMoney(value);
  }
  if (column.type === "int") return Number(value);
  return formatCell(column, value);
}
