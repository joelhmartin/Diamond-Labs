import {
  exportText, htmlTableRowsDetailed, exportCents, findHeader, isFooterLabel, groupProblems, fold, EXPORT_PROBLEM_KINDS, DERIVED_BALANCE_KIND,
} from "./export-table.js";
import { ImportRefusal } from "./import-errors.js";

/**
 * The lab portal's Payments export (Billing → Payments → Export), read with
 * export-table.js's parser. Only the date, amount, reference, notes, client
 * and status columns are read; every other cell is ignored. Reference and
 * notes text stays in memory for payment-match.js and is never printed.
 *
 * The default column names are a guess until a real export is seen;
 * `--columns name="Header"` overrides any of them, as on the other export
 * commands. Date and amount are required, and at least one of reference and
 * notes; client and status are optional (no client: every payment is
 * client-unknown, so nothing is credited definitely).
 */
export const PAYMENT_COLUMNS = {
  date: ["date", "payment date", "date paid", "paid date", "received", "date received"],
  amount: ["amount", "payment", "payment amount", "amount paid", "paid amount"],
  reference: ["reference", "reference #", "reference no", "reference number", "ref", "ref #"],
  notes: ["notes", "note", "memo", "comments", "comment"],
  client: ["client", "account #", "account", "account no", "account number", "acct #", "acct"],
  status: ["status", "payment status", "transaction status"],
};
const REQUIRED = ["date", "amount"];

/**
 * Status (or a mapped type) cell → what the row means, folded. Any other value
 * is refused: add it here only with the user's ruling on what it means.
 * apply: a payment that stands (payment methods count, for a mapped "type");
 * reverse: a payment taken back (void, returned, nsf…); refund: money back. Both SUBTRACT
 * (amount −|printed|), so a payment row plus its reversal row nets to zero.
 */
export const STATUS_VALUES = {
  apply: ["", "payment", "posted", "applied", "received", "paid", "completed", "complete", "active", "cleared", "deposited",
    "check", "cheque", "cash", "credit card", "card", "visa", "mastercard", "amex", "american express", "discover", "ach", "eft", "wire"],
  reverse: ["void", "voided", "reversed", "reversal", "cancelled", "canceled", "bounced", "nsf", "returned", "declined", "failed"],
  refund: ["refund", "refunded"],
};
const STATUS_EFFECT = new Map(Object.entries(STATUS_VALUES).flatMap(([effect, values]) => values.map((v) => [v, effect])));
const LOOKS_LIKE_STATUS = /status|type|void|revers/;

export const PAYMENT_PROBLEM_KINDS = {
  badAmount: "payment-row-bad-amount",
  noDate: "payment-row-no-date",
  totalMismatch: EXPORT_PROBLEM_KINDS.totalMismatch,
};

const quoted = (cells) => cells.slice(0, 30).map((c) => `"${String(c).slice(0, 40)}"`).join(", ");

/** Header names for an error: the first <th> row only (never a data row), else just a column count. */
function headerHint(table) {
  const th = table.find((r) => r.th);
  return th ? `Headers found: ${quoted(th.cells)}.` : `No <th> header row; the first row has ${(table[0]?.cells ?? []).length} column(s).`;
}

function headerOf(table, rows, columns) {
  const unknown = Object.keys(columns).filter((n) => !PAYMENT_COLUMNS[n]);
  if (unknown.length) throw new ImportRefusal(`Unknown --columns name "${unknown[0]}" for the Payments export (names: ${Object.keys(PAYMENT_COLUMNS).join(", ")}).`);
  const names = { ...PAYMENT_COLUMNS, ...columns };
  const required = Object.fromEntries(REQUIRED.map((n) => [n, names[n]]));
  const optional = Object.fromEntries(Object.keys(names).filter((n) => !REQUIRED.includes(n)).map((n) => [n, names[n]]));
  const header = findHeader(rows, required, optional);
  const hint = `Pass --columns ${Object.keys(PAYMENT_COLUMNS).map((n) => `${n}="Header"`).join(",")} (client and status optional; reference or notes, at least one).`;
  if (!header) throw new ImportRefusal(`The Payments export has no header row with the date and amount columns in its first 15 rows. ${headerHint(table)} ${hint}`);
  if (header.at.reference == null && header.at.notes == null) {
    throw new ImportRefusal(`The Payments export has no reference or notes column. Headers found: ${quoted(rows[header.index])}. ${hint}`);
  }
  return header;
}

