import { test } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ||= "a".repeat(64);

const { createMessaging, MessagingError } = await import("./index.js");
const { createFakeStore } = await import("./fake-store.js");

const host = { id: "h1", role: "staff", name: "Hana Host" };
const host2 = { id: "h2", role: "staff", name: "Hugo Host" };
const partyA = { id: "p1", role: "member", org: "1", name: "Pat Party" };
const partyB = { id: "p2", role: "member", org: "2", name: "Pia Party" };

const isHost = (u) => u.role === "staff";
const partyKeysFor = (u) => [`user:${u.id}`, ...(u.org ? [`org:${u.org}`] : [])];
const defaultPartyKey = (u) => (u.org ? `org:${u.org}` : `user:${u.id}`);

// A record type the host app would own: widget w1 belongs to org:1.
const records = {
  widget: {
    async resolve(_db, id, user) {
      if (id !== "w1") return null;
      const r = { label: "Widget 7", partyKey: "org:1", hostPath: "/host/widgets/w1", partyPath: "/widgets/w1" };
      return isHost(user) || partyKeysFor(user).includes(r.partyKey) ? r : null;
    },
  },
};

function setup(over = {}) {
  const store = createFakeStore();
  const db = { transaction: async (fn) => fn(db) };
  const events = [];
  let clock = Date.parse("2026-11-05T10:00:00Z");
  const messaging = createMessaging({
    db, store, records, isHost, partyKeysFor, defaultPartyKey,
    describeParty: async (_db, keys) => new Map(keys.map((k) => [k, `Party ${k}`])),
    describeUsers: async (_db, ids) => new Map(ids.map((id) => [id, [host, host2, partyA, partyB].find((u) => u.id === id)?.name])),
    onMessage: async (evt) => { events.push(evt); },
    now: () => new Date((clock += 1000)),
    log: { error() {}, warn() {} },
    ...over,
  });
  return { store, db, events, messaging };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => err instanceof MessagingError && err.code === code);
}

test("createThread with a record uses the resolver's partyKey; resolver null → NOT_FOUND", async () => {
  const { messaging, store } = setup();
  const t = await messaging.createThread(host, { recordType: "widget", recordId: "w1", body: "Hello" });
  assert.equal(t.partyKey, "org:1");
  assert.equal(t.recordLabel, "Widget 7");
  assert.equal(store.state.threads[0].partyKey, "org:1");
  await rejectsWith(messaging.createThread(host, { recordType: "widget", recordId: "nope", body: "x" }), "NOT_FOUND");
  await rejectsWith(messaging.createThread(partyB, { recordType: "widget", recordId: "w1", body: "x" }), "NOT_FOUND");
  await rejectsWith(messaging.createThread(host, { recordType: "gadget", recordId: "g1", body: "x" }), "INVALID");
});

test("host general thread requires party; party general thread uses defaultPartyKey", async () => {
  const { messaging } = setup();
  await rejectsWith(messaging.createThread(host, { body: "Hi" }), "INVALID");
  const h = await messaging.createThread(host, { party: "org:2", body: "Hi" });
  assert.equal(h.partyKey, "org:2");
  assert.equal(h.recordType, null);
  const p = await messaging.createThread(partyA, { party: "org:9", body: "Hi" });
  assert.equal(p.partyKey, "org:1", "a party user's party comes from defaultPartyKey, never the body");
});

test("body and subject are stored sealed (enc:v1) and returned opened", async () => {
  const { messaging, store } = setup();
  const t = await messaging.createThread(partyA, { subject: "Color question", body: "Is blue right?" });
  assert.match(store.state.threads[0].subject, /^enc:v1:/);
  assert.match(store.state.messages[0].body, /^enc:v1:/);
  assert.equal(t.subject, "Color question");
  const { thread, messages } = await messaging.getThread(host, t.id);
  assert.equal(thread.subject, "Color question");
  assert.equal(messages[0].body, "Is blue right?");
  assert.deepEqual(messages[0].attachments, [], "the attachment seam is an empty list for now");
  const listed = await messaging.listThreads(host, {});
  assert.equal(listed.rows[0].subject, "Color question");
});

