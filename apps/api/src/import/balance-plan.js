import { isoDateIn, LAB_TIMEZONE, LEGACY_SETTLEMENT_SOURCE, OPENING_BALANCE_PREFIX, isOpeningBalanceInvoice } from "@my-app/shared";
import { createId } from "../lib/id.js";
import { normAccount } from "./owners.js";
import { assertCents } from "../lib/money.js";

/**
 * Opening balances (spec B.3). Paid and balance are derived from the ledger,
 * so a legacy invoice's settled part becomes one ledger row:
 *  - per-invoice (preferred): settle total − Seazona's open balance; aging stays exact.
 *  - per-client (fallback): settle every history invoice in full, and give each
 *    owing client one "Opening balance" invoice dated at cutover (aging restarts).
 * Credits (negative balances) are never written: they are reported for staff.
 * The transaction-id prefix records the path, so a target loaded one way
 * refuses the other. An invoice that already has real (non-settlement)
 * payments is never settled here; it is reported instead (`hasPayments`).
 * `paidByInvoice` is invoice id → paid cents, summed by the caller with the
 * app's own ledger sum; it is only consulted for invoices that would receive a
 * NEW settlement row, so every cent in it is a real payment.
 */
export const SETTLEMENT_PREFIX = { "per-invoice": "legacy:", "per-client": "legacy-full:" };
export const OPENING_LINE_DESCRIPTION = "Opening balance (carried from Seazona)";

const history = (invoices) => invoices.filter((i) => i.kind === "legacy" && !isOpeningBalanceInvoice(i));

export const settlementTransactionId = (inv, mode) => `${SETTLEMENT_PREFIX[mode]}${inv.legacySeazonaInvoiceId}`;

/** The history invoices that could receive a new settlement row under `mode` (the caller sums their real payments). */
export function settlementCandidates(legacyInvoices, mode, existingTransactionIds) {
  return history(legacyInvoices).filter((i) => i.status === "issued" && !existingTransactionIds.has(settlementTransactionId(i, mode)));
}

export function settlementRow(inv, cents, mode) {
  assertCents(cents, "settlement cents");
  return {
    id: createId(), userId: null, invoiceId: inv.id, seazonaClientId: null, seazonaInvoiceId: inv.legacySeazonaInvoiceId,
    invoiceNumber: String(inv.invoiceNumber), appliedCents: cents,
    transactionId: settlementTransactionId(inv, mode),
    seazonaPaymentId: null, refundsTransactionId: null, source: LEGACY_SETTLEMENT_SOURCE,
    paidOn: isoDateIn(LAB_TIMEZONE, new Date(inv.issuedAt)), reference: null, note: null,
  };
}

const emptyDiffs = () => ({
  credits: 0, unmatched: 0, overTotal: 0, negativeTotal: 0, openOnVoid: 0, skippedRealPayments: 0,
  leftOpenExportProblem: 0, unownedOpening: 0, accountWithoutClient: 0,
});
const sumRows = (rows) => rows.reduce((n, r) => n + r.cents, 0);

/**
 * Reconciliation (to the cent): exportCents = loadedOpenCents + Σ differences.
 * Every export row's cents land in exactly one place: the open balance the
 * system shows an owner (loadedOpenCents), or one named difference. A
 * difference is (export cents) − (cents left open on the loaded side), so
 * `unownedOpening` is positive cents that are open but attached to nobody.
 * `exportCents` sums the rows that PARSED; a row that did not parse is not in
 * it (its key is a leftOpen / export problem instead).
 */
const reconcile = (exportRows, loadedOpenCents, diffs) => {
  const exportCents = sumRows(exportRows);
  const total = loadedOpenCents + Object.values(diffs).reduce((n, c) => n + c, 0);
  if (total !== exportCents) throw new Error("Balance reconciliation does not add up: this is a bug in balance-plan.js, nothing was written.");
  return { exportCents, loadedOpenCents, differences: diffs };
};

/**
 * `leftOpenKeys`: invoice numbers (as strings) of export rows that did not
 * parse (bad balance, duplicate key). Those invoices stay UNSETTLED at their
 * full total: an unreadable balance is never read as zero.
 */