/** Status cells → effect per row; every value not on the allow-list is refused together. */
function statusEffects(rows, from, at) {
  if (at.status == null) return () => "apply";
  const unknown = new Set();
  for (let i = from; i < rows.length; i++) {
    const v = fold(rows[i][at.status] ?? "");
    if (!STATUS_EFFECT.has(v) && !isFooterLabel(rows[i], at.date)) unknown.add(v.slice(0, 40));
  }
  if (unknown.size) {
    throw new ImportRefusal(`Unknown status value(s) in the Payments export: ${quoted([...unknown].slice(0, 10))}. Known: apply ${STATUS_VALUES.apply.filter(Boolean).join(", ")}; reverse ${STATUS_VALUES.reverse.join(", ")}; refund ${STATUS_VALUES.refund.join(", ")}. Get the user's ruling and add the value to payments-export.js STATUS_VALUES, or map another column.`);
  }
  return (row) => STATUS_EFFECT.get(fold(row[at.status] ?? ""));
}

/**
 * One Payments export → { payments: [{ id, file, line, date, amountCents,
 * reference, notes, client }], problems, headerLine, exportTotalCents,
 * reversedLines, unmappedStatusHeaders }. `id` is "f<file>:L<line>" (the
 * file's position on the command line and its 1-based row). The footer Total
 * is checked against the amounts as printed (reversed rows included).
 */
export function readPaymentsExport(bytes, { columns = {}, file = 1 } = {}) {
  const table = htmlTableRowsDetailed(exportText(bytes));
  const rows = table.map((r) => r.cells);
  const { index, at } = headerOf(table, rows, columns);
  const mapped = new Set(Object.values(at));
  const unmappedStatusHeaders = rows[index].filter((h, idx) => !mapped.has(idx) && LOOKS_LIKE_STATUS.test(fold(h)));
  const effectOf = statusEffects(rows, index + 1, at);
  const cell = (row, name) => (at[name] == null ? null : row[at[name]] ?? "");
  let lastFilled = -1;
  for (let i = rows.length - 1; i > index && lastFilled < 0; i--) if (rows[i].some(Boolean)) lastFilled = i;
  const payments = [];
  const reversedLines = [];
  const found = [];
  let printedSum = 0;
  let exportTotalCents = null;
  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    if (row.every((c) => !c)) continue;
    if (i === lastFilled && isFooterLabel(row, at.date)) {
      exportTotalCents = exportCents(cell(row, "amount"));
      if (exportTotalCents == null || exportTotalCents !== printedSum) found.push({ kind: PAYMENT_PROBLEM_KINDS.totalMismatch, line });
      continue;
    }
    const amountCents = exportCents(cell(row, "amount"));
    if (amountCents == null) { found.push({ kind: PAYMENT_PROBLEM_KINDS.badAmount, line }); continue; }
    printedSum += amountCents;
    const date = cell(row, "date");
    if (!date) { found.push({ kind: PAYMENT_PROBLEM_KINDS.noDate, line }); continue; }
    // A reversal (void, returned, nsf, …) and a refund both take money back: they SUBTRACT, however the export
    // prints the sign, through the same attribution as a refund (one naming no invoice is an unattributed refund).
    const effect = effectOf(row);
    if (effect === "reverse") reversedLines.push(line);
    payments.push({
      id: `f${file}:L${line}`, file, line, date, amountCents: effect === "apply" ? amountCents : -Math.abs(amountCents),
      reference: cell(row, "reference") ?? "", notes: cell(row, "notes") ?? "", client: cell(row, "client"),
    });
  }
  return { payments, problems: groupProblems(found), headerLine: index + 1, exportTotalCents, reversedLines, unmappedStatusHeaders };
}