test("body over 5000 chars or blank → INVALID", async () => {
  const { messaging } = setup();
  await rejectsWith(messaging.createThread(partyA, { body: "x".repeat(5001) }), "INVALID");
  await rejectsWith(messaging.createThread(partyA, { body: "   " }), "INVALID");
  const t = await messaging.createThread(partyA, { body: "ok" });
  await rejectsWith(messaging.post(partyA, t.id, { body: "x".repeat(5001) }), "INVALID");
  await rejectsWith(messaging.createThread(partyA, { body: "ok", subject: "s".repeat(201) }), "INVALID");
});

test("party user cannot read a thread outside their party keys (NOT_FOUND, not FORBIDDEN)", async () => {
  const { messaging } = setup();
  const t = await messaging.createThread(partyA, { body: "mine" });
  await rejectsWith(messaging.getThread(partyB, t.id), "NOT_FOUND");
  await rejectsWith(messaging.post(partyB, t.id, { body: "x" }), "NOT_FOUND");
  await rejectsWith(messaging.setRead(partyB, t.id, true), "NOT_FOUND");
  await rejectsWith(messaging.archive(partyB, t.id, true), "NOT_FOUND");
  await rejectsWith(messaging.getThread(partyA, "missing"), "NOT_FOUND");
  assert.equal((await messaging.listThreads(partyB, {})).total, 0);
  assert.equal((await messaging.listThreads(partyB, { party: "org:1" })).total, 0, "a party filter cannot widen visibility");
});

test("getThread marks read; unreadCount drops", async () => {
  const { messaging } = setup();
  const t = await messaging.createThread(partyA, { body: "first" });
  assert.equal(await messaging.unreadCount(host), 1);
  assert.equal(await messaging.unreadCount(partyA), 0, "own post is not unread");
  assert.equal((await messaging.listThreads(host, { unread: true })).total, 1);
  await messaging.getThread(host, t.id);
  assert.equal(await messaging.unreadCount(host), 0);
  assert.equal(await messaging.unreadCount(host2), 1, "read state is per user");
  await messaging.post(host, t.id, { body: "reply" });
  assert.equal(await messaging.unreadCount(partyA), 1);
  await messaging.setRead(partyA, t.id, true);
  assert.equal(await messaging.unreadCount(partyA), 0);
  await messaging.setRead(partyA, t.id, false);
  assert.equal(await messaging.unreadCount(partyA), 1);
});

test("getThread returns messages oldest first with author names and sides", async () => {
  const { messaging } = setup();
  const t = await messaging.createThread(partyA, { body: "one" });
  await messaging.post(host, t.id, { body: "two" });
  const { thread, messages } = await messaging.getThread(partyA, t.id);
  assert.deepEqual(messages.map((m) => [m.body, m.authorSide, m.authorName]), [["one", "party", "Pat Party"], ["two", "host", "Hana Host"]]);
  assert.equal(thread.messageCount, 2);
  assert.equal(thread.partyLabel, "Party org:1");
});

test("onMessage runs after the post and a throwing onMessage does not fail the post", async () => {
  const { messaging, events } = setup();
  const t = await messaging.createThread(host, { recordType: "widget", recordId: "w1", subject: "secret subject", body: "secret body" });
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.authorSide, "host");
  assert.equal(e.authorUserId, "h1");
  assert.equal(e.recordLabel, "Widget 7");
  assert.equal(e.thread.id, t.id);
  assert.equal(e.thread.partyKey, "org:1");
  assert.ok(!JSON.stringify(e).includes("secret"), "the hook never sees free text");

  const failing = setup({ onMessage: async () => { throw new Error("boom"); } });
  const t2 = await failing.messaging.createThread(partyA, { body: "hi" });
  const m = await failing.messaging.post(partyA, t2.id, { body: "again" });
  assert.equal(m.body, "again");
  assert.equal(failing.store.state.messages.length, 2);
});

