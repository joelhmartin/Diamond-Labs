import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/pg-proxy";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);

// Alerts go through the notify seam, after the transaction commits.
const notified = [];
vi.mock("../notify-seam.js", () => ({ notify: vi.fn(async (db, args) => { notified.push({ db, args }); return { inApp: 1, sent: 0, skipped: 0, failed: 0 }; }) }));

const svc = await import("./pickups.service.js");
const { fakeTx } = await import("../../test/fake-tx.js");
const { PickupError } = await import("./pickup-rules.js");
const { decryptField, encryptField } = await import("../../lib/crypto.js");

beforeEach(() => { notified.length = 0; });

const NOW = new Date("2026-11-05T15:00:00Z"); // 9:00 CT on 2026-11-05
// Logins carry their client scope (services/client-scope.js), as authenticate attaches it.
const inPractices = (...accountIds) => ({ accountIds, payable: new Set(accountIds), via: new Map(), roles: new Map(), organizations: [] });
const d1 = { id: "d1", role: "doctor", approvalStatus: "approved", scope: inPractices("P1") };
const d4 = { id: "d4", role: "doctor", approvalStatus: "approved", scope: inPractices("P2") };
const staff = { id: "s1", role: "lab" };
const input = { earliestDate: "2026-11-06", latestDate: "2026-11-07", timePreference: "am", boxCount: 3, notes: "Ring the back bell" };
const clientRow = (over = {}) => ({
  id: "d1", name: "Dr. Ada", email: "ada@x.com", role: "doctor", accountNumber: "A1", seazonaClientId: "P1",
  profile: { companyName: "Smile Dental", address1: "1 Main St", address2: null, city: "Austin", state: "tx", zip: "78701", phone: "512-555-0100" },
  ...over,
});
const row = (over = {}) => ({
  id: "p1", pickupNumber: 17, clientUserId: "d1", partyKey: "practice:P1", requestedByUserId: "d1",
  earliestDate: "2026-11-06", latestDate: "2026-11-07", timePreference: "am", boxCount: 3, notes: null, address: null,
  status: "requested", scheduledDate: null, assigneeUserId: null, completedAt: null, completedByUserId: null,
  cancelledAt: null, cancelReason: null, source: "portal", version: 1, createdAt: NOW, updatedAt: NOW, ...over,
});
const inserted = (tx) => tx.log.find((l) => l.op === "insert")?.values;
const lockSql = (tx) => tx.log.filter((l) => l.op === "execute").map((l) => l.q.queryChunks.flatMap((c) => c.value ?? []).join("")).join(" ");

test("request snapshots the practice address and seals notes", async () => {
  const tx = fakeTx({ selects: [[clientRow()], [{ max: 16 }]] });
  const out = await svc.requestPickup(d1, input, { database: tx, now: NOW });
  const v = inserted(tx);
  assert.deepEqual(v.address, {
    name: "Dr. Ada", company: "Smile Dental", phone: "512-555-0100", address1: "1 Main St", address2: null,
    city: "Austin", state: "TX", postalCode: "78701", country: "US", residential: false,
  });
  assert.notEqual(v.notes, "Ring the back bell");
  assert.equal(decryptField(v.notes), "Ring the back bell");
  assert.equal(v.partyKey, "practice:P1");
  assert.equal(v.clientUserId, "d1");
  assert.equal(v.requestedByUserId, "d1");
  assert.equal(v.source, "portal");
  assert.equal(v.status, "requested");
  assert.equal(v.version, 1);
  // The caller gets the pickup back with its notes open.
  assert.equal(out.notes, "Ring the back bell");
  assert.equal(out.pickupNumber, 17);
});

test("a request whose earliest date is before today in CT is refused before anything is written", async () => {
  const tx = fakeTx({ selects: [[clientRow()], [{ max: 16 }]] });
  await assert.rejects(svc.requestPickup(d1, { ...input, earliestDate: "2026-11-04" }, { database: tx, now: NOW }), (e) => e instanceof PickupError && e.code === "INVALID");
  assert.equal(inserted(tx), undefined);
  assert.equal(notified.length, 0);
});

