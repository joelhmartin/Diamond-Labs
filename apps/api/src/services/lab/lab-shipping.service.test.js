import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
const sentEmails = [];
vi.mock("../email.service.js", () => ({ sendShippedNotice: vi.fn(async (args) => { sentEmails.push(args); return true; }) }));

const svc = await import("./lab-shipping.service.js");
const { fakeTx } = await import("../../test/fake-tx.js");
const { fakeAdapter, fakeRegistry, TEST_SHIP_FROM, TEST_LABEL } = await import("../../test/carrier-config.js");
const { LabOrderError } = await import("./lab-order-rules.js");
const { decryptField } = await import("../../lib/crypto.js");
const source = readFileSync(new URL("./lab-shipping.service.js", import.meta.url), "utf8");

const shipTo = { name: "Dr. Ada", company: "Smile Dental", address1: "1 St", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const parcel = { preset: "small_box", weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const order = (over) => ({
  id: "lo1", orderNumber: 100245, status: "ready_to_ship", source: "rx_case", sourceId: "c1", clientUserId: "doc1",
  isRemake: false, shipmentId: null, version: 3, holdReason: null, labNotes: null, shippedAt: null, ...over,
});
const draft = { id: "inv1", invoiceNumber: 500001, status: "draft", version: 1, subtotalCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0, notes: null, voidReason: null };
const deps = (database, adapters = [fakeAdapter("ups")], extra = {}) => ({
  database, registry: fakeRegistry(adapters), shipFrom: TEST_SHIP_FROM, charge: { policy: "none", flatCents: 0 },
  emailEnabled: true, log: { error: () => {} }, ...extra,
});
const buy = (over = {}) => ({ orderIds: ["lo1"], shipTo, parcel, carrier: "ups", serviceCode: "03", byUserId: "u1", ...over });
const inserts = (tx) => tx.log.filter((l) => l.op === "insert").map((l) => l.values);

test("an order that isn't shippable is refused before any carrier call", async () => {
  const ups = fakeAdapter("ups");
  await assert.rejects(svc.buyForOrders(buy(), deps(fakeTx({ selects: [[order({ status: "quality_check" })]] }), [ups])), (e) => e.code === "NOT_SHIPPABLE");
  assert.equal(ups.calls.length, 0);
});

test("ship together: one label for the box, order numbers as the reference, every order linked in one transaction", async () => {
  const ups = fakeAdapter("ups");
  const a = order();
  const b = order({ id: "lo2", orderNumber: 100246, version: 1 });
  const tx = fakeTx({ selects: [[b, a], [a], [b]], updates: [[{ ...a, shipmentId: "x", version: 4 }], [{ ...b, shipmentId: "x", version: 2 }]] });
  const out = await svc.buyForOrders(buy({ orderIds: ["lo2", "lo1"] }), deps(tx, [ups]));
  const request = ups.calls.find(([n]) => n === "createLabel")[1];
  assert.equal(request.reference, "Order 100245, 100246");
  assert.deepEqual(request.shipFrom, TEST_SHIP_FROM);
  assert.deepEqual(out.orderNumbers, [100245, 100246]);
  assert.equal(out.trackingNumber, TEST_LABEL.trackingNumber);
  assert.deepEqual(out.invoiceLine, { added: false, reason: "policy_none" });
  const [shipmentRow, firstEvent, ...labEvents] = inserts(tx);
  assert.equal(shipmentRow.carrier, "ups");
  assert.equal(firstEvent.status, "label_created");
  assert.deepEqual(labEvents.map((e) => e.type), ["shipment", "shipment"]);
  assert.match(decryptField(labEvents[0].note), /^Label: UPS Ground 1Z999/);
});

test("an order labelled by someone else meanwhile: the save fails and the just-bought label is voided", async () => {
  const ups = fakeAdapter("ups");
  const tx = fakeTx({ selects: [[order()], [order({ shipmentId: "sh0" })]] });
  await assert.rejects(svc.buyForOrders(buy(), deps(tx, [ups])), (e) =>
    e.code === "LABEL_NOT_SAVED" && e.cause instanceof LabOrderError && e.cause.code === "CONFLICT");
  assert.equal(ups.calls.filter(([n]) => n === "voidLabel").length, 1);
});

test("carrier_cost: the label's charge goes on the lowest non-remake Rx order's draft", async () => {
  const remake = order({ id: "lo0", orderNumber: 100200, isRemake: true, version: 1 });
  const a = order();
  const tx = fakeTx({
    selects: [[remake, a], [remake], [a], [draft], []],
    updates: [[{ ...remake, shipmentId: "x", version: 2 }], [{ ...a, shipmentId: "x", version: 4 }], [{ ...draft, version: 2 }]],
  });
  const out = await svc.buyForOrders(buy({ orderIds: ["lo0", "lo1"] }), deps(tx, undefined, { charge: { policy: "carrier_cost", flatCents: 0 } }));
  assert.deepEqual(out.invoiceLine, { added: true, invoiceNumber: 500001 });
  const line = inserts(tx).find((v) => v.kind === "shipping");
  assert.deepEqual([line.unitCents, line.description, line.priceSource], [1142, "Shipping — UPS Ground 1Z999AA10123456784", "shipment"]);
});

test("an invoice that's no longer a draft gets nothing, and the order's history says why", async () => {
  const a = order();
  const tx = fakeTx({
    selects: [[a], [a], [{ ...draft, status: "issued" }], [{ ...a, shipmentId: "x", version: 4 }]],
    updates: [[{ ...a, shipmentId: "x", version: 4 }], [{ ...a, shipmentId: "x", version: 5 }]],
  });
  const out = await svc.buyForOrders(buy(), deps(tx, undefined, { charge: { policy: "carrier_cost", flatCents: 0 } }));
  assert.deepEqual(out.invoiceLine, { added: false, reason: "not_draft", invoiceNumber: 500001 });
  const note = inserts(tx).at(-1);
  assert.equal(note.type, "note");
  assert.match(decryptField(note.note), /invoice #500001 is no longer a draft/);
});

const shipment = { id: "sh1", carrier: "ups", status: "label_created", shippedAt: null, carrierShipmentId: "1Z1", trackingNumber: "1Z999AA10123456784", serviceName: "UPS Ground" };

test("void is refused (and the carrier never asked) once an order has moved", async () => {
  const ups = fakeAdapter("ups");
  const tx = fakeTx({ selects: [[shipment], [order({ status: "shipped", shipmentId: "sh1" })]] });
  await assert.rejects(svc.voidShipment("sh1", { byUserId: "u1" }, deps(tx, [ups])), (e) => e.code === "VOID_REFUSED");
  assert.equal(ups.calls.length, 0);
});

test("void: carrier first, then the shipment, the order link and the invoice line", async () => {
  const ups = fakeAdapter("ups");
  const linked = order({ shipmentId: "sh1" });
  const tx = fakeTx({ selects: [[shipment], [linked], [linked]], updates: [[{ id: "sh1" }], [{ ...linked, shipmentId: null, version: 4 }]] });
  const out = await svc.voidShipment("sh1", { byUserId: "u1" }, deps(tx, [ups]));
  assert.deepEqual(out, { shipmentId: "sh1", orderIds: ["lo1"], invoiceLineRemoved: false });
  assert.equal(ups.calls[0][0], "voidLabel");
  assert.equal(tx.log.find((l) => l.op === "set").values.status, "voided");
});

test("mark shipped: every order in the box ships, and ONE email lists them all", async () => {
  sentEmails.length = 0;
  const a = order({ shipmentId: "sh1" });
  const b = order({ id: "lo2", orderNumber: 100246, version: 1, shipmentId: "sh1" });
  const client = { id: "doc1", name: "Dr. Ada", email: "dr@x.com", role: "doctor", accountNumber: null, profile: null };
  const tx = fakeTx({
    // shipment, the box, then per order: its row + the billing follow-up's two reads; then the email's reads
    selects: [[shipment], [a, b], [a], [], [], [b], [], [], [a, b], [client]],
    updates: [[{ id: "sh1" }], [{ ...a, status: "shipped", version: 4 }], [{ ...b, status: "shipped", version: 2 }]],
  });
  const out = await svc.markShipmentShipped("sh1", { byUserId: "u1" }, deps(tx));
  assert.deepEqual(out, { shipmentId: "sh1", ordersShipped: [100245, 100246], alreadyShipped: false });
  assert.equal(sentEmails.length, 1);
  assert.deepEqual(sentEmails[0], {
    to: "dr@x.com", orderNumbers: [100245, 100246], carrier: "UPS", trackingNumber: "1Z999AA10123456784",
    trackingUrl: "https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784",
  });
});

test("mark shipped twice (staff and the tracking sync racing): the second sends nothing", async () => {
  sentEmails.length = 0;
  const shippedA = order({ shipmentId: "sh1", status: "shipped" });
  const tx = fakeTx({ selects: [[{ ...shipment, shippedAt: new Date() }], [shippedA]], updates: [[]] });
  const out = await svc.markShipmentShipped("sh1", { byUserId: null }, deps(tx));
  assert.deepEqual(out, { shipmentId: "sh1", ordersShipped: [], alreadyShipped: true });
  assert.equal(sentEmails.length, 0);
});

test("mark shipped on one order: an unlabelled order takes the normal path; a labelled one ships its box", () => {
  assert.match(source, /if \(!order\.shipmentId\) return changeStatus\(labOrderId, \{ to: "shipped", expectedVersion, byUserId \}\);/);
  assert.match(source, /assertFresh\(order, expectedVersion\);\s*await markShipmentShipped\(order\.shipmentId/);
});

test("a stale order page can't ship a box", async () => {
  const tx = fakeTx({ selects: [[order({ shipmentId: "sh1", version: 3 })]] });
  await assert.rejects(svc.markOrderShipped("lo1", { expectedVersion: 2, byUserId: "u1" }, deps(tx)), (e) => e instanceof LabOrderError && e.code === "STALE");
});

test("shipping never reads patient data", () => {
  assert.doesNotMatch(source, /patient|formData|caseSummary|decryptRxPhi/i);
});

test("a failure AFTER the commit never voids the saved label", async () => {
  const ups = fakeAdapter("ups");
  const a = order();
  const tx = fakeTx({ selects: [[a], [a]], updates: [[{ ...a, shipmentId: "x", version: 4 }]] });
  const log = { error: () => {}, info: () => { throw new Error("log sink down"); } };
  const out = await svc.buyForOrders(buy(), deps(tx, [ups], { log }));
  assert.equal(out.trackingNumber, TEST_LABEL.trackingNumber);
  assert.equal(ups.calls.filter(([n]) => n === "voidLabel").length, 0);
});

test("carrier_cost with no reported charge: no invoice line, and a note tells staff to add it", async () => {
  const ups = fakeAdapter("ups", { createLabel: async () => ({ ...TEST_LABEL, chargeCents: null }) });
  const a = order();
  const tx = fakeTx({ selects: [[a], [a], [{ ...a, shipmentId: "x", version: 4 }]], updates: [[{ ...a, shipmentId: "x", version: 4 }], [{ ...a, shipmentId: "x", version: 5 }]] });
  const out = await svc.buyForOrders(buy(), deps(tx, [ups], { charge: { policy: "carrier_cost", flatCents: 0 } }));
  assert.deepEqual(out.invoiceLine, { added: false, reason: "charge_unknown" });
  assert.equal(inserts(tx).some((v) => v.kind === "shipping"), false);
  const note = inserts(tx).at(-1);
  assert.equal(note.type, "note");
  assert.match(decryptField(note.note), /carrier reported no charge/);
});

test("void race (P6): the box moved meanwhile, so nothing is unlinked and no invoice line is touched", async () => {
  const linked = order({ shipmentId: "sh1" });
  const tx = fakeTx({ selects: [[shipment], [linked]], updates: [[]] });
  const errors = [];
  await assert.rejects(
    svc.voidShipment("sh1", { byUserId: "u1" }, deps(tx, [fakeAdapter("ups")], { log: { error: (m) => errors.push(m) } })),
    (e) => e.code === "VOID_REFUSED",
  );
  assert.equal(tx.log.filter((l) => l.op === "update").length, 1, "only the conditional shipment update ran");
  assert.equal(tx.log.filter((l) => l.op === "select").length, 2, "no order or invoice-line reads after the refusal");
  assert.ok(errors.some((m) => m.startsWith("[SHIP][VOID_RACE]")));
  assert.ok(!errors.some((m) => m.includes("VOID_UNRECORDED")));
});

test("void with a non-draft invoice: the line stays, and the order's history says so", async () => {
  const linked = order({ shipmentId: "sh1" });
  const issued = { id: "inv1", invoiceNumber: 500001, status: "issued", version: 2 };
  const tx = fakeTx({
    selects: [[shipment], [linked], [linked], [{ invoiceId: "inv1" }], [issued], [{ ...linked, shipmentId: null, version: 4 }]],
    updates: [[{ id: "sh1" }], [{ ...linked, shipmentId: null, version: 4 }], [{ ...linked, version: 5 }]],
  });
  const out = await svc.voidShipment("sh1", { byUserId: "u1" }, deps(tx));
  assert.equal(out.invoiceLineRemoved, false);
  assert.deepEqual(out.invoiceLineSkipped, [{ invoiceNumber: 500001, reason: "not_draft" }]);
  assert.match(decryptField(inserts(tx).at(-1).note), /invoice #500001 was left in place/);
});
