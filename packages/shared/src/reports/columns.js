/** Column specs and the one cell formatter shared by the screen and CSV export. */
export const COLUMN_TYPES = Object.freeze([
  "text", "int", "money", "date", "datetime", "pct", "duration_days", "link", "badge",
]);

const isNil = (v) => v === null || v === undefined || v === "";

/** Integer cents split into sign, whole units and two-digit fraction. */
function centsParts(cents) {
  const n = Math.round(Number(cents));
  const abs = Math.abs(n);
  return { sign: n < 0 ? "-" : "", whole: Math.floor(abs / 100), frac: String(abs % 100).padStart(2, "0") };
}

function datetime(column, value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: column.timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const labelOf = (v) => (v && typeof v === "object" ? String(v.label ?? "") : String(v));

/** Display string for a cell. Null/undefined/"" -> "". */
export function formatCell(column, value) {
  if (isNil(value)) return "";
  switch (column.type) {
    case "money": {
      const { sign, whole, frac } = centsParts(value);
      return `${sign}$${whole.toLocaleString("en-US")}.${frac}`;
    }
    case "pct": return `${(Number(value) * 100).toFixed(1)}%`;
    case "int": return Number(value).toLocaleString("en-US");
    case "duration_days": {
      const n = Number(value);
      return `${Number.isInteger(n) ? n : n.toFixed(1)} d`;
    }
    case "date": return String(value).slice(0, 10);
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
    const { sign, whole, frac } = centsParts(value);
    return `${sign}${whole}.${frac}`;
  }
  if (column.type === "int") return Number(value);
  return formatCell(column, value);
}
