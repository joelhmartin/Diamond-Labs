import { test } from "vitest";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/pg-proxy";

process.env.PHI_ENCRYPTION_KEY ||= "a".repeat(64);

const {
  labRecordResolvers, createLabMessageAlert, messageAlertArgs, describeLabParties, describeLabUsers,
  listLabParties, searchLabRecords, labMessagingGuard, createLabMessaging, isLabHost,
} = await import("./lab-messaging.js");
const { createFakeStore } = await import("../../modules/messaging/index.js");

// A real drizzle query builder over a recording driver: each query answers
// the next queued row set (arrays in the select's column order); no database.
function queueDb(...rowSets) {
  const calls = [];
  const db = drizzle(async (sql, params, method) => {
    calls.push({ sql, params, method });
    return { rows: rowSets.shift() ?? [] };
  });
  return { db, calls };
}

const staff = { id: "s1", role: "lab", name: "Sam Staff" };
const admin = { id: "a1", role: "admin" };
const d1 = { id: "d1", role: "doctor", approvalStatus: "approved", seazonaClientId: "P1" };
const d2 = { id: "d2", role: "doctor", approvalStatus: "approved", seazonaClientId: "P1" };
const d4 = { id: "d4", role: "doctor", approvalStatus: "approved", seazonaClientId: "P2" };
const d6 = { id: "d6", role: "doctor", approvalStatus: "approved", seazonaClientId: null };
const d7 = { id: "d7", role: "doctor", approvalStatus: "approved", seazonaClientId: null };

// rx_case resolve selects: id, caseNumber, ownerId, ownerClientId.
const rxRow = (ownerId, ownerClientId) => [["c1", "RX-ABC", ownerId, ownerClientId]];
// lab_order resolve selects: id, orderNumber, clientUserId, ownerClientId.
const orderRow = (clientUserId, ownerClientId) => [["o1", 1042, clientUserId, ownerClientId]];

