import { describe, it, expect } from "vitest";
import { summarizePayments } from "./payment-summary.js";

function row(over = {}) {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    userId: "u1",
    invoiceId: over.invoiceId ?? "inv-1",
    seazonaInvoiceId: null,
    invoiceNumber: over.invoiceNumber ?? "500001",
    appliedCents: over.appliedCents ?? 10000,
    transactionId: over.transactionId ?? "TXN1",
    refundsTransactionId: over.refundsTransactionId ?? null,
    createdAt: over.createdAt || new Date("2026-10-01T00:00:00Z"),
    ...over,
  };
}

describe("summarizePayments", () => {
  it("returns empty for no rows", () => {
    expect(summarizePayments([])).toEqual([]);
    expect(summarizePayments(undefined)).toEqual([]);
  });

  it("summarizes a multi-invoice charge as one paid payment, in cents", () => {
    const [p] = summarizePayments([
      row({ invoiceId: "a", invoiceNumber: "500001", appliedCents: 6000 }),
      row({ invoiceId: "b", invoiceNumber: "500002", appliedCents: 4000 }),
    ]);
    expect([p.grossCents, p.refundedCents, p.netCents, p.status, p.refundable]).toEqual([10000, 0, 10000, "paid", true]);
    expect(p.invoices).toEqual([
      { invoiceId: "a", invoiceNumber: "500001", amountCents: 6000 },
      { invoiceId: "b", invoiceNumber: "500002", amountCents: 4000 },
    ]);
  });

  it("marks a fully reversed charge refunded and a partly reversed one partially_refunded", () => {
    const [full] = summarizePayments([row(), row({ transactionId: "REF1", refundsTransactionId: "TXN1", appliedCents: -10000 })]);
    expect([full.refundedCents, full.netCents, full.status, full.refundable, full.refundTransactionId]).toEqual([10000, 0, "refunded", false, "REF1"]);
    const [part] = summarizePayments([row(), row({ transactionId: "REF1", refundsTransactionId: "TXN1", appliedCents: -4000 })]);
    expect([part.netCents, part.status]).toEqual([6000, "partially_refunded"]);
  });

  it("treats a write-ahead guard row as refund_pending, not refundable", () => {
    const [p] = summarizePayments([row(), row({ transactionId: "REFUND-PENDING-TXN1", refundsTransactionId: "TXN1", appliedCents: 0 })]);
    expect([p.grossCents, p.status, p.refundable]).toEqual([10000, "refund_pending", false]);
  });

  it("never offers a refund for a manual payment or a credit — no gateway transaction behind either", () => {
    const [manual] = summarizePayments([row({ transactionId: "OFFLINE-abc", source: "admin_check" })]);
    expect([manual.offline, manual.credit, manual.refundable]).toEqual([true, false, false]);
    const [credit] = summarizePayments([row({ transactionId: "credit:xyz", source: "credit", appliedCents: 2500 })]);
    expect([credit.credit, credit.refundable, credit.grossCents]).toEqual([true, false, 2500]);
  });

  it("keys a Seazona-era row by its Seazona invoice id", () => {
    const [p] = summarizePayments([row({ invoiceId: null, seazonaInvoiceId: "sz-9", invoiceNumber: "41201", appliedCents: 2500, source: null })]);
    expect(p.invoices).toEqual([{ invoiceId: "sz-9", invoiceNumber: "41201", amountCents: 2500 }]);
    expect(p.source).toBeNull();
  });

  it("carries source through and sorts newest first", () => {
    const out = summarizePayments([
      row({ transactionId: "OLD", source: "autopay", createdAt: new Date("2026-06-01T00:00:00Z") }),
      row({ transactionId: "NEW", source: "doctor_card", createdAt: new Date("2026-06-10T00:00:00Z") }),
    ]);
    expect(out.map((p) => [p.transactionId, p.source])).toEqual([["NEW", "doctor_card"], ["OLD", "autopay"]]);
  });
});
