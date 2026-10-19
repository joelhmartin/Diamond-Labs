import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { fakeTx } = await import("../../test/fake-tx.js");
const mod = await import("./invoices.service.js");
const { decryptField } = await import("../../lib/crypto.js");
const source = readFileSync(fileURLToPath(new URL("./invoices.service.js", import.meta.url)), "utf8");
const inserts = (tx) => tx.log.filter((l) => l.op === "insert").map((l) => l.values);

const labLines = [
  { id: "lol1", variantId: "v1", code: "2608", name: "DDSO Nylon", qty: 1, noteOnly: false },
  { id: "lol2", variantId: null, code: "9999", name: "Mystery", qty: 1, noteOnly: false },
  { id: "lol3", variantId: null, code: null, name: "Bite in CR", qty: 1, noteOnly: true },
];

test("a released lab order gets a draft invoice priced from the client's prices", async () => {
  const tx = fakeTx({ selects: [
    [{ id: "v1", basePriceCents: 45000, taxable: false }], // variants
    [{ variantId: "v1", priceCents: 40500 }], // client prices
    [{ max: 500010 }], // invoice number
  ] });
  const out = await mod.createDraftForLabOrder(tx, { labOrder: { id: "lo1", clientUserId: "doc1", isRemake: false }, lines: labLines, byUserId: "staff1" });
  assert.equal(out.invoiceNumber, 500011);
  const [invoice, lines, audit] = inserts(tx);
  assert.deepEqual([invoice.status, invoice.kind, invoice.clientUserId, invoice.labOrderId, invoice.totalCents], ["draft", "order", "doc1", "lo1", 40500]);
  assert.deepEqual(lines.map((l) => [l.labOrderLineId, l.unitCents, l.priceSource]), [["lol1", 40500, "client"], ["lol2", 0, "unpriced"]]);
  assert.equal(audit.action, "invoice.drafted");
  assert.deepEqual(audit.metadata, { invoiceNumber: 500011, labOrderId: "lo1", unpriced: true });
  const ops = tx.log.map((l) => l.op);
  assert.ok(ops.indexOf("execute") < ops.lastIndexOf("select"), "number allocated under the advisory lock");
});

test("a remake's draft copies the lines at no charge", async () => {
  const tx = fakeTx({ selects: [[{ id: "v1", basePriceCents: 45000, taxable: false }], [], [{ max: null }]] });
  await mod.createDraftForLabOrder(tx, { labOrder: { id: "lo2", clientUserId: "doc1", isRemake: true }, lines: labLines.slice(0, 1) });
  const [invoice, lines] = inserts(tx);
  assert.equal(invoice.totalCents, 0);
  assert.equal(invoice.invoiceNumber, 500000);
  assert.deepEqual(lines.map((l) => [l.unitCents, l.priceSource]), [[0, "remake"]]);
});

test("a paid shop order gets an issued invoice, paid in full by one shop_card ledger row", async () => {
  const tx = fakeTx({ selects: [[{ max: null }]] });
  const quote = {
    lines: [{ variantId: "v1", code: "61", name: "Mute", qty: 2, unitCents: 2199, lineCents: 4398, taxable: true, priceSource: "base" }],
    subtotalCents: 4398, taxCents: 352, shippingCents: 1200, totalCents: 5950,
  };
  await mod.createShopInvoice(tx, { labOrderId: "lo9", clientUserId: null, quote, transactionId: "60123" });
  const [invoice, lines, ledger, audit] = inserts(tx);
  assert.deepEqual([invoice.kind, invoice.status, invoice.totalCents, invoice.clientUserId], ["shop", "issued", 5950, null]);
  assert.equal(lines.length, 2);
  assert.deepEqual(
    [ledger.userId, ledger.invoiceId, ledger.appliedCents, ledger.source, ledger.transactionId],
    [null, invoice.id, 5950, "shop_card", "60123"],
  );
  assert.equal(audit.action, "invoice.issued");
});

