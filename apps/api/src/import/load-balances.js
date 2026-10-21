import { eq } from "drizzle-orm";
import { LEGACY_SETTLEMENT_SOURCE, OPENING_BALANCE_PREFIX } from "@my-app/shared";
import { invoices, invoiceLines, invoicePayments } from "../db/schema/index.js";
import { sealInvoice, sealLine } from "../services/billing/invoice-crypto.js";
import { allocateSequenceNumber, INVOICE_NUMBER_LOCK } from "../services/sequence.service.js";
import { loadOwners, normAccount } from "./owners.js";
import {
  SETTLEMENT_PREFIX, planInvoiceSettlements, planClientOpenings, mapOpeningInvoice, settlementCandidates,
} from "./balance-plan.js";
import { insertMissing } from "./load-writer.js";
import { enforceSeeds } from "./seed-check.js";
import { problemList } from "./problems.js";
import { ImportRefusal } from "./import-errors.js";
import { EXPORT_PROBLEM_KINDS } from "./export-table.js";

const BATCH = 500;
const PAID_CHUNK = 1000;
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const strings = (list) => list.map(String);

/** Keys of export rows that did not parse to one reliable balance: never read as zero. */
export const leftOpenKeys = (parsed) =>
  new Set(parsed.problems.filter((p) => p.kind === EXPORT_PROBLEM_KINDS.badBalance || p.kind === EXPORT_PROBLEM_KINDS.duplicate).flatMap((p) => p.seazonaIds.map(String)));

const NO_KEY_WARNING = "A row with NO key cannot be matched to an invoice or account, so whatever it owed will be settled as PAID unless the export is fixed.";
const noKeyRows = (parsed) => parsed.problems.find((p) => p.kind === EXPORT_PROBLEM_KINDS.noKey)?.count ?? 0;

/** One opening-balance invoice in the caller's transaction, numbered from the live sequence. */
export async function writeOpening(tx, { opening, start, cutoverAt }) {
  const invoiceNumber = await allocateSequenceNumber(tx, { lockId: INVOICE_NUMBER_LOCK, table: invoices, column: invoices.invoiceNumber, start });
  const { invoice, lines } = mapOpeningInvoice({ opening, invoiceNumber, cutoverAt });
  await tx.insert(invoices).values(sealInvoice(invoice));
  await tx.insert(invoiceLines).values(lines.map(sealLine));
  return invoice;
}

async function writeSettlements(db, rows, existingKeys, guard) {
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    guard();
    await db.transaction(async (tx) => {
      const r = await insertMissing(tx, invoicePayments, rows.slice(i, i + BATCH), { keyOf: (row) => row.transactionId, existingKeys });
      written += r.insertedIds.size;
    });
  }
  return written;
}

/** Real payments already on the invoices that could get a new settlement row: id → paid cents (injected ledger sum). */
async function paymentsOn(candidates, paidCents, db) {
  const paid = new Map();
  for (let i = 0; i < candidates.length; i += PAID_CHUNK) {
    const part = await paidCents(candidates.slice(i, i + PAID_CHUNK).map((c) => c.id), db);
    for (const [id, cents] of part) paid.set(id, cents);
  }
  return paid;
}

