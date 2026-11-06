import { test } from "vitest";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/pg-proxy";

process.env.PHI_ENCRYPTION_KEY ||= "a".repeat(64);

const {
  labRecordResolvers, createLabMessageAlert, messageAlertArgs, describeLabParties, describeLabUsers,
  listLabParties, searchLabRecords, labMessagingGuard, createLabMessaging, isLabHost,
  createLabMessageFiles, auditAttachmentRead, MESSAGE_RECORD_TYPE,
} = await import("./lab-messaging.js");
const { createFakeStore } = await import("../../modules/messaging/index.js");
const notifications = await import("../../modules/notifications/index.js");
const { labEventDefs } = await import("./lab-notifications.js");

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
// Logins carry their client scope (services/client-scope.js), as authenticate attaches it.
const inPractices = (...accountIds) => ({ accountIds, payable: new Set(accountIds), via: new Map(), roles: new Map(), organizations: [] });
const d1 = { id: "d1", role: "doctor", approvalStatus: "approved", scope: inPractices("P1") };
const d2 = { id: "d2", role: "doctor", approvalStatus: "approved", scope: inPractices("P1") };
const d4 = { id: "d4", role: "doctor", approvalStatus: "approved", scope: inPractices("P2") };
const d6 = { id: "d6", role: "doctor", approvalStatus: "approved", scope: inPractices() };
const d7 = { id: "d7", role: "doctor", approvalStatus: "approved", scope: inPractices() };

// A queueDb the messaging service can also run its (fake-store) transactions on.
function resolverDb(...rowSets) {
  const { db } = queueDb(...rowSets);
  db.transaction = async (fn) => fn(db);
  return db;
}

// rx_case resolve selects: id, caseNumber, ownerId, accountId (the case's practice).
const rxRow = (ownerId, accountId) => [["c1", "RX-ABC", ownerId, accountId]];
// lab_order resolve selects: id, orderNumber, clientUserId, accountId, source.
const orderRow = (clientUserId, accountId, source = "rx_case") => [["o1", 1042, clientUserId, accountId, source]];

