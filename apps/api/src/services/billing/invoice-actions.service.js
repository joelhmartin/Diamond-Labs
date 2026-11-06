import { eq } from "drizzle-orm";
import { isStaffRole, isoDateIn, LAB_TIMEZONE, CREDIT_SOURCE, manualPaymentSource } from "@my-app/shared";
import { db } from "../../config/database.js";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { PRICING } from "../../config/pricing.js";
import { invoices, invoicePayments, users } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { withInvoiceLocks, InvoiceLockedError } from "../../lib/payment-helpers.js";
import { paidCentsByInvoice, openInvoicesForAccounts } from "./ledger.service.js";
import { administersAPractice, loadClientScope, payableAccountIds } from "../client-scope.js";
import { auditInvoice, loadLines, applyLinePlan, commitPatch } from "./invoices.service.js";
import { openInvoice, sealLedgerRow } from "./invoice-crypto.js";
import {
  InvoiceError, assertFreshInvoice, planLineEdit, planDiscountLine, planIssue, planVoid, planCredit, planManualPayment, deriveBalance,
} from "./invoice-rules.js";
import { requireReason } from "./adjustment-reasons.service.js";
import { verifyAllocations, recordPaymentAndAllocations } from "../payment-recording.service.js";

/**
 * Staff billing actions (Admin > Invoices). Each runs in its own transaction
 * with the invoice row locked (FOR UPDATE) and, where the client sent one, a
 * version check (409 "This invoice changed — reload"). Anything that changes
 * what an invoice owes (void, credit, manual payment) ALSO holds the
 * per-invoice lock every card payment takes (withInvoiceLocks), so a doctor
 * paying and staff voiding can never interleave. Every action is audited
 * (ids and amounts only; reasons live encrypted on the rows).
 */

export async function lockInvoice(tx, id) {
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update");
  if (!row) throw new InvoiceError("NOT_FOUND", "Invoice not found.");
  return openInvoice(row);
}

/** Run fn holding the card-payment lock on each invoice; a held lock is a 409 LOCKED. */
export async function underInvoiceLocks(invoiceIds, fn) {
  try {
    return await withInvoiceLocks(redis, invoiceIds, fn);
  } catch (err) {
    if (err instanceof InvoiceLockedError) {
      throw new InvoiceError("LOCKED", "A payment on this invoice is in progress — try again in a moment.");
    }
    throw err;
  }
}

/**
 * A discount edit → its plan. The reason (if any) must be an active discount reason; its label
 * names the line and its default percent applies when the request gives neither percent nor amount.
 */
async function discountPlan(tx, invoice, lines, edit, opts) {
  const reason = edit.reasonId ? await requireReason(edit.reasonId, "discount", tx) : null;
  const noSize = edit.percent == null && edit.amountCents == null;
  return planDiscountLine(invoice, lines, {
    label: reason?.label, text: edit.text, amountCents: edit.amountCents,
    percent: edit.percent ?? (noSize ? reason?.discountPercent ?? undefined : undefined),
  }, opts);
}

/** One draft edit: qty, an overridden price (with a reason), a free-form line, a removal, or notes. */
export function editDraft(id, { edit, expectedVersion, byUserId }, database = db) {
  return database.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    assertFreshInvoice(invoice, expectedVersion);
    const opts = { now: new Date(), taxRateBps: PRICING.taxRateBps };
    const lines = await loadLines(tx, id);
    const plan = edit.op === "discount"
      ? await discountPlan(tx, invoice, lines, edit, opts)
      : planLineEdit(invoice, lines, edit, opts);
    return applyLinePlan(tx, invoice, plan, byUserId);
  });
}

/** Issue a priced draft by hand (e.g. after pricing a held one): due today + terms, lab-local. */
export function issueInvoice(id, { expectedVersion, byUserId }, database = db) {
  return database.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    assertFreshInvoice(invoice, expectedVersion);
    const now = new Date();
    const { patch } = planIssue(invoice, await loadLines(tx, id), {
      now, termsDays: env.INVOICE_TERMS_DAYS, issueDateIso: isoDateIn(LAB_TIMEZONE, now),
    });
    const updated = await commitPatch(tx, invoice, patch);
    await auditInvoice(tx, "invoice.issued", invoice, byUserId, { via: "staff", totalCents: invoice.totalCents, dueDate: patch.dueDate });
    return updated;
  });
}

/** Void with a reason; an issued invoice only while nothing is applied to it. It keeps its number. */
export function voidInvoice(id, { reason, expectedVersion, byUserId }, database = db) {
  return underInvoiceLocks([id], () =>
    database.transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      assertFreshInvoice(invoice, expectedVersion);
      const paidCents = (await paidCentsByInvoice([id], tx)).get(id) ?? 0;
      const { patch } = planVoid(invoice, { paidCents, reason, now: new Date() });
      const updated = await commitPatch(tx, invoice, patch);
      await auditInvoice(tx, "invoice.voided", invoice, byUserId, { via: "staff", wasStatus: invoice.status });
      return updated;
    })
  );
}

