import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { syncTracking, TRACKING_WINDOW_DAYS, SYNC_LIMIT } = await import("./tracking-sync.service.js");
const { fakeTx } = await import("../../test/fake-tx.js");
const { fakeAdapter, fakeRegistry } = await import("../../test/carrier-config.js");
const source = readFileSync(new URL("./tracking-sync.service.js", import.meta.url), "utf8");

const now = new Date("2026-10-21T15:00:00Z");
const row = (over) => ({ id: "sh1", carrier: "ups", trackingNumber: "1Z1", status: "label_created", shippedAt: null, ...over });
const result = (over) => ({ trackingNumber: "1Z1", status: "in_transit", carrierCode: "P", description: "Pickup Scan", location: "SAN ANTONIO, TX", occurredAt: now, deliveredAt: null, events: [], ...over });
const logger = () => { const lines = []; return { lines, error: (m) => lines.push(m), warn: (m) => lines.push(m) }; };

test("a dry run only counts", async () => {
  const ups = fakeAdapter("ups");
  const database = fakeTx({ selects: [[row(), row({ id: "sh2", trackingNumber: "1Z2" })]] });
  const out = await syncTracking({ dryRun: true, now, database, registry: fakeRegistry([ups]) });
  assert.deepEqual(out, { checked: 2, updated: 0, moved: 0, delivered: 0, errors: 0, unknownCodes: 0, capped: false, dryRun: true });
  assert.equal(ups.calls.length, 0);
});

test("a run polls at most SYNC_LIMIT shipments and reports capped", async () => {
  const many = Array.from({ length: SYNC_LIMIT + 1 }, (_, i) => row({ id: `s${i}`, trackingNumber: `1Z${i}` }));
  const out = await syncTracking({ dryRun: true, now, database: fakeTx({ selects: [many] }), registry: fakeRegistry([fakeAdapter("ups")]) });
  assert.equal(out.checked, SYNC_LIMIT);
  assert.equal(out.capped, true);
  assert.match(source, /\.limit\(SYNC_LIMIT \+ 1\)/);
  assert.match(source, /lastTrackedAt\} asc nulls first/);
});

test("first movement: one event, the new status, and the box is shipped in the same transaction (onMoved)", async () => {
  const ups = fakeAdapter("ups", { track: async () => [result()] });
  const database = fakeTx({ selects: [[row()]], updates: [[{ id: "sh1" }]] });
  const moved = [];
  const out = await syncTracking({ now, database, registry: fakeRegistry([ups]), onMoved: async (tx, id) => { moved.push([tx === database, id]); } });
  assert.deepEqual(moved, [[true, "sh1"]]);
  assert.equal(out.updated, 1);
  assert.equal(out.moved, 1);
  assert.equal(database.log.find((l) => l.op === "set").values.status, "in_transit");
  assert.equal(database.log.filter((l) => l.op === "insert").at(-1).values.description, "Pickup Scan");
});

test("whatever onMoved returns runs after the commit", async () => {
  const ups = fakeAdapter("ups", { track: async () => [result()] });
  const order = [];
  const database = fakeTx({ selects: [[row()]], updates: [[{ id: "sh1" }]] });
  const real = database.transaction;
  database.transaction = async (fn) => { const r = await real(fn); order.push("commit"); return r; };
  await syncTracking({ now, database, registry: fakeRegistry([ups]), onMoved: async () => () => order.push("email") });
  assert.deepEqual(order, ["commit", "email"]);
});

test("delivered is counted and stamped; an already-shipped box isn't shipped again", async () => {
  const ups = fakeAdapter("ups", { track: async () => [result({ status: "delivered", deliveredAt: now })] });
  const database = fakeTx({ selects: [[row({ status: "in_transit", shippedAt: now })]], updates: [[{ id: "sh1" }]] });
  const moved = [];
  const out = await syncTracking({ now, database, registry: fakeRegistry([ups]), onMoved: async (_tx, id) => moved.push(id) });
  assert.equal(out.delivered, 1);
  assert.deepEqual(moved, []);
  assert.equal(database.log.find((l) => l.op === "set").values.deliveredAt, now);
});