test("rx_case resolves for a doctor of the same practice and not for another practice", async () => {
  const expected = { label: "Case RX-ABC", partyKey: "practice:P1", hostPath: "/admin/rx-cases/c1", partyPath: "/doctor/cases?case=c1" };
  assert.deepEqual(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d1", "P1")).db, "c1", d1), expected);
  assert.deepEqual(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d1", "P1")).db, "c1", d2), expected);
  assert.deepEqual(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d1", "P1")).db, "c1", staff), expected);
  assert.equal(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d1", "P1")).db, "c1", d4), null);
  assert.equal(await labRecordResolvers.rx_case.resolve(queueDb([]).db, "nope", staff), null);
});

test("rx_case with no practice fails closed: staff only, never its owner", async () => {
  const forStaff = await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d6", null)).db, "c1", staff);
  assert.equal(forStaff.label, "Case RX-ABC");
  assert.equal(forStaff.partyKey, null, "no party key, so no thread can be started or opened on it");
  for (const u of [d6, d7, d1]) assert.equal(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d6", null)).db, "c1", u), null, u.id);
  // A practice doctor's case is not visible to a doctor with no practice.
  assert.equal(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("d1", "P1")).db, "c1", d6), null);
  // Even staff cannot start a thread on it (no party to file it under).
  const messaging = createLabMessaging({ db: resolverDb(rxRow("d6", null)), labName: "L", log: quiet, notify: async () => {}, overrides: { store: createFakeStore() } });
  await assert.rejects(messaging.createThread(staff, { recordType: "rx_case", recordId: "c1", body: "x" }), (e) => e.code === "NOT_FOUND");
});

test("thread on a case of practice B is not openable by A's staff", async () => {
  // A's practice staff member (not a doctor) and B's case; same group, not this login's practice.
  const staffOfA = { id: "mA", role: "user", scope: inPractices("A") };
  assert.equal(await labRecordResolvers.rx_case.resolve(queueDb(rxRow("dB", "B")).db, "c1", staffOfA), null);
  const store = createFakeStore();
  const messaging = createLabMessaging({
    db: resolverDb(rxRow("dB", "B")), labName: "L", log: quiet, notify: async () => {},
    overrides: { store, describeParty: async () => new Map(), describeUsers: async () => new Map() },
  });
  await assert.rejects(messaging.createThread(staffOfA, { recordType: "rx_case", recordId: "c1", body: "x" }), (e) => e.code === "NOT_FOUND");
  // The lab's thread with B, opened by id: not found (never forbidden); B's member and the group admin open it.
  const t = await messaging.createThread(staff, { party: "practice:B", body: "About your case" });
  await assert.rejects(messaging.getThread(staffOfA, t.id), (e) => e.code === "NOT_FOUND");
  assert.equal((await messaging.listThreads(staffOfA)).total, 0);
  const groupAdmin = { id: "ga", role: "user", scope: inPractices("A", "B") };
  assert.equal((await messaging.getThread(groupAdmin, t.id)).messages.length, 1);
  assert.equal((await messaging.getThread({ id: "mB", role: "user", scope: inPractices("B") }, t.id)).messages.length, 1);
});

test("a client starts a general thread for one practice: the only one, a named one, or 422 in All practices", async () => {
  const messaging = createLabMessaging({ db: fakeRootDb(), labName: "L", log: quiet, notify: async () => {}, overrides: { store: createFakeStore(), describeParty: async () => new Map() } });
  const both = { id: "ga", role: "user", scope: inPractices("A", "B") };
  await assert.rejects(messaging.createThread(both, { body: "Hi" }), (e) => e.statusCode === 422 && e.code === "PRACTICE_REQUIRED" && e.message === "Choose a practice.");
  assert.equal((await messaging.createThread(both, { party: "practice:B", body: "Hi" })).partyKey, "practice:B");
  assert.equal((await messaging.createThread(d1, { body: "Hi" })).partyKey, "practice:P1");
  // A party outside the login's keys reads as not found.
  await assert.rejects(messaging.createThread(d1, { party: "practice:P2", body: "Hi" }), (e) => e.code === "NOT_FOUND");
});

test("lab_order for a guest shop order has no party → null for staff thread creation", async () => {
  assert.equal(await labRecordResolvers.lab_order.resolve(queueDb(orderRow(null, null)).db, "o1", staff), null);
  assert.equal(await labRecordResolvers.lab_order.resolve(queueDb(orderRow(null, null)).db, "o1", admin), null);
  assert.equal(await labRecordResolvers.lab_order.resolve(queueDb(orderRow(null, null)).db, "o1", d1), null);
});

test("lab_order with no practice: a shop order stays its buyer's; any other fails closed to staff", async () => {
  const shop = await labRecordResolvers.lab_order.resolve(queueDb(orderRow("d6", null, "shop_order")).db, "o1", d6);
  assert.equal(shop.partyKey, "user:d6");
  assert.equal(await labRecordResolvers.lab_order.resolve(queueDb(orderRow("d6", null, "rx_case")).db, "o1", d6), null);
  assert.equal(await labRecordResolvers.lab_order.resolve(queueDb(orderRow("d6", null, "staff")).db, "o1", d6), null);
  assert.equal((await labRecordResolvers.lab_order.resolve(queueDb(orderRow("d6", null, "staff")).db, "o1", staff)).partyKey, null);
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
  const forStaff = await labRecordResolvers.lab_order.labels(queueDb([["o1", 1042, "d1", "P1", "rx_case"], ["o2", 7, null, null, "shop_order"]]).db, ["o1", "o2"], staff);
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

// doctor rows: id, name, companyName; account rows: id, name, accountNumber.
test("describeLabParties: practice key → the practice's account name and number, user key → the doctor", async () => {
  const { db } = queueDb(
    [["P1", "Smile Dental", "1042"]],
    [["d6", "Dr Six", null]],
  );
  const m = await describeLabParties(db, ["practice:P1", "user:d6", "practice:P9", "bogus"]);
  assert.deepEqual([...m].sort(), [["practice:P1", "Smile Dental (1042)"], ["user:d6", "Dr Six"]]);
  const { db: none, calls } = queueDb();
  assert.equal((await describeLabParties(none, ["bogus"])).size, 0);
  assert.equal(calls.length, 0);
});

test("describeLabUsers maps ids to names", async () => {
  const m = await describeLabUsers(queueDb([["s1", "Sam Staff"], ["d1", "Dr One"]]).db, ["s1", "d1"]);
  assert.equal(m.get("s1"), "Sam Staff");
  assert.equal(m.get("d1"), "Dr One");
});

test("listLabParties lists practices (active client accounts) by name and number, at most 20", async () => {
  const rows = [["P1", "Smile Dental", "1042"], ["P2", "Alpha Ortho", null]];
  const { db, calls } = queueDb(rows);
  const out = await listLabParties(db, "smi");
  assert.deepEqual(out, [{ key: "practice:P2", label: "Alpha Ortho" }, { key: "practice:P1", label: "Smile Dental (1042)" }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /"accounts"\."is_client" = \$\d/);
  assert.match(calls[0].sql, /"accounts"\."status" = \$\d/);
  assert.match(calls[0].sql, /"account_number" ilike/);
  // A member's name finds their practice (active memberships only).
  assert.match(calls[0].sql, /"memberships"\."status" = \$\d/);
  assert.match(calls[0].sql, /limit \$\d/);
  assert.ok(calls[0].params.includes(20));
  assert.doesNotMatch(calls[0].sql, /seazona/);
});

test("search matches party names and record labels only, never message text", async () => {
  const { db, calls } = queueDb(
    [["P1"]], // practices whose name, number or member matches: id
    [["d6"]], // doctors whose name/company matches: id (their own user key, for threads with no practice)
    [["c1"]], // rx cases by number
    [["o1"]], // lab orders by number
  );
  const hit = await searchLabRecords(db, "Case 104");
  assert.deepEqual(hit.partyKeys.sort(), ["practice:P1", "user:d6"]);
  assert.deepEqual(hit.records, [{ recordType: "rx_case", recordId: "c1" }, { recordType: "lab_order", recordId: "o1" }]);
  assert.ok(calls.every((c) => !/"messages"|message_threads/.test(c.sql)));
  // Not a number: no lab order lookup.
  const db2 = queueDb([], [], []);
  await searchLabRecords(db2.db, "smile");
  assert.equal(db2.calls.length, 3);
});

test("guard: staff pass; clients need the client portal (a practice in scope, or an approved doctor)", async () => {
  const reply = () => {
    const r = { status: null, body: null, code(s) { r.status = s; return r; }, send(b) { r.body = b; return r; } };
    return r;
  };
  // A practice's non-doctor staff and a group admin pass on their scope (the client portal guard).
  for (const user of [staff, admin, d1, { id: "u2", role: "user", scope: inPractices("A") }]) {
    const r = reply();
    await labMessagingGuard({ user }, r);
    assert.equal(r.status, null);
  }
  for (const user of [{ ...d1, approvalStatus: "pending", scope: inPractices() }, { id: "u1", role: "user" }]) {
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

// ── Attachments through record-files ────────────────────────────────────────

class FileError extends Error {
  constructor(code) { super(code); this.name = "FileError"; this.code = code; }
}

// A stand-in for modules/record-files: rows as record-files returns them
// (originalName, size), plus the calls each function saw.
function recordFilesStub(seed = []) {
  const rows = [...seed];
  const calls = { attach: [], signed: [], removed: [] };
  return {
    rows, calls, FileError,
    async attachFiles(args) {
      calls.attach.push(args);
      return args.files.map((f, i) => {
        const r = { id: `rf${rows.length + 1}`, recordType: args.recordType, recordId: args.recordId, kind: f.kind, originalName: f.originalName, contentType: f.contentType, size: f.buffer.length, createdAt: new Date(i) };
        rows.push(r);
        return r;
      });
    },
    async filesFor(type, ids) {
      const m = new Map();
      for (const r of rows) if (r.recordType === type && ids.includes(r.recordId)) m.set(r.recordId, [...(m.get(r.recordId) ?? []), r]);
      return m;
    },
    async getFile(id) {
      const r = rows.find((x) => x.id === id);
      if (!r) throw new FileError("NOT_FOUND");
      return r;
    },
    async signedUrlFor(id) { calls.signed.push(id); return { url: `https://signed.example/${id}`, file: rows.find((x) => x.id === id) }; },
    async removeFile(id) { calls.removed.push(id); },
  };
}

const pdf = (name) => ({ buffer: Buffer.from("%PDF"), originalName: name, contentType: "application/pdf" });

function labMessagingWithFiles(service) {
  return createLabMessaging({ db: fakeRootDb(), labName: "Test Lab", log: quiet, notify: async () => {}, fileService: service, overrides: { store: createFakeStore() } });
}

test("post with files stores them through record-files under recordType \"message\"", async () => {
  const service = recordFilesStub();
  const messaging = labMessagingWithFiles(service);
  const t = await messaging.createThread(staff, { party: "practice:P1", body: "Hello" });
  const m = await messaging.post(staff, t.id, { body: "See scan", files: [pdf("scan.pdf")] });
  assert.equal(MESSAGE_RECORD_TYPE, "message");
  assert.equal(service.calls.attach.length, 1);
  const call = service.calls.attach[0];
  assert.equal(call.recordType, "message");
  assert.equal(call.recordId, m.id);
  assert.equal(call.byUserId, "s1");
  assert.deepEqual(call.files.map((f) => f.kind), ["attachment"]);
  assert.deepEqual(m.attachments, [{ id: "rf1", fileName: "scan.pdf", contentType: "application/pdf", sizeBytes: 4 }]);
});

test("a non-message record-files id → NOT_FOUND, never signed", async () => {
  const service = recordFilesStub([{ id: "lab1", recordType: "lab_order", recordId: "o1", kind: "scan", originalName: "x.stl", contentType: null, size: 1, createdAt: new Date(0) }]);
  const messaging = labMessagingWithFiles(service);
  await assert.rejects(messaging.attachmentUrl(staff, "lab1"), (e) => e.code === "NOT_FOUND");
  await assert.rejects(messaging.attachmentUrl(staff, "unknown"), (e) => e.code === "NOT_FOUND");
  assert.deepEqual(service.calls.signed, []);
});

test("attachment download checks thread access before signing (another practice → NOT_FOUND)", async () => {
  const service = recordFilesStub();
  const messaging = labMessagingWithFiles(service);
  const t = await messaging.createThread(d1, { body: "Hello", files: [pdf("a.pdf")] });
  await assert.rejects(messaging.attachmentUrl(d4, "rf1"), (e) => e.code === "NOT_FOUND");
  assert.deepEqual(service.calls.signed, []);
  const ok = await messaging.attachmentUrl(d2, "rf1");
  assert.deepEqual(ok, { url: "https://signed.example/rf1", fileId: "rf1", threadId: t.id });
});

test("createLabMessageFiles.remove removes each file through record-files", async () => {
  const service = recordFilesStub();
  await createLabMessageFiles({ service }).remove({}, ["a", "b"]);
  assert.deepEqual(service.calls.removed, ["a", "b"]);
});

test("auditAttachmentRead logs ids only", () => {
  const logged = [];
  auditAttachmentRead({ user: { id: "s1" }, ip: "1.2.3.4" }, { fileId: "rf1", threadId: "t1" }, (e) => logged.push(e));
  assert.deepEqual(logged, [{ userId: "s1", action: "message.attachment_url_issued", targetType: "message_thread", targetId: "t1", metadata: { fileId: "rf1" }, ipAddress: "1.2.3.4" }]);
});

test("opening a thread clears its message.received alert, so the next reply emails again", async () => {
  notifications.clearEvents();
  for (const def of labEventDefs()) notifications.defineNotificationEvent(def);
  const emails = [];
  const notifier = notifications.createNotifier({
    store: notifications.createFakeStore(),
    resolveAudience: async (_db, a) => (a.party === "practice:P1" ? [{ id: "d1", email: "d1@party.test", kind: "client" }] : []),
    channels: { email: { send: async (m) => { emails.push(m); return true; } } },
    log: quiet,
  });
  const messaging = createLabMessaging({
    db: fakeRootDb(), labName: "Test Lab", log: quiet,
    notify: (db, a) => notifier.notify(db, a),
    markRead: (db, userId, a) => notifier.markReadFor(db, userId, a),
    overrides: { store: createFakeStore(), describeParty: async () => new Map(), describeUsers: async () => new Map() },
  });
  const t = await messaging.createThread(staff, { party: "practice:P1", body: "One" });
  await messaging.post(staff, t.id, { body: "Two" });
  assert.equal(emails.length, 1, "the second post collapsed into the unread alert");
  await messaging.getThread(d1, t.id);
  await messaging.post(staff, t.id, { body: "Three" });
  assert.equal(emails.length, 2, "after the thread was read, the next reply emails again");
  notifications.clearEvents();
});

test("a failing markRead does not fail opening the thread", async () => {
  const messaging = createLabMessaging({
    db: fakeRootDb(), labName: "Test Lab", log: quiet, notify: async () => {},
    markRead: async () => { throw new Error("boom"); },
    overrides: { store: createFakeStore(), describeParty: async () => new Map(), describeUsers: async () => new Map() },
  });
  const t = await messaging.createThread(staff, { party: "practice:P1", body: "One" });
  assert.equal((await messaging.getThread(d1, t.id)).messages.length, 1);
});