test("onOpen runs after a successful getThread with ids only; a throwing onOpen does not fail the read", async () => {
  const opened = [];
  const { messaging } = setup({ onOpen: async (evt) => { opened.push(evt); } });
  const t = await messaging.createThread(host, { recordType: "widget", recordId: "w1", subject: "secret subject", body: "secret body" });
  await messaging.getThread(partyA, t.id);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].userId, "p1");
  assert.equal(opened[0].side, "party");
  assert.equal(opened[0].thread.id, t.id);
  assert.equal(opened[0].thread.recordType, "widget");
  assert.equal(opened[0].thread.recordId, "w1");
  assert.ok(!JSON.stringify(opened[0]).includes("secret"), "the hook never sees free text");
  await rejectsWith(messaging.getThread(partyB, t.id), "NOT_FOUND");
  assert.equal(opened.length, 1, "no hook for a thread the caller cannot read");

  const logs = [];
  const failing = setup({
    onOpen: async () => { throw new Error("boom for p1@party.test"); },
    log: { error: (m) => logs.push(m), warn: (m) => logs.push(m) },
  });
  const t2 = await failing.messaging.createThread(partyA, { body: "hi" });
  const read = await failing.messaging.getThread(partyA, t2.id);
  assert.equal(read.messages.length, 1);
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes("boom"), "only the error name is logged");
});

test("complete/reopen refuse a party user; a party post reopens", async () => {
  const { messaging } = setup();
  const t = await messaging.createThread(partyA, { body: "hi" });
  await rejectsWith(messaging.complete(partyA, t.id), "FORBIDDEN");
  await rejectsWith(messaging.reopen(partyA, t.id), "FORBIDDEN");
  await messaging.complete(host, t.id);
  assert.equal((await messaging.listThreads(host, { folder: "completed" })).total, 1);
  assert.equal((await messaging.listThreads(host, { folder: "inbox" })).total, 0);
  await messaging.post(partyA, t.id, { body: "one more thing" });
  assert.equal((await messaging.listThreads(host, { folder: "inbox" })).total, 1);
  await messaging.complete(host, t.id);
  await messaging.reopen(host, t.id);
  assert.equal((await messaging.listThreads(host, {})).rows[0].completedAt, null);
});

test("archive is per user and drives the party folders", async () => {
  const { messaging } = setup();
  const t = await messaging.createThread(partyA, { body: "hi" });
  await messaging.archive(partyA, t.id, true);
  assert.equal((await messaging.listThreads(partyA, { folder: "inbox" })).total, 0);
  const archived = await messaging.listThreads(partyA, { folder: "archived" });
  assert.equal(archived.total, 1);
  assert.ok(archived.rows[0].archivedAt instanceof Date);
  await messaging.archive(partyA, t.id, false);
  assert.equal((await messaging.listThreads(partyA, { folder: "inbox" })).total, 1);
  await rejectsWith(messaging.listThreads(partyA, { folder: "completed" }), "INVALID");
  await rejectsWith(messaging.listThreads(host, { folder: "archived" }), "INVALID");
});

test("a post from the other side brings an archived thread back to the inbox", async () => {
  const { messaging } = setup();
  const t = await messaging.createThread(partyA, { body: "hi" });
  await messaging.archive(partyA, t.id, true);
  await messaging.post(partyA, t.id, { body: "own post keeps it filed" });
  assert.equal((await messaging.listThreads(partyA, { folder: "archived" })).total, 1);
  await messaging.post(host, t.id, { body: "reply" });
  assert.equal((await messaging.listThreads(partyA, { folder: "archived" })).total, 0);
  const inbox = await messaging.listThreads(partyA, { folder: "inbox" });
  assert.equal(inbox.total, 1);
  assert.equal(inbox.rows[0].archivedAt, null);
});

test("getThread marks read only up to the messages it returned", async () => {
  const { messaging, store } = setup();
  const t = await messaging.createThread(partyA, { body: "first" });
  const list = store.listMessages;
  let raced = false;
  // A party post lands after the host's fetch and before the read mark.
  store.listMessages = async (...args) => {
    const rows = await list(...args);
    if (!raced) {
      raced = true;
      await messaging.post(partyA, t.id, { body: "late" });
    }
    return rows;
  };
  const { messages } = await messaging.getThread(host, t.id);
  assert.deepEqual(messages.map((m) => m.body), ["first"]);
  assert.equal(await messaging.unreadCount(host), 1, "the unseen late post stays unread");
  store.listMessages = list;
  await messaging.getThread(host, t.id);
  assert.equal(await messaging.unreadCount(host), 0);
});

