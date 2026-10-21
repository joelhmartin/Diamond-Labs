import { parseMoneyInput } from "@my-app/shared";
import { ImportRefusal } from "./import-errors.js";

/**
 * The Seazona portal's "Export to Excel" is an HTML <table> saved as .xls.
 * This reads it in memory (the file itself is sealed into the import DB by
 * the caller and never logged): find the header row by column name, then turn
 * each data row into { key, cents } or a problem. Column names are matched
 * exactly (case and punctuation folded); `--columns` overrides them when the
 * lab's export differs.
 *
 * Only the mapped key and balance columns are ever read. Every other column
 * (names, totals, anything that could identify a patient) is ignored and never
 * reaches the output. Rows with no cells are skipped before they are numbered;
 * every other <tr> counts as a line, whether or not it is a data row.
 *
 * Problems use the shared import shape { kind, count, seazonaIds }, plus the
 * 1-based `lines` they came from. Row numbers and keys only, never cell text.
 *
 * Footer (ruling F4): the portal always ends the table with a keyless
 * "Total" / "Totals" / "Grand Total" row. When that is the LAST non-empty row
 * it is read as `exportTotalCents` (not a no-key problem) and cross-checked:
 * the parsed rows must sum to it to the cent, else `export-total-mismatch`.
 * A keyless row anywhere else is still `export-row-no-key`.
 */
export const EXPORT_KINDS = {
  invoice: {
    key: "invoice",
    columns: {
      invoice: ["invoice #", "invoice", "invoice no", "invoice number", "inv #", "inv no"],
      balance: ["open balance", "balance due", "balance", "amount due", "outstanding"],
    },
  },
  client: {
    key: "account",
    columns: {
      account: ["account #", "account", "account no", "account number", "acct #", "acct"],
      balance: ["amount due", "balance due", "current balance", "balance", "total due"],
    },
  },
};

export const EXPORT_PROBLEM_KINDS = {
  noKey: "export-row-no-key",
  badBalance: "export-row-bad-balance",
  duplicate: "export-row-duplicate-key",
  totalMismatch: "export-total-mismatch",
};

const FOOTER_LABELS = new Set(["total", "totals", "grand total"]);
/** A footer row: its key cell (or, when that is blank, its first non-empty cell) is a total label. */
const isFooterLabel = (row, keyAt) => FOOTER_LABELS.has(fold(row[keyAt] || row.find(Boolean) || ""));

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const cellText = (html) =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")).replace(/[\s ]+/g, " ").trim();