test("pickup numbers increase under the lock", async () => {
  const tx = fakeTx({ selects: [[clientRow()], [{ max: 41 }]] });
  const out = await svc.requestPickup(d1, input, { database: tx, now: NOW });
  assert.equal(out.pickupNumber, 42);
  assert.equal(inserted(tx).pickupNumber, 42);
  assert.match(lockSql(tx), /pg_advisory_xact_lock\(7300480\)/);
  const ops = tx.log.map((l) => l.op);
  assert.ok(ops.indexOf("execute") < ops.indexOf("insert"), "the lock is taken before the insert");
  // An empty table starts at 1.
  const first = await svc.requestPickup(d1, input, { database: fakeTx({ selects: [[clientRow()], [{ max: null }]] }), now: NOW });
  assert.equal(first.pickupNumber, 1);
});

test("request notifies staff with pickupNumber only", async () => {
  const tx = fakeTx({ selects: [[clientRow()], [{ max: 16 }]] });
  const out = await svc.requestPickup(d1, input, { database: tx, now: NOW });
  assert.equal(notified.length, 1);
  const { db, args } = notified[0];
  assert.equal(db, tx, "notify gets the root db");
  assert.equal(args.event, "lab.pickup_requested");
  assert.equal(args.recordType, "pickup");
  assert.equal(args.recordId, out.id);
  assert.deepEqual(args.audience, { kinds: ["staff"], excludeUserIds: ["d1"] });
  // Ids and the number only: never the notes or the address.
  assert.deepEqual(args.data, { pickupNumber: 17, pickupId: out.id });
});

test("staff on-behalf request records source \"staff\"", async () => {
  const tx = fakeTx({ selects: [[clientRow({ id: "d4", seazonaClientId: "P2" })], [{ max: 16 }]] });
  await svc.requestPickup(staff, input, { onBehalfOfClientUserId: "d4", database: tx, now: NOW });
  const v = inserted(tx);
  assert.equal(v.source, "staff");
  assert.equal(v.clientUserId, "d4");
  assert.equal(v.requestedByUserId, "s1");
  // Staff entry is keyed to the client until Task 6 makes it name the practice.
  assert.equal(v.partyKey, "user:d4");
  assert.deepEqual(notified[0].args.audience, { kinds: ["staff"], excludeUserIds: ["s1"] });
});

test("staff must name a client, and it must be a doctor", async () => {
  await assert.rejects(svc.requestPickup(staff, input, { database: fakeTx(), now: NOW }), (e) => e.code === "INVALID");
  await assert.rejects(
    svc.requestPickup(staff, input, { onBehalfOfClientUserId: "u9", database: fakeTx({ selects: [[clientRow({ id: "u9", role: "user" })]] }), now: NOW }),
    (e) => e.code === "NOT_FOUND",
  );
});

// A real drizzle query builder over a recording driver (no database): answers
// each query with the next queued row set and records the SQL and params.
function queueDb(...rowSets) {
  const calls = [];
  const db = drizzle(async (sql, params, method) => {
    calls.push({ sql, params, method });
    return { rows: rowSets.shift() ?? [] };
  });
  return { db, calls };
}

test("doctor lists practice-wide pickups (their scope's practices) and not another practice's", async () => {
  const { db, calls } = queueDb([], [[0]]);
  await svc.listPickups(d1, { limit: 25 }, { database: db });
  const rowsQuery = calls[0];
  assert.match(rowsQuery.sql, /"party_key" in \(\$1, \$2\)/);
  assert.deepEqual(rowsQuery.params.slice(0, 2), ["user:d1", "practice:P1"]);
  // A doctor of another practice asks with only its own keys.
  const other = queueDb([], [[0]]);
  await svc.listPickups(d4, { limit: 25 }, { database: other.db });
  assert.deepEqual(other.calls[0].params.slice(0, 2), ["user:d4", "practice:P2"]);
});