test("rx_case resolves for a doctor of the same practice and not for another practice", async () => {
  const expected = { label: "Case RX-ABC", partyKey: "practice:P1", hostPath: "/admin/rx-cases/c1", partyPath: "/doctor/cases?case=c1" };
  assert.deepEqual(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d1", "P1")).db, "c1", d1), expected);
  assert.deepEqual(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d1", "P1")).db, "c1", d2), expected);
  assert.deepEqual(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d1", "P1")).db, "c1", staff), expected);
  assert.equal(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d1", "P1")).db, "c1", d4), null);
  assert.equal(await labRecordResolvers.rx_case.resolve(queueDb([]).db, "nope", staff), null);
});

test("rx_case resolves for a doctor with null seazonaClientId only when owner", async () => {
  const own = await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d6", null)).db, "c1", d6);
  assert.equal(own.partyKey, "user:d6");
  assert.equal(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d6", null)).db, "c1", d7), null);
  assert.equal(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d6", null)).db, "c1", d1), null);
  // A practice doctor's case is not visible to a doctor with no practice.
  assert.equal(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d1", "P1")).db, "c1", d6), null);
});

test("lab_order for a guest shop order has no party → null for staff thread creation", async () => {
  assert.equal(await labRecordResolvers.lab_order.resolve(queueDb(orderRow(null, null)).db, "o1", staff), null);
  assert.equal(await labRecordResolvers.lab_order.resolve(queueDb(orderRow(null, null)).db, "o1", admin), null);
  assert.equal(await labRecordResolvers.lab_order.resolve(queueDb(orderRow(null, null)).db, "o1", d1), null);
});

test("lab_order label is \"Case #<orderNumber>\"", async () => {
  const r = await labRecordResolvers.lab_order.resolve(queueDb(orderRow("d1", "P1")).db, "o1", staff);
  assert.deepEqual(r, { label: "Case #1042", partyKey: "practice:P1", hostPath: "/lab/orders/o1", partyPath: null });
  assert.ok(await labRecordResolvers.lab_order.resolve(queueDb(orderRow("d1", "P1")).db, "o1", d2));
  assert.equal(await labRecordResolvers.lab_order.resolve(queueDb(orderRow("d1", "P1")).db, "o1", d4), null);
});

test("labels batch: one query per type, only what the caller may see", async () => {
  const { db, calls } = queueDb([["c1", "RX-ABC", "d1", "P1"], ["c2", "RX-DEF", "d4", "P2"]]);
  const forD2 = await labRecordResolvers.rx_case.labels(db, ["c1", "c2"], d2);
  assert.equal(calls.length, 1);
  assert.deepEqual([...forD2], [["c1", "Case RX-ABC"]]);
  const forStaff = await labRecordResolvers.lab_order.labels(queueDb([["o1", 1042, "d1", "P1"], ["o2", 7, null, null]]).db, ["o1", "o2"], staff);
  assert.deepEqual([...forStaff], [["o1", "Case #1042"]]);
});

// pickup resolve selects: id, pickupNumber, partyKey.
const pickupRow = (partyKey) => [["p1", 17, partyKey]];

test("pickup resolves through its party_key: \"Pickup #<n>\" for staff and the practice, not another practice", async () => {
  const expected = { label: "Pickup #17", partyKey: "practice:P1", hostPath: "/lab/pickups?pickup=p1", partyPath: "/doctor/pickups?pickup=p1" };
  assert.deepEqual(await labRecordResolvers.pickup.resolve(queueDb(pickupRow("practice:P1")).db, "p1", staff), expected);
  assert.deepEqual(await labRecordResolvers.pickup.resolve(queueDb(pickupRow("practice:P1")).db, "p1", d2), expected);
  assert.equal(await labRecordResolvers.pickup.resolve(queueDb(pickupRow("practice:P1")).db, "p1", d4), null);
  assert.equal(await labRecordResolvers.pickup.resolve(queueDb([]).db, "nope", staff), null);
  const labels = await labRecordResolvers.pickup.labels(queueDb([["p1", 17, "practice:P1"], ["p2", 18, "practice:P2"]]).db, ["p1", "p2"], d1);
  assert.deepEqual([...labels], [["p1", "Pickup #17"]]);
});

test("host post alerts the party; party post alerts staff (excluding author) with recordType/recordId of the record or message_thread", async () => {
  const sent = [];
  const alert = createLabMessageAlert({
    db: {}, labName: "Test Lab",
    notify: async (_db, args) => { sent.push(args); },
    describeParties: async (_db, keys) => new Map(keys.map((k) => [k, "Smile Dental"])),
  });
  const thread = { id: "t1", recordType: "rx_case", recordId: "c1", partyKey: "practice:P1" };
  await alert({ thread, authorSide: "host", authorUserId: "s1", recordLabel: "Case RX-ABC" });
  await alert({ thread: { ...thread, recordType: null, recordId: null }, authorSide: "party", authorUserId: "d1", recordLabel: null });
  assert.deepEqual(sent[0], {
    event: "message.received", recordType: "rx_case", recordId: "c1",
    audience: { party: "practice:P1", excludeUserIds: ["s1"] },
    data: { threadId: "t1", recordLabel: "Case RX-ABC", senderOrg: "Test Lab" },
  });
  assert.deepEqual(sent[1], {
    event: "message.received", recordType: "message_thread", recordId: "t1",
    audience: { kinds: ["staff"], excludeUserIds: ["d1"] },
    data: { threadId: "t1", recordLabel: null, senderOrg: "Smile Dental" },
  });
});

test("alert data has no body text", async () => {
  const sent = [];
  const messaging = createLabMessaging({
    db: fakeRootDb(), labName: "Test Lab", log: quiet,
    notify: async (_db, args) => { sent.push(args); },
    overrides: { store: createFakeStore(), describeParty: async () => new Map([["practice:P1", "Smile Dental"]]) },
  });
  const t = await messaging.createThread(d1, { subject: "SECRET-SUBJECT", body: "SECRET-BODY one" });
  await messaging.post(staff, t.id, { body: "SECRET-BODY two" });
  assert.equal(sent.length, 2);
  for (const args of sent) {
    assert.deepEqual(Object.keys(args.data).sort(), ["recordLabel", "senderOrg", "threadId"]);
    assert.doesNotMatch(JSON.stringify(args), /SECRET/);
  }
  assert.deepEqual(sent[0].audience, { kinds: ["staff"], excludeUserIds: ["d1"] });
  assert.deepEqual(sent[1].audience, { party: "practice:P1", excludeUserIds: ["s1"] });
});

test("a failing notify does not fail the post", async () => {
  const messaging = createLabMessaging({
    db: fakeRootDb(), labName: "Test Lab", log: quiet,
    notify: async () => { throw new Error("boom"); },
    overrides: { store: createFakeStore() },
  });
  const t = await messaging.createThread(staff, { party: "practice:P1", body: "Hello" });
  const m = await messaging.post(staff, t.id, { body: "Again" });
  assert.equal(m.body, "Again");
});

test("a failing sender lookup still alerts, without senderOrg", async () => {
  const sent = [];
  const alert = createLabMessageAlert({
    db: {}, labName: "Test Lab", log: quiet,
    notify: async (_db, args) => { sent.push(args); },
    describeParties: async () => { throw new Error("db down"); },
  });
  await alert({ thread: { id: "t1", partyKey: "user:d6" }, authorSide: "party", authorUserId: "d6", recordLabel: null });
  assert.equal(sent[0].data.senderOrg, null);
});

test("messageAlertArgs clips labels so the notifier's data guard never drops the alert", () => {
  const a = messageAlertArgs({ thread: { id: "t1", partyKey: "practice:P1" }, authorSide: "party", authorUserId: "d1", recordLabel: "x".repeat(500) }, { senderOrg: "y".repeat(500) });
  assert.ok(a.data.recordLabel.length <= 200 && a.data.senderOrg.length <= 200);
});

// describe/list rows: id, name, seazonaClientId, companyName.
test("describeLabParties: practice key → companyName, else the doctor name", async () => {
  const { db } = queueDb([
    ["d1", "Dr One", "P1", null],
    ["d2", "Dr Two", "P1", "Smile Dental"],
    ["d6", "Dr Six", null, null],
  ]);
  const m = await describeLabParties(db, ["practice:P1", "user:d6", "practice:P9", "bogus"]);
  assert.deepEqual([...m].sort(), [["practice:P1", "Smile Dental"], ["user:d6", "Dr Six"]]);
  const { db: none, calls } = queueDb();
  assert.equal((await describeLabParties(none, ["bogus"])).size, 0);
  assert.equal(calls.length, 0);
});

test("describeLabUsers maps ids to names", async () => {
  const m = await describeLabUsers(queueDb([["s1", "Sam Staff"], ["d1", "Dr One"]]).db, ["s1", "d1"]);
  assert.equal(m.get("s1"), "Sam Staff");
  assert.equal(m.get("d1"), "Dr One");
});

test("listLabParties groups approved doctors by practice key, at most 20", async () => {
  const rows = [
    ["d1", "Dr One", "P1", null], ["d2", "Dr Two", "P1", "Smile Dental"], ["d6", "Dr Six", null, null],
    ...Array.from({ length: 30 }, (_, i) => [`x${i}`, `Zed X${String(i).padStart(2, "0")}`, `Q${i}`, null]),
  ];
  const { db, calls } = queueDb(rows);
  const out = await listLabParties(db, "dr");
  // Alphabetical by label, then capped.
  assert.equal(out.length, 20);
  assert.deepEqual(out.find((p) => p.key === "practice:P1"), { key: "practice:P1", label: "Smile Dental" });
  assert.ok(out.some((p) => p.key === "user:d6"));
  assert.equal(new Set(out.map((p) => p.key)).size, 20);
  assert.match(calls[0].sql, /approval_status/);
  assert.ok(calls[0].params.includes("approved"));
});

test("search matches party names and record labels only, never message text", async () => {
  const { db, calls } = queueDb(
    [["d1", "P1"], ["d6", null]], // doctors whose name/company matches: id, seazonaClientId
    [["c1"]], // rx cases by number
    [["o1"]], // lab orders by number
  );
  const hit = await searchLabRecords(db, "Case 104");
  assert.deepEqual(hit.partyKeys.sort(), ["practice:P1", "user:d1", "user:d6"]);
  assert.deepEqual(hit.records, [{ recordType: "rx_case", recordId: "c1" }, { recordType: "lab_order", recordId: "o1" }]);
  assert.ok(calls.every((c) => !/"messages"|message_threads/.test(c.sql)));
  // Not a number: no lab order lookup.
  const db2 = queueDb([], []);
  await searchLabRecords(db2.db, "smile");
  assert.equal(db2.calls.length, 2);
});

test("guard: staff pass; doctors must be approved; anyone else is refused", async () => {
  const reply = () => {
    const r = { status: null, body: null, code(s) { r.status = s; return r; }, send(b) { r.body = b; return r; } };
    return r;
  };
  for (const user of [staff, admin, d1]) {
    const r = reply();
    await labMessagingGuard({ user }, r);
    assert.equal(r.status, null);
  }
  for (const user of [{ ...d1, approvalStatus: "pending" }, { id: "u1", role: "user" }]) {
    const r = reply();
    await labMessagingGuard({ user }, r);
    assert.equal(r.status, 403);
  }
  assert.equal(isLabHost(staff), true);
  assert.equal(isLabHost(d1), false);
});

const quiet = { error() {}, warn() {}, info() {} };

// The root db the service runs transactions on; any query (label lookups) fails, which the views tolerate.
function fakeRootDb() {
  const db = {
    transaction: async (fn) => fn(db),
    select: () => { throw new Error("no db in this test"); },
  };
  return db;
}