/**
 * A credit / write-off on an issued invoice: a ledger row allocated like a
 * payment (source "credit", transactionId "credit:<rowId>"), never sent to a
 * card processor. The reason is stored encrypted on the row.
 */
export function recordCredit(id, { amountCents, reason, byUserId }, database = db) {
  return underInvoiceLocks([id], () =>
    database.transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      const paidCents = (await paidCentsByInvoice([id], tx)).get(id) ?? 0;
      const { balanceCents } = deriveBalance(invoice, paidCents);
      const { reason: why } = planCredit(invoice, { amountCents, reason, balanceCents });
      const rowId = createId();
      await tx.insert(invoicePayments).values(sealLedgerRow({
        id: rowId,
        userId: invoice.clientUserId ?? null,
        invoiceId: invoice.id,
        invoiceNumber: String(invoice.invoiceNumber),
        appliedCents: amountCents,
        transactionId: `credit:${rowId}`,
        source: CREDIT_SOURCE,
        paidOn: isoDateIn(LAB_TIMEZONE, new Date()),
        note: why,
      }));
      await auditInvoice(tx, "invoice.credited", invoice, byUserId, { amountCents });
      return { id: rowId, balanceCents: balanceCents - amountCents };
    })
  );
}

/**
 * The client staff record a payment or account credit for: a doctor, or a
 * non-staff login that runs a practice (an active owner/admin member, or an active
 * group admin: client-scope administersAPractice, read from the TARGET's own
 * scope). Anyone else (a shopper, a plain member, any staff role, even with a membership) is NOT_FOUND.
 */
export async function loadPayingClient(clientUserId, database) {
  const [client] = await database
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, clientUserId));
  if (!client) throw new InvoiceError("NOT_FOUND", "Client not found.");
  if (client.role === "doctor") return client;
  if (isStaffRole(client.role)) throw new InvoiceError("NOT_FOUND", "Client not found.");
  if (!administersAPractice(await loadClientScope(client.id, database))) throw new InvoiceError("NOT_FOUND", "Client not found.");
  return client;
}

/**
 * Staff acting as the client (Record payment, an account credit): the client's
 * OWN practice scope, loaded for this request (never the staff member's), and
 * the open invoices of the practices it may pay, oldest due first. The ONE
 * list Record payment's picker (GET /admin/clients/:userId/invoices?open=true),
 * recordManualPayment's default allocation and the account credit read, so
 * staff see exactly what the server plans against.
 */
export async function payableOpenInvoices(client, database = db) {
  const scope = await loadClientScope(client.id, database);
  return { scope, openInvoices: await openInvoicesForAccounts(payableAccountIds(scope), database) };
}

export async function openInvoicesForClientUser(clientUserId, database = db) {
  return (await payableOpenInvoices(await loadPayingClient(clientUserId, database), database)).openInvoices;
}

/**
 * Record a check / cash / ACH / other payment staff received for a client:
 * oldest-first or to the invoices they chose, never more than is owed.
 * Re-verified inside the lock (a card payment may have landed since the read),
 * then written through recordPaymentAndAllocations like every card payment:
 * ledger rows, a "recorded, not charged" receipt, an audit entry.
 */
export async function recordManualPayment(
  { clientUserId, method, reference = null, amountCents, paidOn, allocations, byUserId },
  database = db,
) {
  const client = await loadPayingClient(clientUserId, database);
  // What the client could pay online themselves: their payable practices.
  const { scope, openInvoices } = await payableOpenInvoices(client, database);
  const planned = planManualPayment({ openInvoices, amountCents, allocations, paidOn, todayIso: isoDateIn(LAB_TIMEZONE, new Date()) });

  return underInvoiceLocks(planned.map((a) => a.invoiceId), async () => {
    const capErr = await verifyAllocations(planned, scope, { enforceCap: true, database });
    if (capErr) throw new InvoiceError(capErr.kind === "validation" ? "OVERPAY" : "INVALID", capErr.message);
    const transactionId = `OFFLINE-${createId()}`;
    const { ledgerWriteFailed } = await recordPaymentAndAllocations({
      user: client,
      amountCents,
      transactionId,
      allocations: planned,
      source: manualPaymentSource(method),
      wasCharged: false,
      auditAction: "payment.manual_recorded",
      actorUserId: byUserId,
      paidOn,
      reference: reference?.trim() || null,
    });
    // No money moved through us, so failing loudly is safe: nothing was recorded.
    if (ledgerWriteFailed) throw new Error("manual payment: ledger write failed — nothing was recorded");
    return { transactionId, allocations: planned };
  });
}