test("a doctor with no practice lists only their own user:<id> pickups and can't cancel a practice pickup", async () => {
  const solo = { id: "d6", role: "doctor", approvalStatus: "approved", scope: inPractices() };
  const { db, calls } = queueDb([], [[0]]);
  await svc.listPickups(solo, { limit: 25 }, { database: db });
  assert.match(calls[0].sql, /"party_key" in \(\$1\)/);
  assert.equal(calls[0].params[0], "user:d6");
  const tx = fakeTx({ selects: [[row({ partyKey: "practice:P1" })]] });
  await assert.rejects(svc.cancelPickup("p1", {}, solo, { database: tx, now: NOW }), (e) => e instanceof PickupError && e.code === "NOT_FOUND");
  assert.equal(tx.log.some((l) => l.op === "update"), false);
  assert.equal(notified.length, 0);
});

test("listing opens sealed notes and hides staff-only fields from doctors", async () => {
  const sealed = row({ notes: encryptField("Back door"), assigneeUserId: "s1", completedByUserId: null });
  const tx = fakeTx({ selects: [[sealed], [{ total: 1 }]] });
  const out = await svc.listPickups(d1, { limit: 25 }, { database: tx });
  assert.equal(out.total, 1);
  assert.equal(out.rows[0].notes, "Back door");
  assert.equal("assigneeUserId" in out.rows[0], false);
  const forStaff = await svc.listPickups(staff, {}, { database: fakeTx({ selects: [[{ ...sealed, clientName: "Dr. Ada", companyName: "Smile Dental", assigneeName: "Sam" }]] }) });
  assert.equal(forStaff.total, 1);
  assert.equal(forStaff.rows[0].assigneeUserId, "s1");
  assert.equal(forStaff.rows[0].notes, "Back door");
});

test("doctor cannot cancel another practice's pickup (NOT_FOUND)", async () => {
  const tx = fakeTx({ selects: [[row({ partyKey: "practice:P2", clientUserId: "d4" })]] });
  await assert.rejects(svc.cancelPickup("p1", {}, d1, { database: tx, now: NOW }), (e) => e instanceof PickupError && e.code === "NOT_FOUND");
  assert.equal(tx.log.some((l) => l.op === "update"), false);
  assert.equal(notified.length, 0);
});

test("doctor cancel of the practice's pickup tells staff; staff cancel tells the party", async () => {
  const tx = fakeTx({ selects: [[row()]], updates: [[row({ status: "cancelled", version: 2 })]] });
  await svc.cancelPickup("p1", {}, d1, { database: tx, now: NOW });
  assert.equal(notified[0].args.event, "lab.pickup_cancelled");
  assert.deepEqual(notified[0].args.audience, { kinds: ["staff"], excludeUserIds: ["d1"] });
  assert.deepEqual(notified[0].args.data, { pickupNumber: 17, pickupId: "p1" });
  notified.length = 0;
  const tx2 = fakeTx({ selects: [[row()]], updates: [[row({ status: "cancelled", version: 2, cancelReason: encryptField("Closed") })]] });
  const out = await svc.cancelPickup("p1", { reason: "Closed", expectedVersion: 1 }, staff, { database: tx2, now: NOW });
  assert.equal(out.cancelReason, "Closed");
  const set = tx2.log.find((l) => l.op === "set").values;
  assert.equal(decryptField(set.cancelReason), "Closed");
  assert.deepEqual(notified[0].args.audience, { party: "practice:P1", excludeUserIds: ["s1"] });
});

