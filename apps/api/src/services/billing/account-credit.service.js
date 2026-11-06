import { and, eq } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE, CREDIT_SOURCE } from "@my-app/shared";
import { db } from "../../config/database.js";
import { accounts, invoicePayments } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { formatCents } from "../../lib/money.js";
import { paidCentsByInvoice, openInvoicesForAccounts, openUnassignedInvoicesForClient } from "./ledger.service.js";
import { auditInvoice } from "./invoices.service.js";
import { sealLedgerRow } from "./invoice-crypto.js";
import { InvoiceError, planAccountCredit, deriveBalance } from "./invoice-rules.js";
import { loadPayingClient, lockInvoice, underInvoiceLocks } from "./invoice-actions.service.js";

/**
 * What an account credit is for, as the receivables page names it (one row):
 *  - `{ accountId }`    one practice (client account): ITS open invoices only,
 *                       never a sibling practice's, whoever owns them;
 *  - `{ clientUserId }` the client's "Unassigned" row: that client's open
 *                       invoices with no practice (account_id null) only.
 * An unknown practice, or a non-client account, or a user who isn't a doctor,
 * is NOT_FOUND. `owns(invoice)` re-checks a locked row against the same target.
 */
async function creditTarget({ accountId = null, clientUserId = null }, database) {
  if (accountId) {
    const [practice] = await database.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.isClient, true)));
    if (!practice) throw new InvoiceError("NOT_FOUND", "Practice not found.");
    return { open: () => openInvoicesForAccounts([accountId], database), owns: (inv) => inv.accountId === accountId };
  }
  const client = await loadPayingClient(clientUserId, database);
  return { open: () => openUnassignedInvoicesForClient(client.id, database), owns: (inv) => inv.accountId == null && inv.clientUserId === client.id };
}

/** The open invoices a credit for this target may be applied to, oldest due first (the modal's picker). */
export async function creditableInvoices(target, database = db) {
  return (await creditTarget(target, database)).open();
}

/**
 * An account-level credit: one amount spread over the target's open invoices
 * (creditTarget: one practice, or one client's unassigned invoices), oldest
 * due first or the invoices staff chose, as `credit` ledger rows that
 * share one "credit:<groupId>" transaction id. Same row shape as a per-invoice
 * credit (recordCredit): never sent to a card processor, reason sealed on the
 * row, audits carry ids and cents only. Sends no email.
 *
 * The plan is made from a read, then re-verified under the per-invoice locks
 * and row locks (a card payment may have landed, or the invoice moved to
 * another practice, since), so a credit can never take an invoice below zero
 * or land outside its target.
 */
export async function recordAccountCredit({ accountId = null, clientUserId = null, amountCents, reason, allocations, byUserId }, database = db) {
  const target = await creditTarget({ accountId, clientUserId }, database);
  const openInvoices = await target.open();
  const todayIso = isoDateIn(LAB_TIMEZONE, new Date());
  const plan = planAccountCredit({ openInvoices, amountCents, allocations, reason, todayIso });

  return underInvoiceLocks(plan.allocations.map((a) => a.invoiceId), () =>
    database.transaction(async (tx) => {
      const locked = [];
      for (const a of plan.allocations) locked.push(await lockInvoice(tx, a.invoiceId));
      const paid = await paidCentsByInvoice(plan.allocations.map((a) => a.invoiceId), tx);
      plan.allocations.forEach((a, i) => {
        const invoice = locked[i];
        const { balanceCents } = deriveBalance(invoice, paid.get(invoice.id) ?? 0);
        if (!target.owns(invoice)) throw new InvoiceError("INVALID", `Invoice #${invoice.invoiceNumber} is no longer on this account.`);
        if (invoice.status !== "issued" || a.amountCents > balanceCents) {
          throw new InvoiceError("OVERPAY", `A credit of ${formatCents(a.amountCents)} is more than the ${formatCents(Math.max(0, balanceCents))} now owed on invoice #${invoice.invoiceNumber}.`);
        }
      });

      const transactionId = `credit:${createId()}`;
      for (const [i, a] of plan.allocations.entries()) {
        const invoice = locked[i];
        await tx.insert(invoicePayments).values(sealLedgerRow({
          id: createId(),
          userId: invoice.clientUserId ?? null,
          invoiceId: invoice.id,
          invoiceNumber: String(invoice.invoiceNumber),
          appliedCents: a.amountCents,
          transactionId,
          source: CREDIT_SOURCE,
          paidOn: todayIso,
          note: plan.reason,
        }));
        await auditInvoice(tx, "invoice.credited", invoice, byUserId, { amountCents: a.amountCents, accountCredit: true });
      }
      return { transactionId, allocations: plan.allocations };
    })
  );
}