/** Bytes → text: UTF-16 LE/BE when a BOM says so, else UTF-8 (BOM dropped). */
export function exportText(bytes) {
  const b = Buffer.from(bytes);
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString("utf16le");
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString("utf16le");
  const t = b.toString("utf8");
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

/**
 * Cell texts of every <tr> that has cells, <th> and <td> alike. Closing tags
 * are optional. Assumes a flat table: no nested tables and no '>' inside
 * attribute values.
 */
export function htmlTableRows(html) {
  const text = String(html).replace(/<!--[\s\S]*?-->/g, "");
  const rows = [];
  for (const tr of text.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)].map((m) => cellText(m[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/**
 * A money cell → integer cents; null when blank, not an amount, or too large
 * to be a safe integer. Commas must be valid thousands grouping; a bare
 * accounting dash ("-", "$ -") is zero.
 */
export function exportCents(text) {
  let s = String(text ?? "").replace(/[$\s]/g, "");
  if (!s) return null;
  if (s === "-") return 0;
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1];
  }
  if (s.includes(",") && !/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(s)) return null;
  const cents = parseMoneyInput(s.replace(/,/g, ""), { allowNegative: !negative });
  if (cents == null || !Number.isSafeInteger(cents)) return null;
  return (negative ? -cents : cents) + 0; // + 0 turns -0 into 0
}

/** `name=Header,name2=Header 2` → { name: ["Header"], name2: ["Header 2"] }. */
export function parseColumnsFlag(value) {
  const out = {};
  for (const part of String(value ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^([a-z]+)=(.+)$/.exec(part);
    if (!m) throw new ImportRefusal(`--columns takes name="Header" pairs separated by commas (got a part without "=").`);
    out[m[1]] = [m[2].trim()];
  }
  return out;
}

const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

function findHeader(rows, aliases) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(fold);
    const at = {};
    for (const [name, names] of Object.entries(aliases)) {
      const wanted = names.map(fold);
      const hits = cells.flatMap((c, idx) => (wanted.includes(c) ? [idx] : []));
      if (hits.length === 0) break;
      if (hits.length > 1) {
        const found = hits.map((idx) => `"${rows[i][idx]}"`).join(", ");
        throw new ImportRefusal(`More than one column could be the ${name} column (${found}). Pass --columns ${name}="Header" to choose one.`);
      }
      at[name] = hits[0];
    }
    if (Object.keys(at).length === Object.keys(aliases).length) return { index: i, at };
  }
  return null;
}

const invoiceKey = (t) => {
  const s = String(t ?? "").replace(/^#/, "").trim();
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
};
const accountKey = (t) => {
  const s = String(t ?? "").trim();
  return /^[A-Za-z0-9-]{1,32}$/.test(s) && /\d/.test(s) ? s : null; // a digit is required so a "Total" row is not an account
};

/** Group per-row problems by kind into the shared { kind, count, seazonaIds, lines } shape. */
function groupProblems(found) {
  const byKind = new Map();
  for (const { kind, line, id } of found) {
    if (!byKind.has(kind)) byKind.set(kind, { kind, count: 0, seazonaIds: [], lines: [] });
    const p = byKind.get(kind);
    p.count += 1;
    p.lines.push(line);
    if (id != null) p.seazonaIds.push(String(id));
  }
  return [...byKind.values()];
}

export function readExport(bytes, { kind, columns = {} }) {
  const spec = EXPORT_KINDS[kind];
  if (!spec) throw new ImportRefusal(`Unknown export kind "${kind}" (invoice or client).`);
  const aliases = { ...spec.columns, ...columns };
  const rows = htmlTableRows(exportText(bytes));
  const header = findHeader(rows, aliases);
  if (!header) {
    throw new ImportRefusal(`No header row with the ${Object.keys(aliases).join(" and ")} columns in the first 15 rows. Open the export, read its column names, and pass --columns ${Object.keys(aliases).map((n) => `${n}="Header"`).join(",")}.`);
  }
  const out = [];
  const found = [];
  const seen = new Set();
  let lastFilled = -1;
  for (let i = rows.length - 1; i > header.index && lastFilled < 0; i--) if (rows[i].some(Boolean)) lastFilled = i;
  let exportTotalCents = null;
  for (let i = header.index + 1; i < rows.length; i++) {
    const line = i + 1;
    const keyText = rows[i][header.at[spec.key]] ?? "";
    const balanceText = rows[i][header.at.balance] ?? "";
    if (rows[i].every((c) => !c)) continue; // spacer row: every cell empty
    const key = kind === "invoice" ? invoiceKey(keyText) : accountKey(keyText);
    if (key == null && i === lastFilled && isFooterLabel(rows[i], header.at[spec.key])) {
      exportTotalCents = exportCents(balanceText);
      const sum = out.reduce((n, r) => n + r.cents, 0);
      if (exportTotalCents == null || exportTotalCents !== sum) found.push({ kind: EXPORT_PROBLEM_KINDS.totalMismatch, line });
      continue;
    }
    if (key == null) {
      found.push({ kind: EXPORT_PROBLEM_KINDS.noKey, line }); // a total or note row?
      continue;
    }
    const cents = exportCents(balanceText);
    if (cents == null) {
      found.push({ kind: EXPORT_PROBLEM_KINDS.badBalance, line, id: key });
      continue;
    }
    if (seen.has(key)) {
      found.push({ kind: EXPORT_PROBLEM_KINDS.duplicate, line, id: key });
      continue;
    }
    seen.add(key);
    out.push({ key, cents, line });
  }
  return { rows: out, problems: groupProblems(found), headerLine: header.index + 1, exportTotalCents };
}
