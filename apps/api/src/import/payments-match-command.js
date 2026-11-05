import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImportRefusal } from "./import-errors.js";
import { parseColumnsFlag, fold, DERIVED_BALANCE_KIND } from "./export-table.js";
import { readPaymentsExport, mergePaymentFiles, derivedExportBytes } from "./payments-export.js";
import { matchPayments, derivedBalances, MATCH_STATUS, UNCLEAR_MODES } from "./payment-match.js";
import { centsOf } from "./map-invoices.js";
import { recordNumber, INVOICE_NUMBER_FIELDS, invoiceStatusFor, firstString, bySeazonaId } from "./seazona-records.js";
import { normAccount } from "./owners.js";

/**
 * `import:fetch payments-match --file <a.xls> [--file <b.xls> …] [--columns …]
 *   [--unclear credit-definite|open] [--review-out <path>] [--live [--accept-…]]`
 *
 * Derives per-invoice open balances from the lab's Payments exports and the
 * invoice summaries already in the import DB (no Seazona call). Dry run by
 * default: prints counts and writes the review CSV. `--live` seals each
 * Payments export (kind payments_export) and the derived balances (kind
 * payments_derived, with provenance) and prints the file id that
 * `import:load balances --balances per-invoice --file-id <id>` takes. Output
 * is counts, invoice numbers, payment ids (file and row), cents and header
 * names: never client names or notes text.
 */
const LIVE_WAIVERS = {
  "accept-export-problems": "the export(s) have problem rows (listed above): an unread payment leaves an invoice MORE open, but an unread refund forgives one",
  "accept-unresolved-clients": "fewer than 99% of payments resolve to a client: their invoices are unclear (nothing definite is credited)",
  "accept-unmapped-status": "a column that looks like a status/type/void/reversal is not mapped (map it with --columns status=\"Header\")",
  "accept-unattributed-refunds": "refunds name no known invoice: some invoice may be owed money back that this cannot see",
};
export const PAYMENTS_MATCH_FLAGS = ["file", "columns", "unclear", "review-out", "live", ...Object.keys(LIVE_WAIVERS)];
export const PAYMENTS_MATCH_BOOLEANS = Object.keys(LIVE_WAIVERS);
export const PAYMENTS_FILE_KIND = "payments_export";
export const MIN_CLIENT_RESOLUTION = 0.99;
const USAGE = "Usage: import:fetch payments-match --file <payments.xls> [--file <more.xls> …] [--columns name=Header,…] [--unclear credit-definite|open] [--review-out <path>] [--live [--accept-…]]";

/**
 * Raw invoice summaries (in seazonaId order) → the matcher's invoices, plus why
 * the rest were left out. A number carried by more than one record (any status)
 * is credited for NEITHER: every such record is left out and the number listed
 * in `duplicateNumbers`, so it is absent from the derived file and the loader
 * keeps it open.
 */
export function invoicesFromRecords(records) {
  const sorted = [...records].sort(bySeazonaId);
  const perNumber = new Map();
  for (const { payload } of sorted) {
    const n = recordNumber(payload, INVOICE_NUMBER_FIELDS);
    if (n) perNumber.set(n, (perNumber.get(n) ?? 0) + 1);
  }
  const invoices = [];
  const skipped = { void: 0, noNumber: 0, badTotal: 0, duplicateNumber: 0 };
  for (const { payload } of sorted) {
    const number = recordNumber(payload, INVOICE_NUMBER_FIELDS);
    const totalCents = centsOf(payload?.total);
    if (!number) { skipped.noNumber += 1; continue; }
    if (perNumber.get(number) > 1) { skipped.duplicateNumber += 1; continue; }
    if (invoiceStatusFor(payload.status) === "void") { skipped.void += 1; continue; }
    if (totalCents == null || totalCents < 0) { skipped.badTotal += 1; continue; }
    invoices.push({ number, totalCents, clientKey: payload.clientId == null ? null : String(payload.clientId) });
  }
  const duplicateNumbers = [...perNumber].filter(([, c]) => c > 1).map(([n]) => n).sort((a, b) => a - b);
  return { invoices, skipped, duplicateNumbers };
}

/** key → id, where a key two different ids share maps to null (never guessed). */
const addUnique = (map, key, id) => map.set(key, map.has(key) && map.get(key) !== id ? null : id);

/**
 * Raw client records → resolve(clientCellText) → Seazona client id or null.
 * The cell may hold an account number or a practice name; an account number
 * or a name shared by two clients resolves to nothing.
 */
