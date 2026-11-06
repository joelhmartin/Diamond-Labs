import { eq, inArray } from "drizzle-orm";
import { db } from "../config/database.js";
import { accounts, invoices, invoicePayments } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { formatCents } from "../lib/money.js";
import { sendPaymentReceipt } from "./email.service.js";
import * as auditService from "./audit.service.js";
import { paidCentsByInvoice } from "./billing/ledger.service.js";
import { deriveBalance } from "./billing/invoice-rules.js";
import { canActForAccount } from "./client-scope-rules.js";

/**
 * After money moved (a captured card charge) or was received (a manual
 * payment staff record): write one invoice_payments row per allocated
 * invoice, send the receipt, and audit. Our ledger is the system of record;
 * nothing is written to the legacy lab system (own-the-lab piece 3).
 *
 * `user` is the PAYER: whose card was charged (or, for a manual payment, the
 * client staff recorded it for). Every ledger row carries their id, and the
 * receipt goes to them alone, never to the practices' other members.
 *
 * Allocations: [{ invoiceId, invoiceNumber, accountNumber?, amountCents }]
 * against local invoices (verifyAllocations fills in the numbers). `source`: doctor_card | doctor_hosted | admin_card | autopay |
 * admin_check | admin_cash | admin_ach | admin_other. `paidOn` / `reference`
 * are set by manual payments only. `wasCharged` false = no card was charged
 * (receipt copy says "recorded").
 *
 * Non-integer cents (amountCents or any allocation's) insert nothing and are
 * reported the same way as a failed insert.
 *
 * Returns { ledgerWriteFailed }. NEVER throws: after a card charge the money is
 * captured, so a ledger failure is logged loudly ([PAYMENT][LEDGER_WRITE_FAILED],
 * ids and amounts only) rather than 500ing a request a retry would re-charge.
 */
export async function recordPaymentAndAllocations({
  user,
  amountCents,
  transactionId,
  allocations,
  source = null,
  wasCharged = true,
  auditAction = "payment.charge",
  actorUserId = null,
  paidOn = null,
  reference = null,
}) {
  let ledgerWriteFailed = false;
  try {
    // Fail closed: a dollar-shaped caller (or a missing amount) would write
    // NULL-cents rows that the ledger silently ignores. Insert nothing and take
    // the loud reconcile path instead.
    if (!Number.isSafeInteger(amountCents) || !allocations.every((a) => Number.isSafeInteger(a.amountCents))) {
      throw new Error("amountCents and every allocation amountCents must be integer cents");
    }
    await db.insert(invoicePayments).values(
      allocations.map((a) => ({
        id: createId(),
        userId: user.id,
        invoiceId: String(a.invoiceId),
        invoiceNumber: a.invoiceNumber != null ? String(a.invoiceNumber) : null,
        appliedCents: a.amountCents,
        transactionId,
        source,
        paidOn,
        reference,
      }))
    );
  } catch (ledgerErr) {
    ledgerWriteFailed = true;
    console.error(
      `[PAYMENT][LEDGER_WRITE_FAILED] payment ${transactionId} was ${wasCharged ? "charged" : "received"} but the invoice ledger insert failed — manual reconcile required ` +
        JSON.stringify({
          transactionId,
          userId: user.id,
          amountCents,
          invoices: allocations.map((a) => ({ invoiceId: a.invoiceId, amountCents: a.amountCents })),
          error: String(ledgerErr?.message || ledgerErr).slice(0, 300),
        })
    );
  }

  // Receipt (soft-fail). A manual record that failed to save recorded nothing,
  // so it gets no receipt; a captured card charge always does.
  if (user.email && !(ledgerWriteFailed && !wasCharged)) {
    try {
      await sendPaymentReceipt({
        to: user.email,
        amountCents,
        // Invoice and account numbers only: no names, no patient (a group admin's receipt spans practices).
        invoices: allocations.map((a) => ({ number: a.invoiceNumber || a.invoiceId, accountNumber: a.accountNumber ?? null, amountCents: a.amountCents })),
        transactionId,
        date: new Date(),
        wasCharged,
      });
    } catch {
      /* deliver() never throws; belt-and-suspenders */
    }
  }

  await auditService.logSafe({
    userId: actorUserId || user.id,
    action: auditAction,
    targetType: "transaction",
    targetId: transactionId,
    metadata: {
      amountCents,
      source,
      invoices: allocations.map((a) => a.invoiceNumber || a.invoiceId),
      ledgerWriteFailed,
    },
  });

  return { ledgerWriteFailed };
}

