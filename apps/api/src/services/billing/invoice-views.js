import { LEGACY_SETTLEMENT_SOURCE } from "@my-app/shared";

/**
 * Response shapes for invoice reads. The doctor's are explicit allow-lists
 * (the doctorCaseView pattern), so a staff column added later never reaches a
 * doctor by default: staff notes, price notes and sources, the void reason,
 * ledger references, credit reasons and transaction ids stay staff-only. Zero-cent
 * ledger rows are bookkeeping and shown to no one.
 */

/** What a ledger row is, to a person reading the invoice. */
export function ledgerEntryKind(row) {
  if (row.source === LEGACY_SETTLEMENT_SOURCE) return "settlement";
  if (row.source === "credit") return "credit";
  return row.appliedCents < 0 ? "refund" : "payment";
}

const visible = (payments) => payments.filter((p) => p.appliedCents !== 0);

export function doctorInvoiceRow(r) {
  return {
    id: r.id, invoiceNumber: r.invoiceNumber, kind: r.kind, status: r.status,
    labOrderNumber: r.labOrderNumber ?? null, patientInitials: r.patientInitials ?? null,
    issuedAt: r.issuedAt ?? null, dueDate: r.dueDate ?? null,
    totalCents: r.totalCents, paidCents: r.paidCents, balanceCents: r.balanceCents,
  };
}

export function doctorInvoiceView({ invoice, lines, payments, labOrder }) {
  return {
    id: invoice.id, invoiceNumber: invoice.invoiceNumber, kind: invoice.kind, status: invoice.status,
    issuedAt: invoice.issuedAt ?? null, dueDate: invoice.dueDate ?? null,
    subtotalCents: invoice.subtotalCents, taxCents: invoice.taxCents, shippingCents: invoice.shippingCents,
    totalCents: invoice.totalCents, paidCents: invoice.paidCents, balanceCents: invoice.balanceCents,
    labOrderNumber: labOrder?.orderNumber ?? null, caseNumber: labOrder?.caseNumber ?? null, patientName: labOrder?.patientName ?? invoice.legacyPatient ?? null,
    lines: lines.map((l) => ({
      id: l.id, kind: l.kind, code: l.code ?? null, description: l.description, qty: l.qty, unitCents: l.unitCents, lineCents: l.lineCents,
    })),
    payments: visible(payments).map((p) => ({ date: p.paidOn ?? p.createdAt, kind: ledgerEntryKind(p), amountCents: p.appliedCents })),
  };
}

/** Staff see the whole invoice; ledger rows are shaped for the detail page. */
export function adminInvoiceView({ invoice, lines, payments, labOrder, client, activity }) {
  return {
    invoice,
    lines,
    payments: visible(payments).map((p) => ({
      id: p.id, date: p.paidOn ?? p.createdAt, kind: ledgerEntryKind(p), source: p.source ?? null,
      amountCents: p.appliedCents, transactionId: p.transactionId, refundsTransactionId: p.refundsTransactionId ?? null,
      reference: p.reference ?? null, note: p.note ?? null,
    })),
    labOrder,
    client,
    activity: activity ?? [],
  };
}
