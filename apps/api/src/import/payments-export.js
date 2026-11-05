import { exportText, htmlTableRows, exportCents, findHeader, isFooterLabel, groupProblems, EXPORT_PROBLEM_KINDS } from "./export-table.js";
import { ImportRefusal } from "./import-errors.js";

/**
 * The lab portal's Payments export (Billing → Payments → Export), read with
 * export-table.js's parser. Only the date, amount, reference, notes and
 * client columns are read; every other cell is ignored. Reference and notes
 * text stays in memory for payment-match.js and is never printed or logged.
 *
 * The default column names are a guess until a real export is seen;
 * `--columns name="Header"` overrides any of them, as on the other export
 * commands. Date and amount are required, and at least one of reference and
 * notes; client is optional (no client: the cross-client check is skipped).
 */
export const PAYMENT_COLUMNS = {
  date: ["date", "payment date", "date paid", "paid date", "received", "date received"],
  amount: ["amount", "payment", "payment amount", "amount paid", "paid amount"],
  reference: ["reference", "reference #", "reference no", "reference number", "ref", "ref #"],
  notes: ["notes", "note", "memo", "comments", "comment"],
  client: ["client", "account #", "account", "account no", "account number", "acct #", "acct"],
};
const REQUIRED = ["date", "amount"];

export const PAYMENT_PROBLEM_KINDS = {
  badAmount: "payment-row-bad-amount",
  noDate: "payment-row-no-date",
  totalMismatch: EXPORT_PROBLEM_KINDS.totalMismatch,
};

const quoted = (cells) => cells.slice(0, 30).map((c) => `"${String(c).slice(0, 40)}"`).join(", ");

function headerOf(rows, columns) {
  const unknown = Object.keys(columns).filter((n) => !PAYMENT_COLUMNS[n]);
  if (unknown.length) throw new ImportRefusal(`Unknown --columns name "${unknown[0]}" for the Payments export (names: ${Object.keys(PAYMENT_COLUMNS).join(", ")}).`);
  const names = { ...PAYMENT_COLUMNS, ...columns };
  const required = Object.fromEntries(REQUIRED.map((n) => [n, names[n]]));
  const optional = Object.fromEntries(Object.keys(names).filter((n) => !REQUIRED.includes(n)).map((n) => [n, names[n]]));
  const header = findHeader(rows, required, optional);
  const hint = `Pass --columns ${Object.keys(PAYMENT_COLUMNS).map((n) => `${n}="Header"`).join(",")} (client optional; reference or notes, at least one).`;
  if (!header) {
    throw new ImportRefusal(`The Payments export has no header row with the date and amount columns in its first 15 rows. Headers found (first row): ${quoted(rows[0] ?? [])}. ${hint}`);
  }
  if (header.at.reference == null && header.at.notes == null) {
    throw new ImportRefusal(`The Payments export has no reference or notes column. Headers found: ${quoted(rows[header.index])}. ${hint}`);
  }
  return header;
}

/**
 * One Payments export → { payments: [{ id, file, line, date, amountCents,
 * reference, notes, client }], problems, headerLine, exportTotalCents }.
 * `id` is "f<file>:L<line>" (the file's position on the command line and its
 * 1-based row), which the review CSV prints so the operator can find the row.
 */
export function readPaymentsExport(bytes, { columns = {}, file = 1 } = {}) {
  const rows = htmlTableRows(exportText(bytes));
  const { index, at } = headerOf(rows, columns);
  const cell = (row, name) => (at[name] == null ? null : row[at[name]] ?? "");
  let lastFilled = -1;
  for (let i = rows.length - 1; i > index && lastFilled < 0; i--) if (rows[i].some(Boolean)) lastFilled = i;
  const payments = [];
  const found = [];
  let exportTotalCents = null;
  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    if (row.every((c) => !c)) continue;
    if (i === lastFilled && isFooterLabel(row, at.date)) {
      exportTotalCents = exportCents(cell(row, "amount"));
      if (exportTotalCents == null || exportTotalCents !== payments.reduce((n, p) => n + p.amountCents, 0)) found.push({ kind: PAYMENT_PROBLEM_KINDS.totalMismatch, line });
      continue;
    }
    const amountCents = exportCents(cell(row, "amount"));
    if (amountCents == null) { found.push({ kind: PAYMENT_PROBLEM_KINDS.badAmount, line }); continue; }
    const date = cell(row, "date");
    if (!date) { found.push({ kind: PAYMENT_PROBLEM_KINDS.noDate, line }); continue; }
    payments.push({
      id: `f${file}:L${line}`, file, line, date, amountCents,
      reference: cell(row, "reference") ?? "", notes: cell(row, "notes") ?? "", client: cell(row, "client"),
    });
  }
  return { payments, problems: groupProblems(found), headerLine: index + 1, exportTotalCents };
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

/**
 * Derived per-invoice open balances ({ key, cents }) → the bytes sealed as a
 * `payments_derived` import file: an HTML table in the per-invoice export's
 * own shape ("Invoice #", "Open Balance", footer "Total"), so the balances
 * step, --open-balance and parity read it with readExport unchanged and the
 * footer cross-check guards it like any export. Deterministic for equal input.
 */
export function derivedExportBytes(rows) {
  const tr = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  const total = rows.reduce((n, r) => n + r.cents, 0);
  const body = rows.map((r) => tr(r.key, centsText(r.cents))).join("\n");
  return Buffer.from(`<table>\n<tr><th>Invoice #</th><th>Open Balance</th></tr>\n${body}\n${tr("Total", centsText(total))}\n</table>\n`, "utf8");
}
