/**
 * Pure payment-ledger aggregation — no DB, no env, no I/O — so the (fiddly)
 * grouping/status logic is unit-testable in isolation. The DB-bound readers in
 * `services/invoice-ledger.service.js` fetch rows and delegate the shaping here.
 */

/** Round to cents consistently (avoids FP drift like 0.1 + 0.2). */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export const REFUND_PENDING_PREFIX = "REFUND-PENDING-";

/**
 * Collapse raw `invoice_payments` rows into transaction-level payment summaries.
 *
 * A "payment" is keyed by the ORIGINAL charge's transaction id:
 *   • charge rows have `refundsTransactionId == null` and their own transactionId;
 *   • reversal rows carry `refundsTransactionId == <original charge txn id>` and a
 *     NEGATIVE appliedAmount. The refund write-ahead guard row is a special
 *     reversal with appliedAmount 0 and a `REFUND-PENDING-<txid>` transactionId.
 *
 * @param {Array<object>} rows — invoice_payments rows
 * @returns {Array<object>} summaries, newest charge first
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
    const gross = round2(charge.reduce((s, r) => s + Number(r.appliedAmount), 0));
    // Reversal applied amounts are <= 0; `refunded` is the positive magnitude.
    const refunded = round2(-reversals.reduce((s, r) => s + Number(r.appliedAmount), 0));
    const net = round2(gross - refunded);

    const realReversals = reversals.filter(
      (r) => !String(r.transactionId).startsWith(REFUND_PENDING_PREFIX)
    );
    const hasPendingGuard = reversals.some((r) =>
      String(r.transactionId).startsWith(REFUND_PENDING_PREFIX)
    );

    let status;
    if (hasPendingGuard && !realReversals.length) status = "refund_pending";
    else if (realReversals.length && net <= 0.005) status = "refunded";
    else if (realReversals.length) status = "partially_refunded";
    else status = "paid";

    // Refundable only when NO reversal/guard row exists — the refund route's
    // double-refund guard rejects any charge that already has a refunds row.
    const refundable = reversals.length === 0 && gross > 0.005;

    const sourceRows = charge.length ? charge : reversals;
    const createdAt = sourceRows.reduce(
      (min, r) => (r.createdAt && (!min || r.createdAt < min) ? r.createdAt : min),
      null
    );

    summaries.push({
      transactionId: chargeTxn,
      userId: sourceRows[0]?.userId || null,
      seazonaClientId: sourceRows[0]?.seazonaClientId || null,
      gross,
      refunded,
      net,
      status,
      refundable,
      createdAt,
      refundTransactionId: realReversals[0]?.transactionId || null,
      invoices: charge.map((r) => ({
        invoiceNumber: r.invoiceNumber || null,
        seazonaInvoiceId: r.seazonaInvoiceId,
        amount: round2(Number(r.appliedAmount)),
      })),
    });
  }

  summaries.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  return summaries;
}
