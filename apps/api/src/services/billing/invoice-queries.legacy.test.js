process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../../test/fake-tx.js";
import { sealInvoice, sealLine } from "./invoice-crypto.js";
import { doctorInvoiceView } from "./invoice-views.js";

const { listClientInvoices, getInvoiceDetail } = await import("./invoice-queries.js");

// A legacy invoice as the importer stores it: patient and line text sealed, never plaintext.
const sealedInvoice = sealInvoice({
  id: "inv1", invoiceNumber: 1, kind: "legacy", status: "issued", clientUserId: "doc1", labOrderId: null, totalCents: 10000,
  notes: null, voidReason: null, legacyPatient: "Test Patient",
});
const sealedLine = sealLine({ id: "l1", invoiceId: "inv1", position: 0, kind: "item", description: "Carried over from Seazona", qty: 1, unitCents: 10000, lineCents: 10000, legacyDescription: "Test Crown Seazona text", priceNote: null });

test("a sealed legacy patient and line text come back opened in the doctor's list and detail, never as enc:v1:", async () => {
  assert.match(sealedInvoice.legacyPatient, /^enc:v1:/, "fixture really is sealed");
  assert.match(sealedLine.legacyDescription, /^enc:v1:/);

  const list = await listClientInvoices(["doc1"], {}, fakeTx({ selects: [
    [{ invoice: sealedInvoice, labOrderNumber: null, caseNumber: null, patientFirst: null, patientLast: null }],
    [],
  ] }));
  assert.equal(list[0].patientInitials, "TP");
  assert.ok(!JSON.stringify(list).includes("enc:v1:"));

  const detail = await getInvoiceDetail("inv1", {}, fakeTx({ selects: [
    [{ invoice: sealedInvoice, clientName: "Dr Test", clientEmail: null, accountNumber: null, clientSeazonaClientId: null, profile: null }],
    [], // paid sums
    [sealedLine],
    [], // ledger rows
  ] }));
  assert.equal(detail.invoice.legacyPatient, "Test Patient");
  assert.equal(detail.lines[0].description, "Test Crown Seazona text", "the Seazona text replaces the fixed placeholder");
  const view = doctorInvoiceView(detail);
  assert.equal(view.patientName, "Test Patient");
  assert.equal(view.lines[0].description, "Test Crown Seazona text");
  assert.ok(!JSON.stringify(view).includes("enc:v1:"));
});

test("an unreadable sealed patient shows no initials instead of failing the list", async () => {
  const bad = { ...sealedInvoice, legacyPatient: "enc:v1:not-a-real-ciphertext" };
  const list = await listClientInvoices(["doc1"], {}, fakeTx({ selects: [[{ invoice: bad, labOrderNumber: null, caseNumber: null, patientFirst: null, patientLast: null }], []] }));
  assert.equal(list.length, 1);
  assert.equal(list[0].patientInitials, null);
});

test("a staff-entered order's invoice shows its sealed patient opened (detail) and as initials (list), with no shop lookup", async () => {
  const { sealOrder } = await import("../lab/lab-order-crypto.js");
  const sealedPatient = sealOrder({ patientName: "Jane Roe" }).patientName;
  assert.match(sealedPatient, /^enc:v1:/, "fixture really is sealed");
  const inv = sealInvoice({ id: "inv2", invoiceNumber: 2, kind: "order", status: "issued", clientUserId: "doc1", labOrderId: "lo2", totalCents: 5000, notes: null, voidReason: null, legacyPatient: null });

  const list = await listClientInvoices(["doc1"], {}, fakeTx({ selects: [
    [{ invoice: inv, labOrderNumber: 100050, caseNumber: null, patientFirst: null, patientLast: null, staffPatient: sealedPatient }],
    [],
  ] }));
  assert.equal(list[0].patientInitials, "JR");
  assert.ok(!JSON.stringify(list).includes("enc:v1:"));

  const tx = fakeTx({ selects: [
    [{ invoice: inv, clientName: "Dr Test", clientEmail: null, accountNumber: null, clientSeazonaClientId: null, profile: null }],
    [], // paid sums
    [], // lines
    [], // ledger rows
    [{ id: "lo2", orderNumber: 100050, source: "staff", sourceId: "lo2", status: "shipped", isRemake: false, patientName: sealedPatient }],
    [{ orderNumber: "DOL-WRONG" }], // a shop lookup would wrongly read this
  ] });
  const detail = await getInvoiceDetail("inv2", {}, tx);
  assert.deepEqual(
    [detail.labOrder.patientName, detail.labOrder.caseNumber, detail.labOrder.shopOrderNumber, detail.labOrder.orderNumber],
    ["Jane Roe", null, null, 100050],
  );
  assert.equal(tx.log.filter((l) => l.op === "select").length, 5, "no shop-order query for a staff order");
  assert.equal(doctorInvoiceView(detail).patientName, "Jane Roe");
  assert.ok(!JSON.stringify(detail).includes("enc:v1:"));
});