async function perInvoice({ db, live, legacy, parsed, existingTransactionIds, paidCents, report, guard }) {
  const paidByInvoice = await paymentsOn(settlementCandidates(legacy, "per-invoice", existingTransactionIds), paidCents, db);
  const plan = planInvoiceSettlements({ legacyInvoices: legacy, exportRows: parsed.rows, existingTransactionIds, paidByInvoice, leftOpenKeys: leftOpenKeys(parsed) });
  report.reconciliation = plan.reconciliation;
  report.counts = {
    exportRows: parsed.rows.length, settlements: plan.rows.length, settledCents: sum(plan.rows, (r) => r.appliedCents),
    alreadySettled: plan.alreadySettled, skippedHasPayments: plan.hasPayments.length,
    openCents: sum([...plan.openByClient.values()], (c) => c),
    credits: plan.credits.length, creditCents: sum(plan.credits, (c) => c.cents),
  };
  report.problems = problemList([
    ["export_row_without_invoice", strings(plan.unmatched)],
    ["open_balance_above_total", strings(plan.overTotal)],
    ["invoice_negative_total", strings(plan.negativeTotal)],
    ["invoice_left_open_export_problem", strings(plan.leftOpen)],
    ["open_balance_on_void_invoice", strings(plan.openOnVoid)],
    ["invoice_has_real_payments_not_settled", strings(plan.hasPayments)],
    ["credit_balance_for_staff", strings(plan.credits.map((c) => c.invoiceNumber))],
  ]);
  if (live) report.written = { settlements: await writeSettlements(db, plan.rows, existingTransactionIds, guard) };
  return report;
}

async function accountOwners(db) {
  const o = await loadOwners(db);
  const unowned = new Map();
  for (const a of o.rejectedAccounts) unowned.set(a, "account_owner_not_approved_doctor");
  for (const a of o.ambiguousAccounts) unowned.set(a, "account_has_multiple_owners");
  const accountOfUser = new Map(o.rows.filter((u) => normAccount(u.seazonaAccountNumber)).map((u) => [u.id, normAccount(u.seazonaAccountNumber)]));
  return { ownerByAccount: o.byAccount, unownedAccounts: unowned, accountOfUser };
}

async function perClient({ raw, db, live, target, legacy, parsed, existingTransactionIds, paidCents, starts, cutoverAt, report, guard }) {
  const { ownerByAccount, unownedAccounts, accountOfUser } = await accountOwners(db);
  const paidByInvoice = await paymentsOn(settlementCandidates(legacy, "per-client", existingTransactionIds), paidCents, db);
  const plan = planClientOpenings({
    legacyInvoices: legacy, exportRows: parsed.rows, ownerByAccount, unownedAccounts, accountOfUser, existingTransactionIds, paidByInvoice,
    leftOpenAccounts: new Set([...leftOpenKeys(parsed)].map(normAccount)),
    existingOpeningKeys: new Set(legacy.map((i) => i.legacySeazonaInvoiceId).filter((k) => k?.startsWith(OPENING_BALANCE_PREFIX))),
  });
  const seeds = await enforceSeeds({ raw, db, target, live, starts });
  report.seeds = seeds.summary;
  report.reconciliation = plan.reconciliation;
  report.counts = {
    exportRows: parsed.rows.length, historyLeftOpen: plan.historyLeftOpen, settlements: plan.settlements.length, alreadySettled: plan.alreadySettled, skippedHasPayments: plan.hasPayments.length,
    openings: plan.openings.length, openingCents: sum(plan.openings, (o) => o.cents), unownedOpenings: plan.unowned.size, alreadyOpened: plan.alreadyOpened,
    credits: plan.credits.length, creditCents: sum(plan.credits, (c) => c.cents),
  };
  const unownedBy = (kind) => [...plan.unowned].filter(([, k]) => k === kind).map(([account]) => account);
  report.problems = problemList([
    ["export_account_without_client", strings(plan.unmatched)],
    ["account_left_open_export_problem", strings(plan.leftOpen)],
    ["invoice_has_real_payments_not_settled", strings(plan.hasPayments)],
    ["account_has_multiple_owners", unownedBy("account_has_multiple_owners")],
    ["account_owner_not_approved_doctor", unownedBy("account_owner_not_approved_doctor")],
    ["credit_balance_for_staff", strings(plan.credits.map((c) => c.accountNumber))],
  ]);
  if (!live) return report;
  const start = starts.invoice ?? (seeds.max.invoice ?? 0) + 1;
  const settlements = await writeSettlements(db, plan.settlements, existingTransactionIds, guard);
  let openings = 0;
  for (const opening of plan.openings) {
    guard();
    await db.transaction((tx) => writeOpening(tx, { opening, start, cutoverAt }));
    openings += 1;
  }
  report.written = { settlements, openings };
  return report;
}