export function planInvoiceSettlements({ legacyInvoices, exportRows, existingTransactionIds, paidByInvoice = new Map(), leftOpenKeys = new Set() }) {
  const open = new Map(exportRows.map((r) => [r.key, r.cents]));
  const byNumber = new Map(history(legacyInvoices).map((i) => [i.invoiceNumber, i]));
  const out = {
    rows: [], credits: [], unmatched: [], overTotal: [], negativeTotal: [], openOnVoid: [], hasPayments: [], leftOpen: [],
    alreadySettled: 0, openByClient: new Map(),
  };
  const diffs = emptyDiffs();
  let loadedOpen = 0;
  const book = (inv, cents) => {
    if (inv.clientUserId) {
      loadedOpen += cents;
      out.openByClient.set(inv.clientUserId, (out.openByClient.get(inv.clientUserId) ?? 0) + cents);
    } else diffs.unownedOpening += cents;
  };
  for (const [number, cents] of open) {
    const inv = byNumber.get(number);
    if (!inv) { out.unmatched.push(number); diffs.unmatched += cents; }
    else if (inv.status === "void" && cents !== 0) { out.openOnVoid.push(number); diffs.openOnVoid += cents; }
  }
  for (const inv of history(legacyInvoices).filter((i) => i.status === "issued")) {
    const owed = open.get(inv.invoiceNumber) ?? 0;
    const unsettled = (list, category) => { list.push(inv.invoiceNumber); book(inv, inv.totalCents); diffs[category] += owed - inv.totalCents; };
    if (inv.totalCents < 0) { unsettled(out.negativeTotal, "negativeTotal"); continue; }
    if (leftOpenKeys.has(String(inv.invoiceNumber))) { unsettled(out.leftOpen, "leftOpenExportProblem"); continue; }
    if (owed > inv.totalCents) { unsettled(out.overTotal, "overTotal"); continue; }
    if (owed < 0) out.credits.push({ invoiceNumber: inv.invoiceNumber, clientUserId: inv.clientUserId, cents: owed });
    const remaining = Math.max(owed, 0);
    const settle = inv.totalCents - remaining;
    if (settle > 0 && !existingTransactionIds.has(settlementTransactionId(inv, "per-invoice")) && (paidByInvoice.get(inv.id) ?? 0) !== 0) {
      unsettled(out.hasPayments, "skippedRealPayments"); // a credit on such an invoice folds into this difference
      continue;
    }
    book(inv, remaining);
    if (owed < 0) diffs.credits += owed;
    if (settle <= 0) continue;
    if (existingTransactionIds.has(settlementTransactionId(inv, "per-invoice"))) { out.alreadySettled += 1; continue; }
    out.rows.push(settlementRow(inv, settle, "per-invoice"));
  }
  return { ...out, reconciliation: reconcile(exportRows, loadedOpen, diffs) };
}

/**
 * `ownerByAccount`: normalised account number → the one eligible owner.
 * `unownedAccounts`: account → problem kind, for accounts some user carries but
 * none (or several) may own; their opening invoice loads UNOWNED and the
 * invoices step's reattach picks it up once the link is fixed. An account no
 * user carries at all is `unmatched` and writes nothing.
 * `leftOpenAccounts`: accounts whose export row did not parse. Their history
 * stays unsettled and no opening is written. `accountOfInvoice` maps a history
 * invoice's legacySeazonaInvoiceId to its account number, from the RAW STORE
 * (invoice summary → client record), never from the owner: an unowned invoice
 * still has an account. Fail closed: with any left-open account, an invoice
 * whose account can't be derived stays unsettled (`accountUnknown`).
 * Reconciliation here is over the ACCOUNT rows. History left unsettled
 * (left-open account, unknown account, real payments, negative total) is outside
 * it and reported in `unsettledHistory` in cents.
 */
