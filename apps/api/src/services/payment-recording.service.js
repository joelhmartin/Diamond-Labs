import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../config/database.js";
import { invoices, invoicePayments, users } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { formatCents } from "../lib/money.js";
import { sendPaymentReceipt } from "./email.service.js";
import * as auditService from "./audit.service.js";
import { paidCentsByInvoice } from "./billing/ledger.service.js";
import { deriveBalance, canActOnInvoice } from "./billing/invoice-rules.js";

const owner = alias(users, "owner");

/**
 * After money moved (a captured card charge) or was received (a manual
 * payment staff record): write one invoice_payments row per allocated
 * invoice, send the receipt, and audit. Our ledger is the system of record;
 * nothing is written to the legacy lab system (own-the-lab piece 3).
 *
 * Allocations: [{ invoiceId, invoiceNumber, amountCents }] against local
 * invoices. `source`: doctor_card | doctor_hosted | admin_card | autopay |
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
        invoices: allocations.map((a) => ({ number: a.invoiceNumber || a.invoiceId, amountCents: a.amountCents })),
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
 * Check a payment's allocations against our invoices: each one exists, may be
 * paid by this user (canActOnInvoice: the owner, or a login of the same
 * practice), is issued, appears once, and (with
 * `enforceCap`) is not paid past its balance after payments, credits and
 * refunds. Backfills `invoiceNumber`. Returns null when all good, else
 * { kind: "forbidden" | "validation", message } (→ 403 / 422).
 *
 * Concurrency: every caller holds withInvoiceLocks (lib/payment-helpers.js)
 * across verify-with-cap → charge → record. A DB row lock can't do that job:
 * the card charge happens between the check and the write, outside any
 * transaction.
 */
export async function verifyAllocations(allocations, user, { enforceCap = false, database = db } = {}) {
  const ids = allocations.map((a) => String(a.invoiceId));
  if (new Set(ids).size !== ids.length) {
    return { kind: "validation", message: "Each invoice can appear only once in a payment." };
  }
  const rows = ids.length
    ? await database
        .select({
          id: invoices.id, invoiceNumber: invoices.invoiceNumber, clientUserId: invoices.clientUserId,
          ownerSeazonaClientId: owner.seazonaClientId, status: invoices.status, totalCents: invoices.totalCents,
        })
        .from(invoices)
        .leftJoin(owner, eq(owner.id, invoices.clientUserId))
        .where(inArray(invoices.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const paid = enforceCap ? await paidCentsByInvoice(ids, database) : null;
  for (const a of allocations) {
    const inv = byId.get(String(a.invoiceId));
    // Not found and not yours read the same, so invoice ids can't be probed.
    // The cap below stays per invoice id, so a second login can't re-pay.
    if (!inv || !canActOnInvoice(user, inv, inv.ownerSeazonaClientId)) {
      return { kind: "forbidden", message: `Invoice ${a.invoiceNumber || a.invoiceId} is not on this account.` };
    }
    a.invoiceNumber = String(inv.invoiceNumber);
    if (inv.status !== "issued") {
      return {
        kind: "validation",
        message: `Invoice #${inv.invoiceNumber} ${inv.status === "void" ? "is void" : "hasn't been issued yet"} and can't be paid.`,
      };
    }
    if (enforceCap) {
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