const dedupeKey = (p) => JSON.stringify([p.date, p.amountCents, p.reference, p.client]);

/**
 * Several parsed exports (monthly, possibly overlapping) → one payment list.
 * A payment is the same across files by (date, amount, reference, client).
 * Each key is kept as many times as the file holding it most often has it, so
 * two genuinely identical payments inside one file both stay.
 */
export function mergePaymentFiles(parsedList) {
  const keep = new Map();
  for (const parsed of parsedList) {
    const counts = new Map();
    for (const p of parsed.payments) counts.set(dedupeKey(p), (counts.get(dedupeKey(p)) ?? 0) + 1);
    for (const [k, n] of counts) keep.set(k, Math.max(keep.get(k) ?? 0, n));
  }
  const payments = [];
  let duplicatesDropped = 0;
  for (const p of parsedList.flatMap((x) => x.payments)) {
    const k = dedupeKey(p);
    if ((keep.get(k) ?? 0) > 0) { payments.push(p); keep.set(k, keep.get(k) - 1); } else duplicatesDropped += 1;
  }
  return { payments, duplicatesDropped };
}

/** Integer cents → "1234.56" / "-0.05": the plain form exportCents reads back exactly. */
export function centsText(cents) {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const PROVENANCE = /<!-- payments-derived (\{[^\n]*?\}) -->/;

/**
 * Derived per-invoice open balances ({ key, cents }) → the bytes sealed as a
 * `payments_derived` import file: an HTML table in the per-invoice export's
 * own shape ("Invoice #", "Open Balance", footer "Total"), so readExport
 * reads it unchanged, footer cross-check included. `provenance` (counts,
 * mode and timestamp only) rides in a leading HTML comment, which the table
 * parser drops; derivedProvenance reads it back.
 */
export function derivedExportBytes(rows, provenance = {}) {
  const tr = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  const total = rows.reduce((n, r) => n + r.cents, 0);
  const body = rows.map((r) => tr(r.key, centsText(r.cents))).join("\n");
  const note = `<!-- payments-derived ${JSON.stringify(provenance).replace(/--/g, "- -")} -->`;
  return Buffer.from(`${note}\n<table>\n<tr><th>Invoice #</th><th>Open Balance</th></tr>\n${body}\n${tr("Total", centsText(total))}\n</table>\n`, "utf8");
}

/** A stored import file → its derived-file provenance ({} when it has none), or null when it is not a derived file. */
export function derivedFileInfo(stored) {
  if (stored?.kind !== DERIVED_BALANCE_KIND) return null;
  return derivedProvenance(stored.bytes) ?? {};
}

/** One printable line saying the balances are derived, and from what (counts and a timestamp only). */
export function derivedLine(p) {
  if (p.method === "account-balance") return `These balances are DERIVED from the Account Balance report and ${(p.sourceFiles ?? 1) - 1} Payments export(s) at ${p.derivedAt ?? "an unknown time"} (statements through ${p.statementThrough ?? "?"}; payments through ${p.paymentsThrough ?? "the report"}; ${p.derivedRows ?? "?"} invoice row(s) from ${p.invoiceRecords ?? "?"} invoice record(s); highest invoice ${p.maxInvoiceNumber ?? "?"}). An issued invoice the file does not list stays OPEN; re-derive after fetching newer invoices.`;
  return `These balances are DERIVED from ${p.sourceFiles ?? "?"} Payments export(s) at ${p.derivedAt ?? "an unknown time"} (--unclear ${p.unclear ?? "?"}; ${p.derivedRows ?? "?"} invoice row(s) from ${p.invoiceRecords ?? "?"} invoice record(s); highest invoice ${p.maxInvoiceNumber ?? "?"}). An issued invoice the file does not list stays OPEN; re-derive after fetching newer invoices.`;
}

/** The provenance a derived file carries, or null (not a derived file, or written before provenance existed). */
export function derivedProvenance(bytes) {
  const m = PROVENANCE.exec(exportText(bytes));
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}