export function planClientOpenings({
  legacyInvoices, exportRows, ownerByAccount, unownedAccounts = new Map(), existingTransactionIds, existingOpeningKeys,
  paidByInvoice = new Map(), leftOpenAccounts = new Set(), accountOfInvoice = new Map(),
}) {
  const out = {
    settlements: [], openings: [], credits: [], unmatched: [], hasPayments: [], leftOpen: [], unowned: new Map(),
    negativeTotal: [], accountUnknown: [], historyLeftOpen: 0, alreadySettled: 0, alreadyOpened: 0,
  };
  const unsettledHistory = { leftOpenExportProblem: 0, accountUnknown: 0, realPayments: 0, negativeTotal: 0 };
  const diffs = emptyDiffs();
  let loadedOpen = 0;
  for (const inv of history(legacyInvoices).filter((i) => i.status === "issued" && i.totalCents !== 0)) {
    if (inv.totalCents < 0) { out.negativeTotal.push(inv.invoiceNumber); unsettledHistory.negativeTotal += inv.totalCents; continue; }
    if (existingTransactionIds.has(settlementTransactionId(inv, "per-client"))) { out.alreadySettled += 1; continue; }
    const account = accountOfInvoice.get(inv.legacySeazonaInvoiceId) ?? null;
    if (leftOpenAccounts.size && !account) { out.accountUnknown.push(inv.invoiceNumber); unsettledHistory.accountUnknown += inv.totalCents; continue; }
    if (leftOpenAccounts.has(account)) { out.historyLeftOpen += 1; unsettledHistory.leftOpenExportProblem += inv.totalCents; continue; }
    if ((paidByInvoice.get(inv.id) ?? 0) !== 0) { out.hasPayments.push(inv.invoiceNumber); unsettledHistory.realPayments += inv.totalCents; continue; }
    out.settlements.push(settlementRow(inv, inv.totalCents, "per-client"));
  }
  const seenLeftOpen = new Set();
  for (const { key, cents } of exportRows) {
    const account = normAccount(key);
    if (leftOpenAccounts.has(account)) { out.leftOpen.push(account); seenLeftOpen.add(account); diffs.leftOpenExportProblem += cents; continue; }
    if (cents === 0) continue;
    const owner = ownerByAccount.get(account) ?? null;
    const unownedKind = unownedAccounts.get(account);
    if (!owner && !unownedKind) { out.unmatched.push(account); diffs.accountWithoutClient += cents; continue; }
    if (cents < 0) { out.credits.push({ accountNumber: account, clientUserId: owner, cents }); diffs.credits += cents; continue; }
    if (owner) loadedOpen += cents; else diffs.unownedOpening += cents;
    if (existingOpeningKeys.has(`${OPENING_BALANCE_PREFIX}${account}`)) { out.alreadyOpened += 1; continue; }
    out.openings.push({ accountNumber: account, clientUserId: owner, cents });
    if (!owner) out.unowned.set(account, unownedKind);
  }
  for (const a of leftOpenAccounts) if (!seenLeftOpen.has(a)) out.leftOpen.push(a); // bad-balance rows have no parsed row
  return { ...out, unsettledHistory, reconciliation: reconcile(exportRows, loadedOpen, diffs) };
}

export function mapOpeningInvoice({ opening, invoiceNumber, cutoverAt }) {
  assertCents(opening.cents, "opening balance cents");
  const id = createId();
  const invoice = {
    id, invoiceNumber, kind: "legacy", clientUserId: opening.clientUserId ?? null, labOrderId: null,
    legacySeazonaInvoiceId: `${OPENING_BALANCE_PREFIX}${normAccount(opening.accountNumber)}`, legacyPatient: null,
    status: "issued", version: 1, issuedAt: cutoverAt, dueDate: isoDateIn(LAB_TIMEZONE, cutoverAt), voidedAt: null, voidReason: null,
    subtotalCents: opening.cents, taxCents: 0, shippingCents: 0, totalCents: opening.cents, notes: null,
  };
  const lines = [{
    id: createId(), invoiceId: id, position: 0, kind: "item", variantId: null, code: null,
    description: OPENING_LINE_DESCRIPTION, legacyDescription: null, qty: 1, unitCents: opening.cents, lineCents: opening.cents,
    taxable: false, priceSource: "legacy", priceNote: null, labOrderLineId: null, shipmentId: null,
  }];
  return { invoice, lines };
}
