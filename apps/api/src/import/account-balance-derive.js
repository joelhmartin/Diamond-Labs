import { ImportRefusal } from "./import-errors.js";
import { parseColumnsFlag, readExport, DERIVED_BALANCE_KIND } from "./export-table.js";
import { readPaymentsExport, mergePaymentFiles, derivedExportBytes } from "./payments-export.js";
import { invoicesFromRecords, clientResolver, PAYMENTS_FILE_KIND } from "./payments-match-command.js";
import { recordNumber, INVOICE_NUMBER_FIELDS } from "./seazona-records.js";

/**
 * `import:fetch balance-derive --balance-file <AccountBalance.xls> --statement-through <YYYY-MM-DD>
 *   [--file <payments.xls> … --payments-through <YYYY-MM-DD>] [--balance-columns name=Header,…] [--columns name=Header,…] [--live [--accept-…]]`
 *
 * Seazona keeps one running balance per account and applies every payment to
 * the oldest amount due; a payment is never linked to an invoice. So the source
 * of truth is the portal's Account Balance report, which already holds
 * adjustments and the balances carried in at its go-live:
 *
 *   owed = report balance + invoices due after the last statement − payments after the report
 *
 * and the newest dated invoices stay open until they add up to `owed` (the same
 * result as paying oldest first). Every account then matches Seazona to the cent.
 * Sealed in the per-invoice shape, so `import:load balances` reads it unchanged.
 * Output is counts, dates and cents: never names, account numbers or notes.
 */
const LIVE_WAIVERS = {
  "accept-export-problems": "the report or the Payments exports have problem rows (listed above)",
  "accept-unresolved-accounts": "report rows match no single client: what they owe is not carried over",
  "accept-excess": "some accounts owe more than all their invoices (balances carried in at Seazona's go-live): the excess is not on any invoice",
};
export const BALANCE_DERIVE_FLAGS = ["balance-file", "statement-through", "file", "payments-through", "balance-columns", "columns", "live", ...Object.keys(LIVE_WAIVERS)];
export const BALANCE_DERIVE_BOOLEANS = Object.keys(LIVE_WAIVERS);
export const ACCOUNT_BALANCE_METHOD = "account-balance";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const USAGE = "Usage: import:fetch balance-derive --balance-file <AccountBalance.xls> --statement-through <YYYY-MM-DD> [--file <payments.xls> … --payments-through <YYYY-MM-DD>] [--live]";

/** The day an export's date cell names ("6/27/2025 12:00:00 AM" or ISO), or null. */
export function exportDay(text) {
  const s = String(text ?? "").trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(s);
  return iso ? iso[0] : null;
}

const newestFirst = (a, b) => b.due.localeCompare(a.due) || b.number - a.number;
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);

/**
 * Pure. invoices: { number, totalCents, clientKey, due ("YYYY-MM-DD…" or null) }.
 * balances: clientKey → report balance in cents (negative = credit).
 * laterPayments: clientKey → cents received after the report's payments.
 * An undated invoice is on no statement and stays out of `rows`; the loader keeps
 * it open. A client the report omits has no statement balance (0).
 */
export function deriveFromAccountBalances({ invoices, balances, laterPayments = new Map(), statementThrough }) {
  const out = { rows: [], undated: [], noClient: [], credits: [], excess: [], notInReport: [] };
  const perClient = new Map();
  for (const i of invoices) {
    const due = i.due ? String(i.due).slice(0, 10) : null;
    if (i.clientKey == null) { out.noClient.push(i); continue; }
    if (!due) { out.undated.push(i); continue; }
    if (!perClient.has(i.clientKey)) perClient.set(i.clientKey, []);
    perClient.get(i.clientKey).push({ ...i, due });
  }
  for (const key of balances.keys()) if (!perClient.has(key)) perClient.set(key, []);
  for (const key of laterPayments.keys()) if (!perClient.has(key)) perClient.set(key, []);
  for (const [clientKey, list] of perClient) {
    if (!balances.has(clientKey)) out.notInReport.push({ clientKey, invoices: list.length, cents: sum(list, (i) => i.totalCents) });
    const unstatemented = sum(list.filter((i) => i.due > statementThrough), (i) => i.totalCents);
    const owed = (balances.get(clientKey) ?? 0) + unstatemented - (laterPayments.get(clientKey) ?? 0);
    let left = Math.max(0, owed);
    for (const i of [...list].sort(newestFirst)) {
      const open = Math.min(left, i.totalCents);
      left -= open;
      out.rows.push({ key: String(i.number), cents: open });
    }
    if (owed < 0) out.credits.push({ clientKey, cents: -owed });
    if (left > 0) out.excess.push({ clientKey, cents: left });
  }
  out.rows.sort((a, b) => Number(a.key) - Number(b.key));
  return out;
}

