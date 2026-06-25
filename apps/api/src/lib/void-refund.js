import {
  getTransactionDetails,
  voidTransaction,
  refundTransaction,
} from "../services/authorizenet.service.js";

/**
 * Authorize.net handles "give the money back" two different ways depending on
 * settlement state:
 *   • Not yet settled  → VOID the transaction (always full; no partial void).
 *   • Settled          → REFUND (credit) the transaction, optionally partial.
 *   • Anything else (declined, already voided, already refunded, …) is not
 *     reversible and is rejected.
 *
 * This helper encapsulates that decision so the route stays thin and the
 * status→action mapping is unit-testable in isolation.
 */

// Pre-settlement states → void.
const UNSETTLED = new Set(["authorizedPendingCapture", "capturedPendingSettlement"]);
// Post-settlement state we can refund.
const SETTLED = new Set(["settledSuccessfully"]);

/** Tagged error so the route can map to the right HTTP status. */
function refundError(kind, message) {
  const e = new Error(message);
  e.refundErrorKind = kind; // "not_found" | "validation"
  return e;
}

/**
 * Void or refund a transaction by id.
 * @param {string|number} transId — the ORIGINAL Authorize.net transaction id.
 * @param {number} [amount] — optional partial refund amount; ignored for voids
 *   (a void is always the full transaction). Defaults to the captured amount.
 * @returns {Promise<{ action: "void"|"refund", transactionId: string, amount: number }>}
 * @throws tagged error (`refundErrorKind`): "not_found" | "validation"; or an
 *   Authorize.net gateway error carrying `authNetResponse`.
 */
export async function voidOrRefund(transId, amount) {
  const details = await getTransactionDetails(transId);
  if (!details) {
    throw refundError("not_found", "Transaction not found at the payment gateway.");
  }

  const status = String(details.transactionStatus || "");

  if (UNSETTLED.has(status)) {
    // Void is always full — `amount` is intentionally not honored here.
    const r = await voidTransaction(transId);
    return { action: "void", transactionId: r.transactionId, amount: details.amount };
  }

  if (SETTLED.has(status)) {
    const refundAmount = amount != null ? Number(amount) : details.amount;
    const r = await refundTransaction({
      transId,
      amount: refundAmount,
      cardLast4: details.cardLast4,
      expirationDate: details.expirationDate,
    });
    return { action: "refund", transactionId: r.transactionId, amount: refundAmount };
  }

  throw refundError(
    "validation",
    `Transaction is not in a refundable/voidable state (status: ${status || "unknown"}).`
  );
}
