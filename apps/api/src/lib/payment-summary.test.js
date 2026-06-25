import { describe, it, expect } from "vitest";
import { summarizePayments } from "./payment-summary.js";

// Helper to build an invoice_payments-shaped row.
function row(over = {}) {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    userId: "u1",
    seazonaClientId: "c1",
    seazonaInvoiceId: over.seazonaInvoiceId || "inv-1",
    invoiceNumber: over.invoiceNumber ?? "1001",
    appliedAmount: over.appliedAmount ?? "100.00",
    transactionId: over.transactionId ?? "TXN1",
    refundsTransactionId: over.refundsTransactionId ?? null,
    seazonaPaymentId: null,
    createdAt: over.createdAt || new Date("2026-06-20T00:00:00Z"),
    ...over,
  };
}

describe("summarizePayments", () => {
  it("returns empty for no rows", () => {
    expect(summarizePayments([])).toEqual([]);
    expect(summarizePayments(undefined)).toEqual([]);
  });

  it("summarizes a single multi-invoice charge as one paid payment", () => {
    const out = summarizePayments([
      row({ transactionId: "TXN1", invoiceNumber: "1001", seazonaInvoiceId: "a", appliedAmount: "60.00" }),
      row({ transactionId: "TXN1", invoiceNumber: "1002", seazonaInvoiceId: "b", appliedAmount: "40.00" }),
    ]);
    expect(out).toHaveLength(1);
    const p = out[0];
    expect(p.transactionId).toBe("TXN1");
    expect(p.gross).toBe(100);
    expect(p.refunded).toBe(0);
    expect(p.net).toBe(100);
    expect(p.status).toBe("paid");
    expect(p.refundable).toBe(true);
    expect(p.invoices).toHaveLength(2);
  });

  it("marks a fully-reversed charge as refunded and not refundable", () => {
    const out = summarizePayments([
      row({ transactionId: "TXN1", appliedAmount: "100.00" }),
      // reversal: own gateway txn id, links back via refundsTransactionId, negative amount
      row({ transactionId: "REF1", refundsTransactionId: "TXN1", appliedAmount: "-100.00" }),
    ]);
    expect(out).toHaveLength(1);
    const p = out[0];
    expect(p.gross).toBe(100);
    expect(p.refunded).toBe(100);
    expect(p.net).toBe(0);
    expect(p.status).toBe("refunded");
    expect(p.refundable).toBe(false);
    expect(p.refundTransactionId).toBe("REF1");
  });

  it("marks a partially-reversed charge as partially_refunded", () => {
    const out = summarizePayments([
      row({ transactionId: "TXN1", appliedAmount: "100.00" }),
      row({ transactionId: "REF1", refundsTransactionId: "TXN1", appliedAmount: "-40.00" }),
    ]);
    const p = out[0];
    expect(p.refunded).toBe(40);
    expect(p.net).toBe(60);
    expect(p.status).toBe("partially_refunded");
    expect(p.refundable).toBe(false);
  });

  it("treats a write-ahead guard row (REFUND-PENDING) as refund_pending, not refundable", () => {
    const out = summarizePayments([
      row({ transactionId: "TXN1", appliedAmount: "100.00" }),
      // guard: zero amount, REFUND-PENDING transactionId, links back to TXN1
      row({ transactionId: "REFUND-PENDING-TXN1", refundsTransactionId: "TXN1", appliedAmount: "0.00" }),
    ]);
    const p = out[0];
    expect(p.gross).toBe(100);
    expect(p.refunded).toBe(0);
    expect(p.net).toBe(100);
    expect(p.status).toBe("refund_pending");
    expect(p.refundable).toBe(false); // a guard row blocks re-refund
  });

  it("keeps separate transactions separate and sorts newest-first", () => {
    const out = summarizePayments([
      row({ transactionId: "OLD", appliedAmount: "10.00", createdAt: new Date("2026-06-01T00:00:00Z") }),
      row({ transactionId: "NEW", appliedAmount: "20.00", createdAt: new Date("2026-06-10T00:00:00Z") }),
    ]);
    expect(out.map((p) => p.transactionId)).toEqual(["NEW", "OLD"]);
  });
});
