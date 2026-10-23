import { test } from "vitest";
import assert from "node:assert/strict";
import { doctorInvoiceView, doctorInvoiceRow, adminInvoiceView, ledgerEntryKind } from "./invoice-views.js";

const detail = {
  invoice: {
    id: "inv1", invoiceNumber: 500001, kind: "order", status: "issued", clientUserId: "doc1", labOrderId: "lo1",
    issuedAt: new Date("2026-10-15T15:00:00Z"), dueDate: "2026-11-14", subtotalCents: 40500, taxCents: 0, shippingCents: 1500,
    totalCents: 42000, paidCents: 10000, balanceCents: 32000, paid: false, version: 3,
    notes: "Dr asked us to call Jane Doe's mother", voidReason: null,
  },
  lines: [{ id: "l1", kind: "item", code: "2608", description: "DDSO Nylon", qty: 1, unitCents: 40500, lineCents: 40500, priceSource: "manual", priceNote: "goodwill for Jane Doe", taxable: false }],
  payments: [
    { id: "p1", appliedCents: 12000, source: "doctor_card", transactionId: "601", paidOn: null, createdAt: new Date("2026-10-16T15:00:00Z"), reference: null, note: null },
    { id: "p2", appliedCents: 0, source: null, transactionId: "REFUND-PENDING-601", paidOn: null, createdAt: new Date(), reference: null, note: null },
    { id: "p3", appliedCents: -4000, source: "refund", transactionId: "602", refundsTransactionId: "601", paidOn: null, createdAt: new Date("2026-10-17T15:00:00Z") },
    { id: "p4", appliedCents: 2000, source: "credit", transactionId: "credit:p4", paidOn: "2026-10-18", createdAt: new Date(), reference: null, note: "shade mismatch" },
  ],
  labOrder: { id: "lo1", orderNumber: 100245, caseNumber: "RX-ABC", patientName: "Jane Doe", status: "shipped" },
  client: { id: "doc1", name: "Dr Lee", practice: "Lee Dental" },
};

test("a doctor sees the bill, its lines and dated payments — never staff notes, price notes, sources or references", () => {
  const v = doctorInvoiceView(detail);
  assert.deepEqual(Object.keys(v).sort(), [
    "balanceCents", "caseNumber", "dueDate", "id", "invoiceNumber", "issuedAt", "kind", "labOrderNumber", "lines", "paidCents",
    "patientName", "payments", "shippingCents", "status", "subtotalCents", "taxCents", "totalCents",
  ]);
  assert.deepEqual(Object.keys(v.lines[0]).sort(), ["code", "description", "id", "kind", "lineCents", "qty", "unitCents"]);
  assert.deepEqual(v.payments.map((p) => [p.kind, p.amountCents]), [["payment", 12000], ["refund", -4000], ["credit", 2000]]);
  assert.deepEqual(Object.keys(v.payments[0]).sort(), ["amountCents", "date", "kind"]);
  const text = JSON.stringify(v);
  for (const secret of ["call Jane Doe's mother", "goodwill", "shade mismatch", "601", "doctor_card", "manual"]) {
    assert.ok(!text.includes(secret), `leaked: ${secret}`);
  }
  assert.equal(v.patientName, "Jane Doe", "the doctor needs the patient to match the bill");
});

test("a doctor's list row is an allow-list too", () => {
  const row = doctorInvoiceRow({ ...detail.invoice, labOrderNumber: 100245, patientInitials: "JD", caseNumber: "RX-ABC" });
  assert.deepEqual(Object.keys(row).sort(), [
    "balanceCents", "dueDate", "id", "invoiceNumber", "issuedAt", "kind", "labOrderNumber", "paidCents", "patientInitials", "status", "totalCents",
  ]);
});

test("staff see everything, with the ledger shaped and the refund guard row hidden", () => {
  const v = adminInvoiceView({ ...detail, activity: [{ action: "invoice.issued" }] });
  assert.equal(v.invoice.notes, "Dr asked us to call Jane Doe's mother");
  assert.equal(v.lines[0].priceNote, "goodwill for Jane Doe");
  assert.deepEqual(v.payments.map((p) => [p.kind, p.source, p.amountCents]), [
    ["payment", "doctor_card", 12000], ["refund", "refund", -4000], ["credit", "credit", 2000],
  ]);
  assert.equal(v.payments[2].note, "shade mismatch");
  assert.equal(v.activity.length, 1);
});

test("ledger entry kinds", () => {
  assert.equal(ledgerEntryKind({ source: "credit", appliedCents: 100 }), "credit");
  assert.equal(ledgerEntryKind({ source: "refund", appliedCents: -100 }), "refund");
  assert.equal(ledgerEntryKind({ source: "admin_check", appliedCents: 100 }), "payment");
});

test("a settlement row reads as a settlement; a legacy invoice shows its Seazona patient", () => {
  assert.equal(ledgerEntryKind({ source: "legacy_settlement", appliedCents: 500 }), "settlement");
  const legacy = { ...detail, invoice: { ...detail.invoice, kind: "legacy", labOrderId: null, legacyPatient: "Test Patient" }, labOrder: null };
  const v = doctorInvoiceView(legacy);
  assert.equal(v.kind, "legacy");
  assert.equal(v.patientName, "Test Patient");
  assert.equal(doctorInvoiceView(detail).patientName, detail.labOrder?.patientName ?? null, "a normal invoice is unchanged");
});