const draftRow = { id: "inv1", invoiceNumber: 500001, status: "draft", version: 1, totalCents: 40500, notes: null, voidReason: null };

test("shipping issues a priced draft, due on the lab-local ship date plus terms", async () => {
  const tx = fakeTx({ selects: [[draftRow], [{ id: "l1", description: "DDSO", priceSource: "client", priceNote: null }]] });
  // 03:00 UTC on Oct 16 is still Oct 15 in Chicago.
  const out = await mod.issueForShippedLabOrder(tx, { labOrderId: "lo1", shippedAt: new Date("2026-10-16T03:00:00Z"), byUserId: "tech1" });
  assert.deepEqual(out, { issued: true, dueDate: "2026-11-14" });
  const set = tx.log.find((l) => l.op === "set").values;
  assert.deepEqual([set.status, set.dueDate, set.version], ["issued", "2026-11-14", 2]);
  assert.equal(inserts(tx).at(-1).action, "invoice.issued");
});

test("an unpriced line holds the invoice at draft; the ship is not affected", async () => {
  const tx = fakeTx({ selects: [[draftRow], [{ id: "l1", description: "Mystery", priceSource: "unpriced", priceNote: null }]] });
  const out = await mod.issueForShippedLabOrder(tx, { labOrderId: "lo1", shippedAt: new Date(), byUserId: "tech1" });
  assert.deepEqual(out, { issued: false, reason: "unpriced" });
  assert.equal(tx.log.filter((l) => l.op === "set").length, 0);
  assert.equal(inserts(tx).at(-1).action, "invoice.issue_held");
});

test("an already-issued invoice is left alone on ship", async () => {
  const tx = fakeTx({ selects: [[{ ...draftRow, status: "issued" }]] });
  assert.deepEqual(await mod.issueForShippedLabOrder(tx, { labOrderId: "lo1", shippedAt: new Date() }), { issued: false, reason: "issued" });
});

test("a lab order released before invoicing existed is drafted on ship, then issued", async () => {
  const tx = fakeTx({ selects: [
    [], // no invoice yet
    [{ id: "lo1", source: "rx_case", clientUserId: "doc1", isRemake: false }],
    [labLines[0]],
    [{ id: "v1", basePriceCents: 45000, taxable: false }],
    [],
    [{ max: null }],
    [draftRow],
    [{ id: "l1", description: "DDSO", priceSource: "base", priceNote: null }],
  ] });
  const out = await mod.issueForShippedLabOrder(tx, { labOrderId: "lo1", shippedAt: new Date("2026-10-15T15:00:00Z") });
  assert.equal(out.issued, true);
  assert.equal(inserts(tx)[0].status, "draft");
});

test("cancelling voids a draft with a sealed reason; an issued invoice is not touched", async () => {
  const tx = fakeTx({ selects: [[draftRow]] });
  assert.deepEqual(await mod.voidForCancelledLabOrder(tx, { labOrderId: "lo1", byUserId: "tech1" }), { voided: true });
  const set = tx.log.find((l) => l.op === "set").values;
  assert.equal(set.status, "void");
  assert.equal(decryptField(set.voidReason), "Lab order cancelled");
  const issued = fakeTx({ selects: [[{ ...draftRow, status: "issued" }]] });
  assert.deepEqual(await mod.voidForCancelledLabOrder(issued, { labOrderId: "lo1" }), { voided: false });
});

test("everything runs on the caller's transaction and locks the invoice row; nothing talks to Seazona", () => {
  assert.doesNotMatch(source, /\bdb\./, "use the transaction passed in");
  assert.match(source, /\.for\("update"\)/);
  assert.doesNotMatch(source, /seazona/i);
  assert.equal(mod.INVOICE_NUMBER_LOCK, 7300422);
});

