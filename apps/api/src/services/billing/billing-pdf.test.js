import { test } from "vitest";
import assert from "node:assert/strict";
import { renderInvoicePdf, renderStatementPdf, renderCombinedStatementPdf } from "./billing-pdf.js";
import { buildInvoiceModel } from "./invoice-model.js";
import { buildStatementModel, buildCombinedStatementModel } from "./statement-model.js";

const isPdf = (buf) => Buffer.isBuffer(buf) && buf.subarray(0, 5).toString("latin1") === "%PDF-" && buf.length > 1000;

test("an invoice renders to a PDF", async () => {
  const model = buildInvoiceModel(
    { invoiceNumber: 500001, status: "issued", issuedAt: new Date(), dueDate: "2026-11-14", subtotalCents: 100, taxCents: 0, shippingCents: 0, totalCents: 100, paidCents: 0, balanceCents: 100 },
    [{ qty: 1, code: "1", description: "Item", kind: "item", unitCents: 100, lineCents: 100 }],
    { name: "Dr A", practice: "A Dental" },
    { orderNumber: 1, caseNumber: "RX-1", patientName: "Jane Doe" },
    { generatedAt: new Date() },
  );
  assert.ok(isPdf(await renderInvoicePdf(model)));
});

test("a statement renders to a PDF, with or without activity", async () => {
  const empty = buildStatementModel({ name: "Dr A" }, { invoices: [], payments: [] }, { month: "2026-10" }, { generatedAt: new Date("2026-11-01T15:00:00Z") });
  assert.ok(isPdf(await renderStatementPdf(empty)));
});

test("a combined statement renders to a PDF with a section per practice", async () => {
  const generatedAt = new Date("2026-11-01T15:00:00Z");
  const a = buildStatementModel({ practice: "A Dental", accountNumber: "1" }, { invoices: [], payments: [] }, { month: "2026-10" }, { generatedAt });
  const b = buildStatementModel({ practice: "B Dental", accountNumber: "2" }, {
    invoices: [{ id: "i", invoiceNumber: 1, status: "issued", totalCents: 100, issuedAt: new Date("2026-10-02T15:00:00Z"), dueDate: "2026-11-01" }], payments: [],
  }, { month: "2026-10" }, { generatedAt });
  const model = buildCombinedStatementModel({ id: "g", name: "Group" }, [a, b], { month: "2026-10", generatedAt });
  assert.ok(isPdf(await renderCombinedStatementPdf(model)));
});