const openByYear = (rows, dueOf) => {
  const years = {};
  for (const r of rows) if (r.cents > 0) { const y = dueOf.get(Number(r.key))?.slice(0, 4) ?? "?"; years[y] = (years[y] ?? 0) + r.cents; }
  return Object.entries(years).sort().map(([y, c]) => `${y} ${c}`).join(", ");
};

function options(flags) {
  if (!flags["balance-file"] || !flags["statement-through"]) throw new ImportRefusal(USAGE);
  if (!DAY.test(flags["statement-through"])) throw new ImportRefusal("--statement-through must be YYYY-MM-DD: the last day of the last statement month.");
  const files = flags.file ?? [];
  const through = flags["payments-through"];
  if (files.length && !through) throw new ImportRefusal("--file needs --payments-through <YYYY-MM-DD>: the last day of payments the report already counts.");
  if (through && !files.length) throw new ImportRefusal("--payments-through needs the Payments exports (--file).");
  if (through && !DAY.test(through)) throw new ImportRefusal("--payments-through must be YYYY-MM-DD.");
  const waivers = Object.keys(LIVE_WAIVERS).filter((f) => flags[f]);
  if (waivers.length && !flags.live) throw new ImportRefusal(`--${waivers.join(", --")} applies only with --live.`);
  return { files, through };
}