test("schedule notifies the party", async () => {
  const tx = fakeTx({
    selects: [[row()], [{ id: "s2" }]],
    updates: [[row({ status: "scheduled", scheduledDate: "2026-11-09", assigneeUserId: "s2", version: 2 })]],
  });
  const out = await svc.schedulePickup("p1", { scheduledDate: "2026-11-09", assigneeUserId: "s2", expectedVersion: 1 }, staff, { database: tx, now: NOW });
  assert.equal(out.status, "scheduled");
  assert.equal(notified.length, 1);
  const { db, args } = notified[0];
  assert.equal(db, tx);
  assert.equal(args.event, "lab.pickup_scheduled");
  assert.deepEqual(args.audience, { party: "practice:P1" });
  assert.deepEqual(args.data, { pickupNumber: 17, pickupId: "p1", date: "11/09/2026" });
});

test("scheduling to someone who isn't active staff is refused", async () => {
  const tx = fakeTx({ selects: [[row()], []] });
  await assert.rejects(
    svc.schedulePickup("p1", { scheduledDate: "2026-11-09", assigneeUserId: "d1", expectedVersion: 1 }, staff, { database: tx, now: NOW }),
    (e) => e.code === "INVALID",
  );
  assert.equal(tx.log.some((l) => l.op === "update"), false);
});

test("a lost race on the conditional update is STALE, and nobody is notified", async () => {
  const tx = fakeTx({ selects: [[row({ status: "scheduled", scheduledDate: "2026-11-06" })]], updates: [[]] });
  await assert.rejects(svc.completePickup("p1", { expectedVersion: 1 }, staff, { database: tx, now: NOW }), (e) => e.code === "STALE");
  assert.equal(notified.length, 0);
});

test("complete is silent (no event) and records who", async () => {
  const tx = fakeTx({ selects: [[row({ status: "scheduled", scheduledDate: "2026-11-06" })]], updates: [[row({ status: "completed", version: 2 })]] });
  await svc.completePickup("p1", { expectedVersion: 1 }, staff, { database: tx, now: NOW });
  assert.equal(tx.log.find((l) => l.op === "set").values.completedByUserId, "s1");
  assert.equal(notified.length, 0);
});

test("scheduledPickupsBetween returns scheduled pickups in the date range (ids, numbers, boxes)", async () => {
  const { db, calls } = queueDb([]);
  await svc.scheduledPickupsBetween(db, "2026-11-05", "2026-11-11");
  assert.match(calls[0].sql, /"status" = \$1/);
  assert.match(calls[0].sql, /"scheduled_date" >= \$2/);
  assert.match(calls[0].sql, /"scheduled_date" <= \$3/);
  assert.deepEqual(calls[0].params.slice(0, 3), ["scheduled", "2026-11-05", "2026-11-11"]);
});

test("staff status=open filters requested + scheduled in one query", async () => {
  const { db, calls } = queueDb([], [[0]]);
  await svc.listPickups(staff, { status: "open", limit: 25 }, { database: db });
  assert.match(calls[0].sql, /"status" in \(\$1, \$2\)/);
  assert.deepEqual(calls[0].params.slice(0, 2), ["requested", "scheduled"]);
});

test("a doctor's getPickup is scoped to their party keys AND the id", async () => {
  const { db, calls } = queueDb([]);
  await assert.rejects(svc.getPickup("p9", d1, { database: db }), (e) => e instanceof PickupError && e.code === "NOT_FOUND");
  assert.match(calls[0].sql, /"party_key" in \(\$1, \$2\) and "pickups"."id" = \$3/);
  assert.deepEqual(calls[0].params.slice(0, 3), ["user:d1", "practice:P1", "p9"]);
});

test("getPickup returns the staff row, or NOT_FOUND", async () => {
  const found = await svc.getPickup("p1", staff, { database: fakeTx({ selects: [[{ ...row(), clientName: "Dr. Ada" }]] }) });
  assert.equal(found.id, "p1");
  await assert.rejects(svc.getPickup("nope", staff, { database: fakeTx({ selects: [[]] }) }), (e) => e instanceof PickupError && e.code === "NOT_FOUND");
});
