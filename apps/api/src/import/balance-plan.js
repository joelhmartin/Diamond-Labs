import { isoDateIn, LAB_TIMEZONE, LEGACY_SETTLEMENT_SOURCE, OPENING_BALANCE_PREFIX, isOpeningBalanceInvoice } from "@my-app/shared";
import { createId } from "../lib/id.js";
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

export function planInvoiceSettlements({ legacyInvoices, exportRows, existingTransactionIds, paidByInvoice = new Map() }) {
  const open = new Map(exportRows.map((r) => [r.key, r.cents]));
  const byNumber = new Map(history(legacyInvoices).map((i) => [i.invoiceNumber, i]));
  const out = { rows: [], credits: [], unmatched: [], overTotal: [], openOnVoid: [], hasPayments: [], alreadySettled: 0, openByClient: new Map() };
  for (const [number, cents] of open) {
    const inv = byNumber.get(number);
    if (!inv) out.unmatched.push(number);
    else if (inv.status === "void" && cents !== 0) out.openOnVoid.push(number);
  }
  for (const inv of history(legacyInvoices).filter((i) => i.status === "issued")) {
    const owed = open.get(inv.invoiceNumber) ?? 0;
    if (owed > inv.totalCents) { out.overTotal.push(inv.invoiceNumber); continue; }
    if (owed < 0) out.credits.push({ invoiceNumber: inv.invoiceNumber, clientUserId: inv.clientUserId, cents: owed });
    const remaining = Math.max(owed, 0);
    out.openByClient.set(inv.clientUserId, (out.openByClient.get(inv.clientUserId) ?? 0) + remaining);
    const settle = inv.totalCents - remaining;
    if (settle <= 0) continue;
    if (existingTransactionIds.has(settlementTransactionId(inv, "per-invoice"))) { out.alreadySettled += 1; continue; }
    if ((paidByInvoice.get(inv.id) ?? 0) !== 0) { out.hasPayments.push(inv.invoiceNumber); continue; }
    out.rows.push(settlementRow(inv, settle, "per-invoice"));
  }
  return out;
}

/**
 * `ownerByAccount`: account number → the one eligible owner. `unownedAccounts`:
 * account number → problem kind, for accounts some user carries but none (or
 * several) may own; their opening invoice loads UNOWNED and the invoices
 * step's reattach picks it up once the link is fixed. An account no user
 * carries at all is `unmatched` and writes nothing.
 */
export function planClientOpenings({ legacyInvoices, exportRows, ownerByAccount, unownedAccounts = new Map(), existingTransactionIds, existingOpeningKeys, paidByInvoice = new Map() }) {
  const out = { settlements: [], openings: [], credits: [], unmatched: [], hasPayments: [], unowned: new Map(), alreadySettled: 0, alreadyOpened: 0 };
  for (const inv of history(legacyInvoices).filter((i) => i.status === "issued" && i.totalCents > 0)) {
    if (existingTransactionIds.has(settlementTransactionId(inv, "per-client"))) { out.alreadySettled += 1; continue; }
    if ((paidByInvoice.get(inv.id) ?? 0) !== 0) { out.hasPayments.push(inv.invoiceNumber); continue; }
    out.settlements.push(settlementRow(inv, inv.totalCents, "per-client"));
  }
  for (const { key, cents } of exportRows) {
    if (cents === 0) continue;
    const owner = ownerByAccount.get(key) ?? null;
    const unownedKind = unownedAccounts.get(key);
    if (!owner && !unownedKind) { out.unmatched.push(key); continue; }
    if (cents < 0) { out.credits.push({ accountNumber: key, clientUserId: owner, cents }); continue; }
    if (existingOpeningKeys.has(`${OPENING_BALANCE_PREFIX}${key}`)) { out.alreadyOpened += 1; continue; }
    out.openings.push({ accountNumber: key, clientUserId: owner, cents });
    if (!owner) out.unowned.set(key, unownedKind);
  }
  return out;
}

export function mapOpeningInvoice({ opening, invoiceNumber, cutoverAt }) {
  assertCents(opening.cents, "opening balance cents");
  const id = createId();
  const invoice = {
    id, invoiceNumber, kind: "legacy", clientUserId: opening.clientUserId ?? null, labOrderId: null,
    legacySeazonaInvoiceId: `${OPENING_BALANCE_PREFIX}${opening.accountNumber}`, legacyPatient: null,
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