test("list filters by record and party, pages with a total, and labels rows", async () => {
  const { messaging } = setup();
  await messaging.createThread(host, { recordType: "widget", recordId: "w1", body: "a" });
  await messaging.createThread(host, { party: "org:2", body: "b" });
  await messaging.createThread(host, { party: "org:2", body: "c" });
  const byRecord = await messaging.listThreads(host, { recordType: "widget", recordId: "w1" });
  assert.equal(byRecord.total, 1);
  assert.equal(byRecord.rows[0].recordLabel, "Widget 7");
  assert.equal(byRecord.rows[0].partyLabel, "Party org:1");
  const page = await messaging.listThreads(host, { party: "org:2", limit: 1, offset: 0 });
  assert.equal(page.total, 2);
  assert.equal(page.rows.length, 1);
  assert.deepEqual(Object.keys(page.rows[0]).sort(), [
    "archivedAt", "completedAt", "id", "lastMessageAt", "lastMessageSide", "messageCount", "partyKey", "partyLabel",
    "recordId", "recordLabel", "recordType", "subject", "unread",
  ]);
});

test("q searches only what the search collaborator matches; without one it matches nothing", async () => {
  const search = async (_db, q) => (q === "acme" ? { partyKeys: ["org:2"], records: [] } : { partyKeys: [], records: [{ recordType: "widget", recordId: "w1" }] });
  const { messaging } = setup({ search });
  await messaging.createThread(host, { recordType: "widget", recordId: "w1", body: "a" });
  await messaging.createThread(host, { party: "org:2", body: "b" });
  assert.equal((await messaging.listThreads(host, { q: "acme" })).rows[0].partyKey, "org:2");
  assert.equal((await messaging.listThreads(host, { q: "Widget" })).rows[0].recordId, "w1");
  const bare = setup();
  await bare.messaging.createThread(host, { party: "org:2", body: "b" });
  assert.equal((await bare.messaging.listThreads(host, { q: "acme" })).total, 0);
});

// ── Attachments (the files collaborator) ────────────────────────────────────

// An in-memory files collaborator: rows keyed by message id; `removed` shows
// what a failed post cleaned up.
function fakeFiles() {
  const f = { rows: [], attached: [], removed: [], signed: [] };
  const meta = (r) => ({ id: r.id, fileName: r.fileName, contentType: r.contentType, sizeBytes: r.sizeBytes });
  f.attach = async (_db, { recordId, files, byUserId }) => {
    f.attached.push({ recordId, byUserId, count: files.length });
    const out = files.map((x) => {
      const r = { id: `f${f.rows.length + 1}`, recordId, fileName: x.originalName, contentType: x.contentType ?? null, sizeBytes: x.buffer.length, storage: "gs://secret" };
      f.rows.push(r);
      return r;
    });
    return out.map(meta);
  };
  f.listFor = async (_db, ids) => {
    const m = new Map();
    for (const r of f.rows) if (ids.includes(r.recordId)) m.set(r.recordId, [...(m.get(r.recordId) ?? []), r]);
    return m;
  };
  f.find = async (_db, id) => {
    const r = f.rows.find((x) => x.id === id);
    return r ? { id: r.id, messageId: r.recordId } : null;
  };
  f.signedUrl = async (_db, id) => { f.signed.push(id); return `https://signed.example/${id}`; };
  f.remove = async (_db, ids) => { f.removed.push(...ids); f.rows = f.rows.filter((r) => !ids.includes(r.id)); };
  return f;
}
const upload = (name, bytes = 3) => ({ buffer: Buffer.alloc(bytes), originalName: name, contentType: "application/pdf" });

test("post with files stores them through the files collaborator under the message id", async () => {
  const files = fakeFiles();
  const { messaging, store } = setup({ files });
  const t = await messaging.createThread(partyA, { body: "see attached", files: [upload("a.pdf")] });
  const m = await messaging.post(host, t.id, { body: "two more", files: [upload("b.pdf"), upload("c.pdf", 5)] });
  const [first, second] = store.state.messages;
  assert.deepEqual(files.attached, [
    { recordId: first.id, byUserId: "p1", count: 1 },
    { recordId: second.id, byUserId: "h1", count: 2 },
  ]);
  assert.deepEqual(m.attachments.map((a) => [a.fileName, a.sizeBytes]), [["b.pdf", 3], ["c.pdf", 5]]);
  const plain = await messaging.post(host, t.id, { body: "no files" });
  assert.deepEqual(plain.attachments, []);
  assert.equal(files.attached.length, 2, "no files → the collaborator is not called");
});