test("one carrier failing doesn't stop the other; each failed number keeps its error for the next run", async () => {
  const ups = fakeAdapter("ups", { track: async () => [result({ status: null, error: { carrier: "ups", code: "151044", message: "No tracking information available" } })] });
  const fedex = fakeAdapter("fedex", { track: async () => [result({ trackingNumber: "7946" })] });
  const database = fakeTx({ selects: [[row(), row({ id: "sh2", carrier: "fedex", trackingNumber: "7946" })]], updates: [[{ id: "sh1" }], [{ id: "sh2" }]] });
  const out = await syncTracking({ now, database, registry: fakeRegistry([ups, fedex]), onMoved: async () => {} });
  assert.equal(out.errors, 1);
  assert.equal(out.updated, 1);
  const sets = database.log.filter((l) => l.op === "set").map((l) => l.values);
  assert.equal(sets[0].trackingError, "No tracking information available");
  assert.equal(sets[1].status, "in_transit");
});

test("an unknown carrier code is counted and logged by code, with no address", async () => {
  const ups = fakeAdapter("ups", { track: async () => [result({ status: null, carrierCode: "ZZ" })] });
  const log = logger();
  const out = await syncTracking({ now, database: fakeTx({ selects: [[row()]], updates: [[{ id: "sh1" }]] }), registry: fakeRegistry([ups]), log });
  assert.equal(out.unknownCodes, 1);
  assert.deepEqual(log.lines, ["[SHIP][UNKNOWN_STATUS] carrier=ups code=ZZ shipment=sh1"]);
});

test("a failed onMoved rolls the whole write back: logged by code, retried next run", async () => {
  const ups = fakeAdapter("ups", { track: async () => [result()] });
  const log = logger();
  const out = await syncTracking({
    now, database: fakeTx({ selects: [[row()]], updates: [[{ id: "sh1" }]] }), registry: fakeRegistry([ups]), log,
    onMoved: async () => { throw Object.assign(new Error("secret address"), { code: "STALE" }); },
  });
  assert.equal(out.moved, 0);
  assert.equal(out.updated, 0);
  assert.equal(out.errors, 1);
  assert.deepEqual(log.lines, ["[SHIP][MARK_SHIPPED_FAILED] shipment=sh1 error=STALE"]);
});

test("a carrier call that throws is logged by carrier and error name only", async () => {
  const ups = fakeAdapter("ups", { track: async () => { throw new TypeError("body with secrets"); } });
  const log = logger();
  const out = await syncTracking({ now, database: fakeTx({ selects: [[row()]], updates: [[{ id: "sh1" }]] }), registry: fakeRegistry([ups]), log });
  assert.equal(out.errors, 1);
  assert.deepEqual(log.lines, ["[SHIP][TRACK_FAILED] carrier=ups error=TypeError"]);
});

test("log defaults to console so CLI runs still reach Cloud Logging", () => {
  assert.match(source, /log = console/);
});

test("no tracking carrier enabled: nothing is read", async () => {
  const database = fakeTx();
  const out = await syncTracking({ now, database, registry: fakeRegistry([fakeAdapter("manual")]) });
  assert.equal(out.checked, 0);
  assert.equal(database.log.length, 0);
});

test("the sweep: open, trackable shipments bought in the last 30 days; a refresh by id ignores the window", () => {
  assert.equal(TRACKING_WINDOW_DAYS, 30);
  assert.match(source, /notInArray\(shipments\.status, TERMINAL_SHIPMENT_STATUSES\)/);
  assert.match(source, /if \(shipmentIds\) conds\.push\(inArray\(shipments\.id, shipmentIds\)\);\s*else conds\.push\(gte\(shipments\.purchasedAt/);
});

test("the job is registered under the name Cloud Scheduler calls", async () => {
  await import("../../jobs/definitions/index.js");
  const { listJobs } = await import("../../jobs/registry.js");
  assert.ok(listJobs().some((j) => j.name === "shipping-tracking-sync"));
});
