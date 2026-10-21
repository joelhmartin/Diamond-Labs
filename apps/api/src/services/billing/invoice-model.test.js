import { test } from "vitest";
import assert from "node:assert/strict";
import { buildInvoiceModel, billToLines } from "./invoice-model.js";

const generatedAt = new Date("2026-10-20T15:00:00Z");
const invoice = {
  invoiceNumber: 500001, kind: "order", status: "issued", issuedAt: new Date("2026-10-15T15:00:00Z"), dueDate: "2026-11-14",
  subtotalCents: 40500, taxCents: 0, shippingCents: 1500, totalCents: 42000, paidCents: 12000, balanceCents: 30000,
};
const lines = [
  { qty: 1, code: "2608", description: "DDSO Nylon", kind: "item", unitCents: 40500, lineCents: 40500 },
  { qty: 1, code: null, description: "Shipping", kind: "shipping", unitCents: 1500, lineCents: 1500 },
];
const client = { name: "Dr Amy Lee", practice: "Lee Dental", address1: "1 Main St", address2: null, city: "San Antonio", state: "TX", zip: "78201", accountNumber: "1324" };
const order = { orderNumber: 100245, caseNumber: "RX-ABC", patientName: "Jane Doe" };

test("an invoice prints who, what, when and how much — the patient too, but never in the filename", () => {
  const m = buildInvoiceModel(invoice, lines, client, order, { generatedAt });
  assert.equal(m.filename, "invoice-500001.pdf");
  assert.deepEqual(m.header, [
    ["Invoice", "#500001"], ["Status", "Open"], ["Issued", "10/15/2026"], ["Due", "11/14/2026"],
    ["Lab order", "#100245"], ["Case", "RX-ABC"], ["Patient", "Jane Doe"],
  ]);
  assert.deepEqual(m.billTo, ["Lee Dental", "Dr Amy Lee", "1 Main St", "San Antonio, TX 78201", "Account 1324"]);
  assert.deepEqual(m.lines, [["1", "2608", "DDSO Nylon", "$405.00", "$405.00"], ["1", "—", "Shipping", "$15.00", "$15.00"]]);
  assert.deepEqual(m.totals.map((t) => [t.label, t.value]), [
    ["Subtotal", "$405.00"], ["Shipping", "$15.00"], ["Tax", "$0.00"], ["Total", "$420.00"], ["Paid", "$120.00"], ["Balance due", "$300.00"],
  ]);
  assert.deepEqual(m.banners, []);
  assert.ok(!m.filename.includes("Jane"));
});

test("a draft and a void say so; an unpaid invoice past its due date reads Past due", () => {
  assert.deepEqual(buildInvoiceModel({ ...invoice, status: "draft", issuedAt: null, dueDate: null }, lines, client, order, { generatedAt }).banners, ["DRAFT — NOT A BILL"]);
  const v = buildInvoiceModel({ ...invoice, status: "void", balanceCents: 0 }, lines, client, order, { generatedAt });
  assert.deepEqual(v.banners, ["VOID"]);
  assert.ok(!v.totals.some((t) => t.label === "Balance due"), "a void owes nothing");
  assert.equal(buildInvoiceModel(invoice, lines, client, order, { generatedAt: new Date("2026-11-20T15:00:00Z") }).status, "Past due");
});

test("a guest's shop invoice bills the shop order", () => {
  const m = buildInvoiceModel({ ...invoice, kind: "shop" }, lines, null, { orderNumber: 100300, shopOrderNumber: "DOL-ABC123", caseNumber: null, patientName: null }, { generatedAt });
  assert.deepEqual(m.header[4], ["Shop order", "DOL-ABC123"]);
  assert.deepEqual(m.billTo, ["Walk-in / guest"]);
  assert.deepEqual(billToLines({ name: "Dr Solo", practice: "Dr Solo" }), ["Dr Solo"], "a solo practice isn't printed twice");
});

test("text the PDF fonts can't draw is replaced, not printed as garbage", () => {
  const m = buildInvoiceModel(invoice, lines, client, { ...order, patientName: "Zoë 😀" }, { generatedAt });
  assert.deepEqual(m.header[6], ["Patient", "Zoë ?"]);
});

test("the footer names the lab from one place (config/lab-identity.js)", () => {
  assert.match(buildInvoiceModel(invoice, lines, null, null, { generatedAt }).footer, /Diamond Orthotic Laboratory/);
  const custom = buildInvoiceModel(invoice, lines, null, null, { generatedAt, labName: "Acme Lab" }).footer;
  assert.match(custom, /Acme Lab/);
  assert.doesNotMatch(custom, /Diamond/);
});

test("a legacy invoice prints Seazona's patient when there is no lab order", () => {
  const m = buildInvoiceModel({ ...invoice, kind: "legacy", legacyPatient: "Test Patient" }, lines, client, null, { generatedAt });
  assert.deepEqual(m.header.find((h) => h[0] === "Patient"), ["Patient", "Test Patient"]);
});
