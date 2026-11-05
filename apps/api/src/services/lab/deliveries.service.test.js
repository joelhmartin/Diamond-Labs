import { test } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);

const { listStops, deliveryRange } = await import("./deliveries.service.js");
const { fakeTx } = await import("../../test/fake-tx.js");

// listStops reads, in order: the local orders, the scheduled pickups, then the clients of both.
const FROM = "2026-11-05";
const TO = "2026-11-11";
const order = (over = {}) => ({
  id: "o1", orderNumber: 100101, status: "in_production", version: 2, dueDate: "2026-11-06",
  shippedAt: null, clientUserId: "d1", deliveryMethod: "local_delivery", ...over,
});
const pickup = (over = {}) => ({
  id: "p1", pickupNumber: 7, boxCount: 2, clientUserId: "d1", partyKey: "practice:P1", scheduledDate: "2026-11-06",
  timePreference: "am", assigneeUserId: null, address: null, version: 3, ...over,
});
const client = (over = {}) => ({
  id: "d1", seazonaClientId: "P1", name: "Dr. Ada", companyName: "Smile Dental", address1: "1 Main St", address2: null,
  city: "Austin", state: "TX", zip: "78701", phone: "512-555-0100", deliveryNotes: "Back door", ...over,
});
const run = (orders, pickups = [], clients = [client()]) =>
  listStops(fakeTx({ selects: [orders, pickups, clients] }), { from: FROM, to: TO, todayIso: FROM });

test("groups local orders by dueDate and practice into one stop", async () => {
  const stops = await run([
    order(),
    order({ id: "o2", orderNumber: 100102, clientUserId: "d2" }), // same practice (P1), another doctor
    order({ id: "o3", orderNumber: 100103, dueDate: "2026-11-07" }),
  ], [], [client(), client({ id: "d2", name: "Dr. Bea" })]);
  assert.equal(stops.length, 2);
  assert.equal(stops[0].id, "2026-11-06:practice:P1");
  assert.equal(stops[0].day, "2026-11-06");
  assert.deepEqual(stops[0].orders.map((o) => o.orderNumber), [100101, 100102]);
  assert.equal(stops[0].practice, "Smile Dental");
  assert.equal(stops[1].day, "2026-11-07");
  assert.equal(stops[1].late, false);
});

test("stops sort by day, then practice", async () => {
  const stops = await run([
    order({ id: "o1", dueDate: "2026-11-07" }),
    order({ id: "o2", clientUserId: "d2", dueDate: "2026-11-06" }),
    order({ id: "o3", clientUserId: "d3", dueDate: "2026-11-06" }),
  ], [], [
    client(),
    client({ id: "d2", seazonaClientId: "P2", companyName: "Zeta Ortho" }),
    client({ id: "d3", seazonaClientId: "P3", companyName: "Alpha Smiles" }),
  ]);
  assert.deepEqual(stops.map((s) => `${s.day} ${s.practice}`), [
    "2026-11-06 Alpha Smiles", "2026-11-06 Zeta Ortho", "2026-11-07 Smile Dental",
  ]);
});

test("open order due before from appears on from with late=true", async () => {
  const stops = await run([order({ dueDate: "2026-10-30" })]);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].day, FROM);
  assert.equal(stops[0].late, true);
  assert.equal(stops[0].id, `${FROM}:practice:P1`);
});

test("cancelled and non-local orders are excluded", async () => {
  const stops = await run([
    order({ status: "cancelled" }),
    order({ id: "o2", deliveryMethod: "ups" }),
    order({ id: "o3", deliveryMethod: null }),
    order({ id: "o4", dueDate: null }),
    order({ id: "o5", dueDate: "2026-11-12" }), // after the range
  ]);
  assert.deepEqual(stops, []);
});

test("shipped orders only within range", async () => {
  const stops = await run([
    order({ id: "in", orderNumber: 1, status: "shipped", shippedAt: new Date("2026-11-06T20:00:00Z") }),
    order({ id: "before", orderNumber: 2, status: "shipped", shippedAt: new Date("2026-11-04T20:00:00Z") }),
    // 03:00 UTC on the 5th is still the 4th in Chicago.
    order({ id: "edge", orderNumber: 3, status: "shipped", shippedAt: new Date("2026-11-05T03:00:00Z") }),
  ]);
  assert.deepEqual(stops.flatMap((s) => s.orders.map((o) => o.id)), ["in"]);
  assert.equal(stops[0].late, false);
});

test("scheduled pickups join the same stop", async () => {
  const stops = await run(
    [order()],
    [pickup(), pickup({ id: "p2", pickupNumber: 8, clientUserId: "d4", partyKey: "practice:P4", scheduledDate: "2026-11-08" })],
    [client(), client({ id: "d4", seazonaClientId: "P4", companyName: "North Dental" })],
  );
  assert.equal(stops.length, 2);
  assert.deepEqual(stops[0].pickups, [{ id: "p1", pickupNumber: 7, boxCount: 2, version: 3 }]);
  assert.equal(stops[0].orders.length, 1);
  // A pickup with no order that day is a stop of its own.
  assert.equal(stops[1].id, "2026-11-08:practice:P4");
  assert.deepEqual(stops[1].orders, []);
  assert.equal(stops[1].practice, "North Dental");
});

test("output contains no patient fields", async () => {
  const [stop] = await run([order({ patientName: "enc:v1:x", legacyPatient: "enc:v1:y" })], [pickup()]);
  assert.deepEqual(Object.keys(stop).sort(), [
    "address", "day", "deliveryNotes", "id", "late", "orders", "phone", "pickups", "practice",
  ]);
  assert.deepEqual(Object.keys(stop.orders[0]).sort(), ["id", "orderNumber", "status", "version"]);
  assert.deepEqual(Object.keys(stop.pickups[0]).sort(), ["boxCount", "id", "pickupNumber", "version"]);
  assert.deepEqual(stop.address, { address1: "1 Main St", address2: null, city: "Austin", state: "TX", zip: "78701" });
  assert.equal(stop.phone, "512-555-0100");
  assert.equal(stop.deliveryNotes, "Back door");
});

test("no rows reads no clients", async () => {
  const tx = fakeTx({ selects: [[], []] });
  assert.deepEqual(await listStops(tx, { from: FROM, to: TO, todayIso: FROM }), []);
  assert.equal(tx.log.filter((l) => l.op === "select").length, 2);
});

test("deliveryRange defaults to today (CT) through six days later and refuses a reversed range", () => {
  assert.deepEqual(deliveryRange({}, "2026-11-05"), { from: "2026-11-05", to: "2026-11-11" });
  assert.deepEqual(deliveryRange({ from: "2026-11-09" }, "2026-11-05"), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(deliveryRange({ from: "2026-11-01", to: "2026-11-02" }, "2026-11-05"), { from: "2026-11-01", to: "2026-11-02" });
  assert.throws(() => deliveryRange({ from: "2026-11-09", to: "2026-11-01" }, "2026-11-05"), (e) => e.code === "INVALID");
  assert.throws(() => deliveryRange({ from: "2026-01-01", to: "2026-12-31" }, "2026-11-05"), (e) => e.code === "INVALID");
});