test("more than 5 files → INVALID; an oversize file → INVALID; no files collaborator + files → INVALID", async () => {
  const files = fakeFiles();
  const { messaging, store } = setup({ files });
  const six = Array.from({ length: 6 }, (_, i) => upload(`${i}.pdf`));
  await rejectsWith(messaging.createThread(partyA, { body: "x", files: six }), "INVALID");
  const t = await messaging.createThread(partyA, { body: "x" });
  await rejectsWith(messaging.post(partyA, t.id, { body: "x", files: six }), "INVALID");
  await rejectsWith(messaging.post(partyA, t.id, { body: "x", files: [upload("big.pdf", 20 * 1024 * 1024 + 1)] }), "INVALID");
  assert.equal(files.attached.length, 0);
  assert.equal(store.state.messages.length, 1);

  const bare = setup();
  const t2 = await bare.messaging.createThread(partyA, { body: "x" });
  await rejectsWith(bare.messaging.post(partyA, t2.id, { body: "x", files: [upload("a.pdf")] }), "INVALID");
  await rejectsWith(bare.messaging.createThread(partyA, { body: "x", files: [upload("a.pdf")] }), "INVALID");
  assert.deepEqual((await bare.messaging.getThread(partyA, t2.id)).messages[0].attachments, []);
});

test("getThread returns attachment metadata per message (fileName, contentType, sizeBytes) and never storage urls", async () => {
  const files = fakeFiles();
  const { messaging } = setup({ files });
  const t = await messaging.createThread(partyA, { body: "one", files: [upload("scan.pdf", 7)] });
  await messaging.post(host, t.id, { body: "two" });
  const { messages } = await messaging.getThread(host, t.id);
  assert.deepEqual(messages[0].attachments, [{ id: "f1", fileName: "scan.pdf", contentType: "application/pdf", sizeBytes: 7 }]);
  assert.deepEqual(messages[1].attachments, []);
  assert.ok(!JSON.stringify(messages).includes("gs://"), "no storage url leaves the service");
});

test("attachment download checks thread access before signing", async () => {
  const files = fakeFiles();
  const { messaging } = setup({ files });
  const t = await messaging.createThread(partyA, { body: "one", files: [upload("scan.pdf")] });
  await rejectsWith(messaging.attachmentUrl(partyB, "f1"), "NOT_FOUND");
  assert.deepEqual(files.signed, [], "the signer never runs for someone who cannot read the thread");
  assert.deepEqual(await messaging.attachmentUrl(host, "f1"), { url: "https://signed.example/f1", fileId: "f1", threadId: t.id });
  assert.equal((await messaging.attachmentUrl(partyA, "f1")).url, "https://signed.example/f1");
  await rejectsWith(messaging.attachmentUrl(host, "missing"), "NOT_FOUND");
  await rejectsWith(setup().messaging.attachmentUrl(host, "f1"), "NOT_FOUND");
});

test("a file whose message is gone → NOT_FOUND, never signed", async () => {
  const files = fakeFiles();
  const { messaging } = setup({ files });
  files.rows.push({ id: "orphan", recordId: "no-such-message", fileName: "x", contentType: null, sizeBytes: 1 });
  await rejectsWith(messaging.attachmentUrl(host, "orphan"), "NOT_FOUND");
  assert.deepEqual(files.signed, []);
});

test("a failed post leaves no uploaded objects", async () => {
  const files = fakeFiles();
  const { messaging, store } = setup({ files });
  const t = await messaging.createThread(partyA, { body: "one" });
  store.recordPost = async () => { throw new Error("db down"); };
  await assert.rejects(messaging.post(partyA, t.id, { body: "two", files: [upload("a.pdf"), upload("b.pdf")] }), /db down/);
  assert.deepEqual(files.removed, ["f1", "f2"]);
  assert.equal(files.rows.length, 0);

  const other = fakeFiles();
  const failing = setup({ files: other });
  failing.store.insertThread = async () => { throw new Error("insert failed"); };
  await assert.rejects(failing.messaging.createThread(partyA, { body: "x", files: [upload("a.pdf")] }), /insert failed/);
  assert.deepEqual(other.removed, ["f1"]);
  assert.equal(other.rows.length, 0);
});