export async function runBalanceDerive(flags, store, deps) {
  const { files, through } = options(flags);
  const reportBytes = await deps.readFile(flags["balance-file"]);
  const report = readExport(reportBytes, { kind: "client", columns: flags["balance-columns"] ? parseColumnsFlag(flags["balance-columns"]) : { balance: ["balance"] } });
  const invoiceRecords = await store.records("invoice");
  const { invoices: read, skipped, duplicateNumbers } = invoicesFromRecords(invoiceRecords);
  const dueByNumber = new Map(invoiceRecords.map(({ payload }) => [recordNumber(payload, INVOICE_NUMBER_FIELDS), payload?.due ?? null]));
  const invoices = read.map((i) => ({ ...i, due: dueByNumber.get(i.number) ?? null }));
  const resolve = clientResolver(await store.records("client"));

  const balances = new Map();
  const unresolved = [];
  for (const row of report.rows) {
    const key = resolve(row.key);
    if (key == null) unresolved.push(row);
    else balances.set(key, row.cents);
  }

  const paymentFiles = [];
  for (const path of files) paymentFiles.push(await deps.readFile(path));
  const parsed = paymentFiles.map((bytes, i) => readPaymentsExport(bytes, { columns: flags.columns ? parseColumnsFlag(flags.columns) : {}, file: i + 1 }));
  const laterPayments = new Map();
  let laterCount = 0;
  let laterUnresolved = 0;
  if (parsed.length) {
    for (const p of mergePaymentFiles(parsed).payments) {
      const day = exportDay(p.date);
      if (!day || day <= through) continue;
      const key = resolve(p.client);
      if (key == null) { laterUnresolved += 1; continue; }
      laterCount += 1;
      laterPayments.set(key, (laterPayments.get(key) ?? 0) + p.amountCents);
    }
  }

  const d = deriveFromAccountBalances({ invoices, balances, laterPayments, statementThrough: flags["statement-through"] });
  const dueOf = new Map(invoices.map((i) => [i.number, i.due ? String(i.due).slice(0, 10) : null]));
  const open = sum(d.rows, (r) => r.cents);
  const fileProblems = report.problems.length + sum(parsed, (p) => p.problems.length) + laterUnresolved;
  deps.print([
    `Account Balance report: ${report.rows.length} account(s), net ${sum(report.rows, (r) => r.cents)} cents (owing ${sum(report.rows.filter((r) => r.cents > 0), (r) => r.cents)}, credit ${-sum(report.rows.filter((r) => r.cents < 0), (r) => r.cents)}); ${report.problems.length} problem kind(s); ${unresolved.length} matched no single client (${sum(unresolved, (r) => r.cents)} cents).`,
    `Payments after ${through ?? "the report"}: ${laterCount} (${sum([...laterPayments.values()], (c) => c)} cents)${laterUnresolved ? `, ${laterUnresolved} with no client` : ""}.`,
    `Invoices: ${invoices.length} read (left out: ${skipped.void} void, ${skipped.noNumber} no number, ${skipped.badTotal} bad total, ${skipped.duplicateNumber} sharing a number); ${d.undated.length} undated (${sum(d.undated, (i) => i.totalCents)} cents) and ${d.noClient.length} with no client (${sum(d.noClient, (i) => i.totalCents)} cents) stay out of the file and open.`,
    `Derived open balance: ${open} cents on ${d.rows.filter((r) => r.cents > 0).length} of ${d.rows.length} invoice(s). By due year: ${openByYear(d.rows, dueOf)}.`,
    `  Credits for staff: ${d.credits.length} account(s), ${sum(d.credits, (c) => c.cents)} cents. Net owed: ${open - sum(d.credits, (c) => c.cents) + sum(d.excess, (c) => -c.cents)} cents on invoices.`,
    `  Owed beyond every invoice (carried-in balances): ${d.excess.length} account(s), ${sum(d.excess, (c) => c.cents)} cents.`,
    `  Clients with invoices the report omits: ${d.notInReport.filter((c) => c.invoices).length} (${sum(d.notInReport, (c) => c.cents)} cents billed, older invoices treated as settled).`,
    ...(duplicateNumbers.length ? [`  Invoice number(s) on more than one record: ${duplicateNumbers.join(", ")}.`] : []),
  ]);
  if (!flags.live) {
    deps.print(["Dry run: nothing was stored. Re-run with --live to seal the derived balances."]);
    return 0;
  }
  const failing = { "accept-export-problems": fileProblems > 0, "accept-unresolved-accounts": unresolved.length > 0, "accept-excess": d.excess.length > 0 };
  const reasons = Object.entries(failing).filter(([f, bad]) => bad && !flags[f]).map(([f]) => `--${f}: ${LIVE_WAIVERS[f]}.`);
  if (reasons.length) throw new ImportRefusal(`Refusing to seal:\n  ${reasons.join("\n  ")}`);
  const now = deps.now();
  const provenance = {
    method: ACCOUNT_BALANCE_METHOD, statementThrough: flags["statement-through"], paymentsThrough: through ?? null,
    maxInvoiceNumber: invoices.reduce((m, i) => Math.max(m, i.number), 0), invoiceRecords: invoiceRecords.length,
    derivedRows: d.rows.length, sourceFiles: paymentFiles.length + 1, derivedAt: now.toISOString(),
  };
  await store.saveFile({ kind: "balances_client", bytes: reportBytes });
  for (const bytes of paymentFiles) await store.saveFile({ kind: PAYMENTS_FILE_KIND, bytes });
  const id = await store.saveFile({ kind: DERIVED_BALANCE_KIND, bytes: derivedExportBytes(d.rows, provenance) });
  deps.print([
    `Sealed the Account Balance report, ${paymentFiles.length} Payments export(s) and the derived balances as file ${id} (highest invoice ${provenance.maxInvoiceNumber}, derived ${provenance.derivedAt}).`,
    `NEXT: import:load balances --balances per-invoice --file-id ${id} --target rehearsal (dry run first). Re-derive after a newer invoices fetch.`,
    "Delete the local copies of these exports now (and empty the Trash).",
  ]);
  return 0;
}