/**
 * `import:load balances --balances per-invoice|per-client`. `parsed` is
 * readExport's result for the stored export (load-cli.js reads it). Run after
 * `invoices`. Re-runnable with the same export: nothing is written twice.
 *
 * `paidCents(invoiceIds, db) → Map(invoiceId → cents)` is the app's own ledger
 * sum (ledger.service.js paidCentsByInvoice); load-cli.js injects it so this
 * module never loads config/database.js. A live run refuses when the export
 * had problems unless `acceptExportProblems` (Ruling Q4); the problems are
 * always in the report (row numbers and keys only).
 *
 * Per-client opening invoices for an account with no single eligible owner
 * load unowned; correcting the link and re-running `invoices` attaches them
 * (load-invoices.js reattach).
 */
export async function loadBalances({
  raw, db, live, target, mode, parsed, fileId = null, starts = {}, cutoverAt = new Date(), paidCents, acceptExportProblems = false, lock = null,
}) {
  if (!SETTLEMENT_PREFIX[mode]) throw new ImportRefusal("--balances must be per-invoice or per-client.");
  if (typeof paidCents !== "function") throw new TypeError("loadBalances needs the injected paidCents(invoiceIds, db) ledger sum.");
  if (live && parsed.problems.length && !acceptExportProblems) {
    const summary = parsed.problems.map((p) => `${p.kind} x${p.count} (rows ${p.lines.slice(0, 10).join(", ")})`).join("; ");
    throw new ImportRefusal(`The balance export has problems: ${summary}. ${NO_KEY_WARNING} Fix the file, or pass --accept-export-problems: rows with an unreadable or duplicated balance then stay open (nothing is settled for them), but keyless rows still cannot be matched.`);
  }
  if (live && !lock) throw new TypeError("A live balances run needs the load lock (makeFetchLock with LOAD_LOCK_KEY on the target).");
  if (lock && live && !(await lock.tryLock())) throw new ImportRefusal("Another load is running against this target (the load lock is held). Wait for it to finish.");
  try {
    return await run({ raw, db, live, target, mode, parsed, fileId, starts, cutoverAt, paidCents, guard: () => lock?.assertHeld() });
  } finally {
    if (lock && live) await lock.close();
  }
}

async function run({ raw, db, live, target, mode, parsed, fileId, starts, cutoverAt, paidCents, guard }) {
  const legacy = await db
    .select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, kind: invoices.kind, legacySeazonaInvoiceId: invoices.legacySeazonaInvoiceId,
      clientUserId: invoices.clientUserId, status: invoices.status, totalCents: invoices.totalCents, issuedAt: invoices.issuedAt,
    })
    .from(invoices)
    .where(eq(invoices.kind, "legacy"));
  const settled = await db.select({ transactionId: invoicePayments.transactionId }).from(invoicePayments).where(eq(invoicePayments.source, LEGACY_SETTLEMENT_SOURCE));
  const existingTransactionIds = new Set(settled.map((r) => r.transactionId));
  const other = mode === "per-invoice" ? "per-client" : "per-invoice";
  const hasOpening = legacy.some((i) => i.legacySeazonaInvoiceId?.startsWith(OPENING_BALANCE_PREFIX));
  if ([...existingTransactionIds].some((t) => t.startsWith(SETTLEMENT_PREFIX[other])) || (mode === "per-invoice" && hasOpening)) {
    throw new ImportRefusal(`Balances were already loaded ${other} on this target. Re-clone the rehearsal (or restore production from the cutover backup) before switching paths.`);
  }
  const report = { step: "balances", live, mode, fileId, exportProblems: parsed.problems };
  if (noKeyRows(parsed)) report.warnings = [NO_KEY_WARNING];
  const args = { raw, db, live, target, legacy, parsed, existingTransactionIds, paidCents, starts, cutoverAt, report, guard };
  return mode === "per-invoice" ? perInvoice(args) : perClient(args);
}