/**
 * Check a payment's allocations against our invoices and the payer's practice
 * scope (services/client-scope.js): each invoice exists, belongs to a practice
 * the scope may PAY (canActForAccount with pay: a "viewer" practice is
 * readable, not payable; a null-account invoice is nobody's), is issued,
 * appears once, and (with `enforceCap`) is not paid past its balance after
 * payments, credits and refunds. One bad allocation refuses the whole payment,
 * before any card call. Backfills `invoiceNumber` and `accountNumber` (for the
 * receipt). Returns null when all good, else
 * { kind: "not_found" | "validation", message } (→ 404 / 422; not payable and
 * not found read the same, so invoice ids can't be probed).
 *
 * `scope` is the payer's: request.user.scope for a client, the TARGET user's
 * (loadClientScope) for staff charging as the client, the enrollee's loaded at
 * run time for AutoPay.
 *
 * Concurrency: every caller holds withInvoiceLocks (lib/payment-helpers.js)
 * across verify-with-cap → charge → record. A DB row lock can't do that job:
 * the card charge happens between the check and the write, outside any
 * transaction.
 */
export async function verifyAllocations(allocations, scope, { enforceCap = false, database = db } = {}) {
  const ids = allocations.map((a) => String(a.invoiceId));
  if (new Set(ids).size !== ids.length) {
    return { kind: "validation", message: "Each invoice can appear only once in a payment." };
  }
  const rows = ids.length
    ? await database
        .select({
          id: invoices.id, invoiceNumber: invoices.invoiceNumber, accountId: invoices.accountId, accountNumber: accounts.accountNumber,
          status: invoices.status, totalCents: invoices.totalCents,
        })
        .from(invoices)
        .leftJoin(accounts, eq(accounts.id, invoices.accountId))
        .where(inArray(invoices.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Ownership first, for every allocation: a mixed payment is refused as a whole.
  for (const a of allocations) {
    const inv = byId.get(String(a.invoiceId));
    // Not found and not payable read the same, so invoice ids can't be probed.
    if (!inv || !canActForAccount(scope, inv.accountId, { pay: true })) {
      return { kind: "not_found", message: `Invoice ${a.invoiceNumber || a.invoiceId} is not on this account.` };
    }
  }
  const paid = enforceCap ? await paidCentsByInvoice(ids, database) : null;
  for (const a of allocations) {
    const inv = byId.get(String(a.invoiceId));
    a.invoiceNumber = String(inv.invoiceNumber);
    a.accountNumber = inv.accountNumber ?? null;
    if (inv.status !== "issued") {
      return {
        kind: "validation",
        message: `Invoice #${inv.invoiceNumber} ${inv.status === "void" ? "is void" : "hasn't been issued yet"} and can't be paid.`,
      };
    }
    if (enforceCap) {
      // The cap stays per invoice id, so a second login of the practice can't re-pay.
      const { balanceCents } = deriveBalance(inv, paid.get(inv.id) ?? 0);
      if (a.amountCents > balanceCents) {
        return {
          kind: "validation",
          message: `${formatCents(a.amountCents)} for invoice #${inv.invoiceNumber} exceeds its balance of ${formatCents(Math.max(0, balanceCents))}.`,
        };
      }
    }
  }
  return null;
}