const shipDraftRow = {
  id: "inv1", invoiceNumber: 500001, status: "draft", version: 2, clientUserId: "doc1", labOrderId: "lo1",
  subtotalCents: 40500, taxCents: 0, shippingCents: 0, totalCents: 40500, notes: null, voidReason: null,
};
const shipItemLine = { id: "l1", invoiceId: "inv1", position: 0, kind: "item", qty: 1, unitCents: 40500, lineCents: 40500, taxable: false, priceSource: "client", priceNote: null, shipmentId: null };

test("a shipment's shipping line lands on its order's draft, totals recomputed, version-checked and audited", async () => {
  const tx = fakeTx({ selects: [[shipDraftRow], [shipItemLine]], updates: [[{ ...shipDraftRow, version: 3, shippingCents: 1142, totalCents: 41642 }]] });
  const out = await mod.addShipmentLine(tx, { labOrderId: "lo1", shipmentId: "sh1", description: "Shipping — UPS Ground 1Z999", unitCents: 1142, byUserId: "u1" });
  assert.deepEqual(out, { added: true, invoiceNumber: 500001 });
  const [line, audit] = inserts(tx);
  assert.deepEqual([line.kind, line.shipmentId, line.unitCents, line.priceSource], ["shipping", "sh1", 1142, "shipment"]);
  assert.equal(audit.action, "invoice.edited");
  assert.equal(tx.log.find((l) => l.op === "set").values.totalCents, 41642);
});

test("no draft: nothing is added and the caller is told why", async () => {
  const issued = fakeTx({ selects: [[{ ...shipDraftRow, status: "issued" }]] });
  assert.deepEqual(await mod.addShipmentLine(issued, { labOrderId: "lo1", shipmentId: "sh1", description: "S", unitCents: 100 }), { added: false, reason: "not_draft", invoiceNumber: 500001 });
  assert.equal(inserts(issued).length, 0);
  assert.deepEqual(await mod.addShipmentLine(fakeTx({ selects: [[]] }), { labOrderId: "lo1", shipmentId: "sh1", description: "S", unitCents: 100 }), { added: false, reason: "no_invoice" });
});

test("an unknown shipment charge (null) is refused up front, never added as $0", async () => {
  for (const bad of [null, undefined, 0, -1, 1.5]) {
    const tx = fakeTx({ selects: [] });
    await assert.rejects(mod.addShipmentLine(tx, { labOrderId: "lo1", shipmentId: "sh1", description: "S", unitCents: bad }), (e) => e.code === "INVALID");
    assert.equal(tx.log.length, 0);
  }
});

test("voiding removes the shipment's line from a draft; an issued invoice is left alone", async () => {
  const shipLine = { ...shipItemLine, id: "l2", position: 1, kind: "shipping", unitCents: 1142, lineCents: 1142, priceSource: "shipment", shipmentId: "sh1" };
  const tx = fakeTx({ selects: [[{ invoiceId: "inv1" }], [shipDraftRow], [shipItemLine, shipLine]], updates: [[{ ...shipDraftRow, version: 3 }]] });
  assert.deepEqual(await mod.removeShipmentLine(tx, { shipmentId: "sh1", byUserId: "u1" }), { removed: true, invoiceNumber: 500001 });
  assert.equal(tx.log.filter((l) => l.op === "delete").length, 1);
  const issued = fakeTx({ selects: [[{ invoiceId: "inv1" }], [{ ...shipDraftRow, status: "issued" }]] });
  assert.deepEqual(await mod.removeShipmentLine(issued, { shipmentId: "sh1" }), { removed: false, reason: "not_draft", invoiceNumber: 500001 });
  assert.deepEqual(await mod.removeShipmentLine(fakeTx({ selects: [[]] }), { shipmentId: "sh1" }), { removed: false, reason: "no_line" });
});

test("a draft edited by staff meanwhile is a 409, not a lost update", async () => {
  const tx = fakeTx({ selects: [[shipDraftRow], [shipItemLine]], updates: [[]] });
  await assert.rejects(mod.addShipmentLine(tx, { labOrderId: "lo1", shipmentId: "sh1", description: "S", unitCents: 100 }), (e) => e.code === "STALE");
});
