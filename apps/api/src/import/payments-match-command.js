import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImportRefusal } from "./import-errors.js";
import { parseColumnsFlag, fold } from "./export-table.js";
import { readPaymentsExport, mergePaymentFiles, derivedExportBytes } from "./payments-export.js";
import { matchPayments, derivedBalances, MATCH_STATUS } from "./payment-match.js";
import { centsOf } from "./map-invoices.js";
import { recordNumber, INVOICE_NUMBER_FIELDS, invoiceStatusFor, firstString } from "./seazona-records.js";
import { normAccount } from "./owners.js";

/**
 * `import:fetch payments-match --file <a.xls> [--file <b.xls> …] [--columns …]
 *   [--unclear open|review] [--review-out <path>] [--live [--accept-export-problems]]`
 *
 * Derives per-invoice open balances from the lab's Payments exports and the
 * invoice summaries already in the import DB (no Seazona call). Dry run by
 * default: prints counts and writes the review CSV. `--live` seals each
 * Payments export (kind payments_export) and the derived balances (kind
 * payments_derived) and prints the file id that `import:load balances
 * --balances per-invoice --file-id <id>` takes. Output is counts, invoice
 * numbers, payment ids (file and row) and cents: never names or notes text.
 */
export const PAYMENTS_MATCH_FLAGS = ["file", "columns", "unclear", "review-out", "live", "accept-export-problems"];
export const PAYMENTS_FILE_KIND = "payments_export";
export const DERIVED_FILE_KIND = "payments_derived";
const USAGE = "Usage: import:fetch payments-match --file <payments.xls> [--file <more.xls> …] [--columns name=Header,…] [--unclear open|review] [--review-out <path>] [--live [--accept-export-problems]]";

/** Raw invoice summaries → the matcher's invoices (issued, numbered, non-negative total), plus why the rest were left out. */
export function invoicesFromRecords(records) {
  const invoices = [];
  const seen = new Set();
  const skipped = { void: 0, noNumber: 0, badTotal: 0, duplicateNumber: 0 };
  for (const { payload } of records) {
    const number = recordNumber(payload, INVOICE_NUMBER_FIELDS);
    const totalCents = centsOf(payload?.total);
    if (!number) { skipped.noNumber += 1; continue; }
    if (invoiceStatusFor(payload.status) === "void") { skipped.void += 1; continue; }
    if (totalCents == null || totalCents < 0) { skipped.badTotal += 1; continue; }
    if (seen.has(number)) { skipped.duplicateNumber += 1; continue; }
    seen.add(number);
    invoices.push({ number, totalCents, clientKey: payload.clientId == null ? null : String(payload.clientId) });
  }
  return { invoices, skipped };
}

/**
 * Raw client records → resolve(clientCellText) → Seazona client id or null.
 * The cell may hold an account number or a practice name; a name shared by
 * two clients resolves to nothing (fail open: the cross-client check is then
 * skipped for that payment, never guessed).
 */
