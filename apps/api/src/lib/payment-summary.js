/**
 * Pure payment-ledger aggregation (no DB, no env, no I/O), so the fiddly
 * grouping and status logic is unit-tested in isolation. The ledger service
 * (services/billing/ledger.service.js) fetches rows and delegates here.
 * Money is integer cents.
 */

export const REFUND_PENDING_PREFIX = "REFUND-PENDING-";
// A manual payment (staff record a check, cash, ACH) has no Authorize.net
// transaction behind it: its transactionId is an `OFFLINE-<id>` sentinel.
export const OFFLINE_PREFIX = "OFFLINE-";
// A staff credit / write-off: `credit:<rowId>`. Never sent to a card processor.
export const CREDIT_PREFIX = "credit:";

/** The invoice a ledger row applies to: the local invoice, or (Seazona-era rows) the Seazona invoice id. */
export const ledgerInvoiceKey = (r) => r.invoiceId ?? r.seazonaInvoiceId ?? null;

/**
 * Collapse invoice_payments rows into one summary per ORIGINAL transaction.
 * Charge rows have no refundsTransactionId; reversal rows carry
 * refundsTransactionId = the charge's id and a NEGATIVE appliedCents. The
 * refund write-ahead guard is a reversal with 0 cents and a REFUND-PENDING id.
 * @returns {Array<object>} newest first
 */
export function summarizePayments(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const isReversal = r.refundsTransactionId != null;
    const chargeTxn = isReversal ? r.refundsTransactionId : r.transactionId;
    if (!groups.has(chargeTxn)) groups.set(chargeTxn, { chargeTxn, charge: [], reversals: [] });
    const g = groups.get(chargeTxn);
    (isReversal ? g.reversals : g.charge).push(r);
  }

  const summaries = [];
  for (const { chargeTxn, charge, reversals } of groups.values()) {
    const grossCents = charge.reduce((s, r) => s + r.appliedCents, 0);
    const refundedCents = reversals.reduce((s, r) => s - r.appliedCents, 0); // not -(sum): that is -0 with no reversals
    const netCents = grossCents - refundedCents;
    const realReversals = reversals.filter((r) => !String(r.transactionId).startsWith(REFUND_PENDING_PREFIX));
    const hasPendingGuard = reversals.some((r) => String(r.transactionId).startsWith(REFUND_PENDING_PREFIX));

    let status;
    if (hasPendingGuard && !realReversals.length) status = "refund_pending";
    else if (realReversals.length && netCents <= 0) status = "refunded";
    else if (realReversals.length) status = "partially_refunded";
    else status = "paid";

    const offline = String(chargeTxn).startsWith(OFFLINE_PREFIX);
    const credit = String(chargeTxn).startsWith(CREDIT_PREFIX);
    // Refundable only with a real gateway transaction, no reversal or guard row
    // yet (the refund route's double-refund guard), and money to give back.
    const refundable = !offline && !credit && reversals.length === 0 && grossCents > 0;

    const sourceRows = charge.length ? charge : reversals;
    const createdAt = sourceRows.reduce((min, r) => (r.createdAt && (!min || r.createdAt < min) ? r.createdAt : min), null);

    summaries.push({
      transactionId: chargeTxn,
      userId: sourceRows[0]?.userId || null,
      // doctor_card | doctor_hosted | admin_card | autopay | admin_check |
      // admin_cash | admin_ach | admin_other | credit (admin_offline on
      // Seazona-era rows; null before the column existed).
      source: sourceRows[0]?.source || null,
      grossCents,
      refundedCents,
      netCents,
      status,
      refundable,
      offline,
      credit,
      createdAt,
      refundTransactionId: realReversals[0]?.transactionId || null,
      invoices: charge.map((r) => ({ invoiceId: ledgerInvoiceKey(r), invoiceNumber: r.invoiceNumber || null, amountCents: r.appliedCents })),
    });
  }

  summaries.sort((a, b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0));
  return summaries;
}