export function clientResolver(clientRecords) {
  const byAccount = new Map();
  const byName = new Map();
  for (const { seazonaId, payload } of clientRecords) {
    const id = String(seazonaId);
    const account = normAccount(payload?.accountNumber);
    if (account) addUnique(byAccount, account, id);
    for (const name of new Set([firstString(payload, ["company"]), firstString(payload, ["fullName"])].filter(Boolean).map(fold))) addUnique(byName, name, id);
  }
  return (text) => {
    if (!text) return null;
    const account = byAccount.get(normAccount(text));
    if (account !== undefined) return account;
    return byName.get(fold(text)) ?? null;
  };
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** Unclear, partial and net-refund invoices, one row each: numbers, cents, payment ids, dates and amounts. No notes, no names. */
export function reviewCsv(result, derived, paymentsById) {
  const openOf = new Map(derived.rows.map((r) => [r.key, r.cents]));
  const overpaid = new Set(result.overpaid);
  const netRefund = new Set(result.netRefund);
  const lines = [["invoice_number", "status", "flags", "total_cents", "definite_cents", "open_cents", "payment_ids", "payment_dates", "payment_amounts_cents"].join(",")];
  for (const i of [...result.invoices].sort((a, b) => a.number - b.number)) {
    if (i.status !== MATCH_STATUS.unclear && i.status !== MATCH_STATUS.partial && !netRefund.has(i.number)) continue;
    const flags = [overpaid.has(i.number) && "overpaid", netRefund.has(i.number) && "net-refund"].filter(Boolean).join(";");
    const ps = i.paymentIds.map((id) => paymentsById.get(id));
    lines.push([i.number, i.status, flags, i.totalCents, i.definiteCents, openOf.get(String(i.number)), i.paymentIds.join(";"), ps.map((p) => p.date).join(";"), ps.map((p) => p.amountCents).join(";")].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** What the run saw, for the counts and the live gates. Counts and cents only. */
function summarize({ parsedList, merged, payments, result }) {
  const amountOf = new Map(merged.payments.map((p) => [p.id, p.amountCents]));
  const cents = (ids) => ids.reduce((n, id) => n + amountOf.get(id), 0);
  const resolved = payments.filter((p) => p.clientKey != null).length;
  return {
    fileProblems: parsedList.reduce((n, p) => n + p.problems.reduce((m, x) => m + x.count, 0), 0),
    reversed: parsedList.reduce((n, p) => n + p.reversedLines.length, 0),
    unmappedStatus: [...new Set(parsedList.flatMap((p) => p.unmappedStatusHeaders))],
    resolution: payments.length ? resolved / payments.length : 1,
    resolved,
    unattributedCents: cents(result.unattributedPayments),
    unattributedRefundCents: cents(result.unattributedRefunds),
    crossClientCents: cents(result.crossClient.map((c) => c.paymentId)),
  };
}

function countLines({ parsedList, merged, result, derived, skipped, duplicateNumbers, s }) {
  const r = result;
  const lines = [
    `Payments read: ${merged.payments.length} from ${parsedList.length} file(s) (${merged.duplicatesDropped} repeated across files dropped; ${s.reversed} reversal/void row(s) subtracted; ${s.fileProblems} problem row(s)).`,
    `  client resolved: ${s.resolved} (${(s.resolution * 100).toFixed(1)}%; a live run needs ${MIN_CLIENT_RESOLUTION * 100}%).`,
    `  attributed ${r.attributedPayments}, client unknown (invoices unclear) ${r.clientUnknownPayments}, cross-client (not applied) ${r.crossClient.length} (${s.crossClientCents} cents), unattributed (no known invoice named) ${r.unattributedPayments.length} (${s.unattributedCents} cents).`,
    `  unattributed refunds: ${r.unattributedRefunds.length} (${s.unattributedRefundCents} cents).`,
    `  matched by a prefixed reference (inv / invoice / #): ${r.prefixedPayments}; by a bare number: ${r.barePayments}.`,
    `  multi-invoice payments that do not add up: ${r.unclearPayments.filter((u) => u.reason === "sum-mismatch").length}; overpaid invoices (unclear, kept open): ${r.overpaid.length}; refunds above payments: ${r.netRefund.length}.`,
    `Invoices matched: ${r.invoices.length} (left out: ${skipped.void} void, ${skipped.noNumber} no number, ${skipped.badTotal} bad or negative total, ${skipped.duplicateNumber} record(s) sharing a number).`,
  ];
  if (duplicateNumbers.length) lines.push(`  invoice number(s) on more than one record (never credited): ${duplicateNumbers.length}: ${duplicateNumbers.slice(0, 20).join(", ")}${duplicateNumbers.length > 20 ? ", …" : ""}.`);
  if (s.unmappedStatus.length) lines.push(`  UNMAPPED status-like column(s): ${s.unmappedStatus.map((h) => `"${h}"`).join(", ")}. Map with --columns status="Header" (or waive on --live with --accept-unmapped-status).`);
  const open = new Map(derived.rows.map((x) => [x.key, x.cents]));
  for (const status of Object.values(MATCH_STATUS)) {
    const list = r.invoices.filter((i) => i.status === status);
    const total = list.reduce((n, i) => n + i.totalCents, 0);
    const left = list.reduce((n, i) => n + open.get(String(i.number)), 0);
    lines.push(`  ${status}: ${list.length} invoice(s), ${total} cents billed, ${left} cents left open.`);
  }
  lines.push(`Derived open balance: ${derived.rows.reduce((n, x) => n + x.cents, 0)} cents over ${derived.rows.length} invoice(s); ${derived.review.length} unclear invoice(s) to review.`);
  return lines;
}

function options(flags) {
  const files = flags.file ?? [];
  if (!files.length) throw new ImportRefusal(USAGE);
  const unclear = flags.unclear ?? "credit-definite";
  if (!UNCLEAR_MODES.includes(unclear)) throw new ImportRefusal("--unclear must be credit-definite (default: credit only money a payment named for that invoice alone) or open (keep unclear invoices fully open).");
  const waivers = Object.keys(LIVE_WAIVERS).filter((f) => flags[f]);
  if (waivers.length && !flags.live) throw new ImportRefusal(`--${waivers.join(", --")} applies only with --live.`);
  return { files, unclear, columns: flags.columns ? parseColumnsFlag(flags.columns) : {} };
}

/** Every live gate that fails and was not waived, as one refusal. */
function assertLiveGates(flags, s, result) {
  const failing = {
    "accept-export-problems": s.fileProblems > 0,
    "accept-unresolved-clients": s.resolution < MIN_CLIENT_RESOLUTION,
    "accept-unmapped-status": s.unmappedStatus.length > 0,
    "accept-unattributed-refunds": result.unattributedRefunds.length > 0,
  };
  const open = Object.keys(failing).filter((f) => failing[f] && !flags[f]);
  if (open.length) throw new ImportRefusal(`Not sealed: ${open.map((f) => `${LIVE_WAIVERS[f]} (waive with --${f})`).join("; ")}. Fix the input, or get the user's OK to waive.`);
}

async function writeReview(deps, path, data) {
  try {
    await deps.writeFile(path, data, { mode: 0o600, flag: "wx" });
  } catch (err) {
    if (err?.code === "EEXIST") throw new ImportRefusal(`The review CSV ${path} already exists; it is never overwritten. Delete it or pass another --review-out.`);
    throw err;
  }
}

export async function runPaymentsMatch(flags, store, deps) {
  const opts = options(flags);
  const rawFiles = [];
  for (const path of opts.files) rawFiles.push(await deps.readFile(path));
  const parsedList = rawFiles.map((bytes, i) => readPaymentsExport(bytes, { columns: opts.columns, file: i + 1 }));
  const merged = mergePaymentFiles(parsedList);
  const invoiceRecords = await store.records("invoice");
  const { invoices, skipped, duplicateNumbers } = invoicesFromRecords(invoiceRecords);
  const resolve = clientResolver(await store.records("client"));
  const payments = merged.payments.map((p) => ({ id: p.id, date: p.date, amountCents: p.amountCents, clientKey: resolve(p.client), text: `${p.reference} ${p.notes}` }));
  const result = matchPayments({ invoices, payments });
  const derived = derivedBalances(result, { unclear: opts.unclear });
  const s = summarize({ parsedList, merged, payments, result });
  const now = deps.now();
  const reviewPath = flags["review-out"] ?? join(tmpdir(), `payments-match-review-${now.toISOString().replace(/[:.]/g, "-")}.csv`);
  await writeReview(deps, reviewPath, reviewCsv(result, derived, new Map(payments.map((p) => [p.id, p]))));
  deps.print(countLines({ parsedList, merged, result, derived, skipped, duplicateNumbers, s }));
  deps.print([`Review CSV (unclear, partial and net-refund invoices; numbers and cents only, mode 600): ${reviewPath}`]);
  parsedList.forEach((p, i) => {
    if (p.problems.length) deps.print([`File ${i + 1} problems (row numbers only):`, ...p.problems.map((x) => `  ${x.kind} x${x.count}: rows ${x.lines.slice(0, 20).join(", ")}`)]);
  });
  if (!flags.live) {
    deps.print(["Dry run: nothing was stored. Re-run with --live to seal the derived balances."]);
    return 0;
  }
  assertLiveGates(flags, s, result);
  const provenance = {
    maxInvoiceNumber: invoices.reduce((m, i) => Math.max(m, i.number), 0), invoiceRecords: invoiceRecords.length,
    derivedRows: derived.rows.length, sourceFiles: rawFiles.length, unclear: opts.unclear, derivedAt: now.toISOString(),
  };
  for (const bytes of rawFiles) await store.saveFile({ kind: PAYMENTS_FILE_KIND, bytes });
  const id = await store.saveFile({ kind: DERIVED_BALANCE_KIND, bytes: derivedExportBytes(derived.rows, provenance) });
  deps.print([
    `Sealed ${rawFiles.length} Payments export(s) and the derived balances as file ${id} (highest invoice ${provenance.maxInvoiceNumber}, derived ${provenance.derivedAt}).`,
    `NEXT: import:load balances --balances per-invoice --file-id ${id} --target rehearsal (dry run first). Invoices loaded later than this stay open: re-derive after a newer invoices fetch.`,
    "Delete the local copies of the Payments exports now (and empty the Trash).",
  ]);
  return 0;
}