export function clientResolver(clientRecords) {
  const byAccount = new Map();
  const byName = new Map();
  for (const { seazonaId, payload } of clientRecords) {
    const account = normAccount(payload?.accountNumber);
    if (account) byAccount.set(account, String(seazonaId));
    for (const name of new Set([firstString(payload, ["company"]), firstString(payload, ["fullName"])].filter(Boolean).map(fold))) {
      byName.set(name, byName.has(name) && byName.get(name) !== String(seazonaId) ? null : String(seazonaId));
    }
  }
  return (text) => {
    if (!text) return null;
    return byAccount.get(normAccount(text)) ?? byName.get(fold(text)) ?? null;
  };
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** Unclear, partial and overpaid invoices, one row each: numbers, cents, payment ids, dates and amounts. No notes, no names. */
export function reviewCsv(result, derived, paymentsById) {
  const openOf = new Map(derived.rows.map((r) => [r.key, r.cents]));
  const overpaid = new Set(result.overpaid);
  const lines = [["invoice_number", "status", "total_cents", "definite_cents", "open_cents", "payment_ids", "payment_dates", "payment_amounts_cents"].join(",")];
  for (const i of [...result.invoices].sort((a, b) => a.number - b.number)) {
    const status = overpaid.has(i.number) ? "overpaid" : i.status;
    if (status !== MATCH_STATUS.unclear && status !== MATCH_STATUS.partial && status !== "overpaid") continue;
    const ps = i.paymentIds.map((id) => paymentsById.get(id));
    lines.push([i.number, status, i.totalCents, i.definiteCents, openOf.get(String(i.number)), i.paymentIds.join(";"), ps.map((p) => p.date).join(";"), ps.map((p) => p.amountCents).join(";")].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function countLines({ parsedList, merged, unresolvedClients, result, derived, skipped }) {
  const fileProblems = parsedList.reduce((n, p) => n + p.problems.reduce((m, x) => m + x.count, 0), 0);
  const amountOf = new Map(merged.payments.map((p) => [p.id, p.amountCents]));
  const cents = (ids) => ids.reduce((n, id) => n + amountOf.get(id), 0);
  const lines = [
    `Payments read: ${merged.payments.length} from ${parsedList.length} file(s) (${merged.duplicatesDropped} repeated across files dropped; ${fileProblems} problem row(s)).`,
    `  attributed ${result.attributedPayments}, unattributed (no known invoice named) ${result.unattributedPayments.length} (${cents(result.unattributedPayments)} cents), cross-client (not applied) ${result.crossClient.length} (${cents(result.crossClient.map((c) => c.paymentId))} cents), client column not recognised ${unresolvedClients}.`,
    `  multi-invoice payments that do not add up: ${result.unclearPayments.length}; overpaid invoices: ${result.overpaid.length}.`,
    `Invoices matched: ${result.invoices.length} (left out: ${skipped.void} void, ${skipped.noNumber} no number, ${skipped.badTotal} bad or negative total, ${skipped.duplicateNumber} duplicate number).`,
  ];
  const open = new Map(derived.rows.map((r) => [r.key, r.cents]));
  for (const status of Object.values(MATCH_STATUS)) {
    const list = result.invoices.filter((i) => i.status === status);
    const total = list.reduce((n, i) => n + i.totalCents, 0);
    const left = list.reduce((n, i) => n + open.get(String(i.number)), 0);
    lines.push(`  ${status}: ${list.length} invoice(s), ${total} cents billed, ${left} cents left open.`);
  }
  lines.push(`Derived open balance: ${derived.rows.reduce((n, r) => n + r.cents, 0)} cents over ${derived.rows.length} invoice(s); ${derived.review.length} unclear invoice(s) to review.`);
  return lines;
}

function options(flags) {
  const files = flags.file ?? [];
  if (!files.length) throw new ImportRefusal(USAGE);
  const unclear = flags.unclear ?? "open";
  if (unclear !== "open" && unclear !== "review") throw new ImportRefusal("--unclear must be open (default: unclear invoices stay fully open) or review (credit only their definite part).");
  if (flags["accept-export-problems"] && !flags.live) throw new ImportRefusal("--accept-export-problems applies only with --live.");
  return { files, unclear, columns: flags.columns ? parseColumnsFlag(flags.columns) : {} };
}

/** Seal the raw exports and the derived balances (live only), refusing on export problems unless accepted. */
async function seal({ flags, store, deps, rawFiles, parsedList, derived }) {
  const problems = parsedList.flatMap((p, i) => p.problems.map((x) => ({ file: i + 1, ...x })));
  if (problems.length && !flags["accept-export-problems"]) {
    throw new ImportRefusal("The Payments export(s) have problem rows (listed above). An unread payment leaves an invoice MORE open, but an unread refund forgives one: fix the file, or pass --accept-export-problems.");
  }
  for (const bytes of rawFiles) await store.saveFile({ kind: PAYMENTS_FILE_KIND, bytes });
  const id = await store.saveFile({ kind: DERIVED_FILE_KIND, bytes: derivedExportBytes(derived.rows) });
  deps.print([
    `Sealed ${rawFiles.length} Payments export(s) and the derived balances as file ${id}.`,
    `NEXT: import:load balances --balances per-invoice --file-id ${id} --target rehearsal (dry run first).`,
    "Delete the local copies of the Payments exports now (and empty the Trash).",
  ]);
}

export async function runPaymentsMatch(flags, store, deps) {
  const opts = options(flags);
  const rawFiles = [];
  for (const path of opts.files) rawFiles.push(await deps.readFile(path));
  const parsedList = rawFiles.map((bytes, i) => readPaymentsExport(bytes, { columns: opts.columns, file: i + 1 }));
  const merged = mergePaymentFiles(parsedList);
  const { invoices, skipped } = invoicesFromRecords(await store.records("invoice"));
  const resolve = clientResolver(await store.records("client"));
  let unresolvedClients = 0;
  const payments = merged.payments.map((p) => {
    const clientKey = resolve(p.client);
    if (p.client && clientKey == null) unresolvedClients += 1;
    return { id: p.id, date: p.date, amountCents: p.amountCents, clientKey, text: `${p.reference} ${p.notes}` };
  });
  const result = matchPayments({ invoices, payments });
  const derived = derivedBalances(result, { unclear: opts.unclear });
  const reviewPath = flags["review-out"] ?? join(tmpdir(), `payments-match-review-${deps.now().toISOString().replace(/[:.]/g, "-")}.csv`);
  await deps.writeFile(reviewPath, reviewCsv(result, derived, new Map(payments.map((p) => [p.id, p]))), { mode: 0o600 });
  deps.print(countLines({ parsedList, merged, unresolvedClients, result, derived, skipped }));
  deps.print([`Review CSV (unclear, partial and overpaid invoices; numbers and cents only): ${reviewPath}`]);
  parsedList.forEach((p, i) => {
    if (p.problems.length) deps.print([`File ${i + 1} problems (row numbers only):`, ...p.problems.map((x) => `  ${x.kind} x${x.count}: rows ${x.lines.slice(0, 20).join(", ")}`)]);
  });
  if (!flags.live) {
    deps.print(["Dry run: nothing was stored. Re-run with --live to seal the derived balances."]);
    return 0;
  }
  await seal({ flags, store, deps, rawFiles, parsedList, derived });
  return 0;
}
