import { isoDateIn, LAB_TIMEZONE, CREDIT_SOURCE } from "@my-app/shared";
import { db } from "../../config/database.js";
import { invoicePayments } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { formatCents } from "../../lib/money.js";
import { paidCentsByInvoice, openInvoicesForClient } from "./ledger.service.js";
import { auditInvoice } from "./invoices.service.js";
import { sealLedgerRow } from "./invoice-crypto.js";
import { InvoiceError, planAccountCredit, deriveBalance } from "./invoice-rules.js";
import { loadPayingClient, lockInvoice, underInvoiceLocks } from "./invoice-actions.service.js";

/**
 * An account-level credit: one amount spread over the practice's open invoices
 * (oldest due first, or the invoices staff chose) as `credit` ledger rows that
 * share one "credit:<groupId>" transaction id. Same row shape as a per-invoice
 * credit (recordCredit): never sent to a card processor, reason sealed on the
 * row, audits carry ids and cents only. Sends no email.
 *
 * The plan is made from a read, then re-verified under the per-invoice locks
 * and row locks (a card payment may have landed since), so a credit can never
 * take an invoice below zero.
 */
export async function recordAccountCredit({ clientUserId, amountCents, reason, allocations, byUserId }, database = db) {
  const client = await loadPayingClient(clientUserId, database);
  const openInvoices = await openInvoicesForClient(client, database);
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
