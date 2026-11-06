import * as authorizenetService from "./authorizenet.service.js";
import { verifyAllocations, recordPaymentAndAllocations } from "./payment-recording.service.js";
import { toDecimalString } from "../lib/money.js";

/**
 * Charge a payer's saved card for a set of invoice allocations, then record the
 * payment on our ledger. The one implementation behind three callers: the
 * doctor route (POST /payments/charge-saved), the admin charge-on-behalf route
 * and the AutoPay sweep (source "autopay"); each keeps its own auth, idempotency key and invoice locks and calls this INSIDE
 * its withInvoiceLocks, so the balance cap check, the gateway charge and the
 * ledger write all happen under the same locks.
 *
 * `payer` is the login being charged (request.user, or the admin's target);
 * `scope` is the payer's practice scope the in-lock re-check verifies against
 * (request.user.scope, the target's loadClientScope, or AutoPay's run-time
 * load); `source` is doctor_card | admin_card | autopay. Allocations are
 * [{ invoiceId, amountCents }]; verifyAllocations backfills invoiceNumber.
 * Dollars appear only on the gateway wire (toDecimalString).
 *
 * Throws { allocationError } (a verifyAllocations result) before any money
 * moves, or the gateway's error when the charge fails. After a successful
 * charge it never throws (recordPaymentAndAllocations reports a ledger failure
 * instead), so a captured charge is always returned to the caller.
 */
export async function chargeSavedCardAndRecord({ payer, scope, customerProfileId, paymentProfileId, amountCents, allocations, source }) {
  const capErr = await verifyAllocations(allocations, scope, { enforceCap: true });
  if (capErr) throw Object.assign(new Error("allocation_error"), { allocationError: capErr });

  const result = await authorizenetService.chargeCustomerProfile({
    customerProfileId,
    paymentProfileId,
    amount: toDecimalString(amountCents),
    invoiceNumber: allocations[0].invoiceNumber,
  });
  const { ledgerWriteFailed } = await recordPaymentAndAllocations({
    user: payer,
    amountCents,
    transactionId: result.transactionId,
    allocations,
    source,
  });
  return { ...result, amountCents, ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}) };
}
