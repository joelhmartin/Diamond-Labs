import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const svc = await import("./shipments.service.js");
const { ShippingError, CarrierError } = await import("./shipping-errors.js");
const { fakeTx } = await import("../../test/fake-tx.js");
const { fakeAdapter, fakeRegistry, TEST_LABEL } = await import("../../test/carrier-config.js");
const source = readFileSync(fileURLToPath(new URL("./shipments.service.js", import.meta.url)), "utf8");

const shipTo = { name: "Dr. Ada", address1: "1 St", city: "Austin", state: "TX", postalCode: "78701", country: "US" };
const parcel = { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const request = { carrier: "ups", serviceCode: "03", shipFrom: null, shipTo, parcel, reference: "Order 100245" };
const logger = () => { const lines = []; return { lines, error: (m) => lines.push(m) }; };

test("rates: every enabled carrier in parallel, cheapest first; one failing carrier doesn't hide the others", async () => {
  const ups = fakeAdapter("ups", { rate: async () => [{ carrier: "ups", serviceCode: "03", serviceName: "UPS Ground", amountCents: 1142 }] });
  const fedex = fakeAdapter("fedex", { rate: async () => { throw new CarrierError("fedex", "SYSTEM.UNAVAILABLE", "Try later."); } });
  const manual = fakeAdapter("manual");
  const off = fakeAdapter("dhl", { configured: () => ({ ok: false, reason: "DHL: credentials not set" }) });
  const out = await svc.rateAll({ shipFrom: null, shipTo, parcel }, { registry: fakeRegistry([ups, fedex, manual, off]) });
  assert.deepEqual(out.quotes.map((q) => q.amountCents), [1142]);
  assert.deepEqual(out.errors, [{ carrier: "fedex", code: "SYSTEM.UNAVAILABLE", message: "Try later." }]);
  assert.deepEqual(out.disabled.map((d) => d.reason), ["DHL: credentials not set"]);
  assert.equal(manual.calls.length, 0, "manual has no rates");
});

test("rates: a bug inside an adapter shows a plain message, never the stack", async () => {
  const ups = fakeAdapter("ups", { rate: async () => { throw new TypeError("cannot read x of undefined"); } });
  const out = await svc.rateAll({ shipTo, parcel }, { registry: fakeRegistry([ups]) });
  assert.deepEqual(out.errors, [{ carrier: "ups", code: "ERROR", message: "UPS rating failed." }]);
});

test("buy: a disabled carrier is refused before any call", async () => {
  const ups = fakeAdapter("ups", { configured: () => ({ ok: false, reason: "UPS: credentials not set (UPS_CLIENT_ID)" }) });
  await assert.rejects(svc.buyLabel(request, { registry: fakeRegistry([ups]) }), (e) => e instanceof ShippingError && e.code === "CARRIER_DISABLED");
  assert.equal(ups.calls.length, 0);
});

test("buy: an uncertain purchase keeps its idempotency key locked and tells staff to check before retrying", async () => {
  const ups = fakeAdapter("ups", { createLabel: async () => { throw new CarrierError("ups", "TIMEOUT", "UPS did not answer within 30s.", { uncertain: true, timedOut: true }); } });
  const log = logger();
  await assert.rejects(svc.buyLabel(request, { registry: fakeRegistry([ups]), log }), (e) =>
    e instanceof ShippingError && e.code === "PURCHASE_UNCERTAIN" && e.gatewayOutcomePending === true && /check Admin › Shipments before retrying/.test(e.message));
  assert.deepEqual(log.lines, ["[SHIP][PURCHASE_UNCERTAIN] carrier=ups code=TIMEOUT"]);
});

test("buy: a definite refusal passes through with the carrier's words, and the key is released", async () => {
  const refusal = new CarrierError("ups", "120802", "Address Validation Error on ShipTo address", { httpStatus: 400 });
  const ups = fakeAdapter("ups", { createLabel: async () => { throw refusal; } });
  await assert.rejects(svc.buyLabel(request, { registry: fakeRegistry([ups]) }), (e) => e === refusal && !e.gatewayOutcomePending);
});

test("persist failure: the label is voided at the carrier and staff are told to try again", async () => {
  const ups = fakeAdapter("ups");
  const cause = new Error("db down");
  await assert.rejects(
    svc.purchaseAndPersist(request, async () => { throw cause; }, { registry: fakeRegistry([ups]), log: logger() }),
    (e) => e instanceof ShippingError && e.code === "LABEL_NOT_SAVED" && e.cause === cause && /voided/.test(e.message),
  );
  const voidCall = ups.calls.find(([name]) => name === "voidLabel");
  assert.equal(voidCall[1].carrierShipmentId, TEST_LABEL.carrierShipmentId);
});

test("persist AND void failing: [SHIP][LABEL_ORPHANED] with ids only, and the tracking number for staff", async () => {
  const ups = fakeAdapter("ups", { voidLabel: async () => ({ ok: false, reason: "Already picked up" }) });
  const log = logger();
  await assert.rejects(svc.purchaseAndPersist(request, async () => { throw new Error("db down"); }, { registry: fakeRegistry([ups]), log }),
    (e) => e.code === "LABEL_NOT_SAVED" && e.message.includes("1Z999AA10123456784"));
  assert.deepEqual(log.lines, ["[SHIP][LABEL_ORPHANED] carrier=ups tracking=1Z999AA10123456784"]);
  assert.ok(!log.lines.join(" ").includes("Austin"), "no address in logs");
});

test("persist success returns what persist returned, and nothing is voided", async () => {
  const ups = fakeAdapter("ups");
  const out = await svc.purchaseAndPersist(request, async (label) => ({ saved: label.trackingNumber, carrier: label.carrier }), { registry: fakeRegistry([ups]) });
  assert.deepEqual(out, { saved: "1Z999AA10123456784", carrier: "ups" });
  assert.equal(ups.calls.filter(([n]) => n === "voidLabel").length, 0);
});

test("persist AND void failing keeps the idempotency key locked; a clean void releases it (P5)", async () => {
  const stuck = fakeAdapter("ups", { voidLabel: async () => ({ ok: false, reason: "Already picked up" }) });
  await assert.rejects(svc.purchaseAndPersist(request, async () => { throw new Error("db down"); }, { registry: fakeRegistry([stuck]), log: logger() }),
    (e) => e.code === "LABEL_NOT_SAVED" && e.gatewayOutcomePending === true);
  const clean = fakeAdapter("ups");
  await assert.rejects(svc.purchaseAndPersist(request, async () => { throw new Error("db down"); }, { registry: fakeRegistry([clean]), log: logger() }),
    (e) => e.code === "LABEL_NOT_SAVED" && e.gatewayOutcomePending === false);
});

test("markVoided is conditional: a lost race throws VOID_REFUSED and logs ids only (P6)", async () => {
  const log = logger();
  const lost = fakeTx({ updates: [[]] });
  await assert.rejects(svc.markVoided(lost, { id: "sh1", carrier: "ups", status: "label_created" }, { now: new Date() }, { log }),
    (e) => e instanceof ShippingError && e.code === "VOID_REFUSED");
  assert.deepEqual(log.lines, ["[SHIP][VOID_RACE] shipment=sh1 carrier=ups"]);
  assert.equal(lost.log.filter((l) => l.op === "insert").length, 0, "no event on a lost race");
  const won = fakeTx({ updates: [[{ id: "sh1" }]] });
  await svc.markVoided(won, { id: "sh1", carrier: "ups", status: "label_created" }, { now: new Date() });
  assert.equal(won.log.find((l) => l.op === "set").values.status, "voided");
  assert.equal(won.log.filter((l) => l.op === "insert").length, 1);
});

test("an unknown charge stays null in the row (R5a)", async () => {
  const { planNewShipment } = await import("./shipment-rules.js");
  const { shipment } = planNewShipment({ id: "s", label: { ...TEST_LABEL, chargeCents: null, carrier: "ups" }, parcel, shipTo, now: new Date() });
  assert.equal(shipment.chargeCents, null);
});

test("insertShipment writes the row and its first event in the caller's transaction", async () => {
  const tx = fakeTx();
  await svc.insertShipment(tx, { shipment: { id: "sh1", status: "label_created" }, event: { shipmentId: "sh1", status: "label_created" } });
  const inserts = tx.log.filter((l) => l.op === "insert").map((l) => l.values);
  assert.equal(inserts[0].id, "sh1");
  assert.equal(inserts[1].shipmentId, "sh1");
  assert.ok(inserts[1].id, "events get their own id");
});

test("stampShipped is a claim: it only wins once, and never on a voided shipment", async () => {
  assert.match(source, /isNull\(shipments\.shippedAt\)/);
  assert.match(source, /ne\(shipments\.status, "voided"\)/);
  const won = fakeTx({ updates: [[{ id: "sh1" }]] });
  assert.equal(await svc.stampShipped(won, { id: "sh1", carrier: "ups", status: "label_created" }, { now: new Date() }), true);
  assert.equal(await svc.stampShipped(fakeTx({ updates: [[]] }), { id: "sh1", carrier: "ups", status: "label_created" }, { now: new Date() }), false);
});

test("a manual shipment handed off moves to in_transit with a staff event", async () => {
  const tx = fakeTx({ updates: [[{ id: "sh2" }]] });
  await svc.stampShipped(tx, { id: "sh2", carrier: "manual", status: "label_created" }, { now: new Date() });
  assert.equal(tx.log.find((l) => l.op === "set").values.status, "in_transit");
  assert.equal(tx.log.filter((l) => l.op === "insert").at(-1).values.source, "staff");
});

test("a tracking write only lands if the status is still the one we read (a void mid-sync wins)", async () => {
  assert.match(source, /eq\(shipments\.status, shipment\.status\)/);
  const lost = fakeTx({ updates: [[]] });
  const wrote = await svc.applyTrackingPlan(lost, { id: "sh1", status: "label_created" }, { patch: { status: "in_transit" }, event: { status: "in_transit" } });
  assert.equal(wrote, false);
  assert.equal(lost.log.filter((l) => l.op === "insert").length, 0);
});

test("summaries and lists never carry the label image", () => {
  assert.ok(!("labelData" in svc.SUMMARY));
  assert.ok("hasLabel" in svc.SUMMARY);
});
