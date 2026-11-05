import { test } from "vitest";
import assert from "node:assert/strict";
import { canRead, sideOf, isUnreadFor, folderWhere, afterPost } from "./rules.js";

const thread = (over = {}) => ({
  id: "t1", partyKey: "org:1", lastMessageSide: "party", lastMessageAt: new Date("2026-11-05T10:00:00Z"), completedAt: null, ...over,
});

test("host reads every thread; party reads only its party keys", () => {
  assert.equal(canRead({ id: "h" }, thread(), { isHost: true, partyKeys: [] }), true);
  assert.equal(canRead({ id: "p" }, thread(), { isHost: false, partyKeys: ["user:p", "org:1"] }), true);
  assert.equal(canRead({ id: "p" }, thread(), { isHost: false, partyKeys: ["user:p", "org:2"] }), false);
  assert.equal(canRead({ id: "p" }, null, { isHost: true, partyKeys: [] }), false);
  assert.equal(sideOf({ id: "h" }, true), "host");
  assert.equal(sideOf({ id: "p" }, () => false), "party");
});

test("unread when the other side posted after last_read_at", () => {
  const t = thread();
  assert.equal(isUnreadFor(t, null, "host"), true, "never opened");
  assert.equal(isUnreadFor(t, { lastReadAt: null }, "host"), true);
  assert.equal(isUnreadFor(t, { lastReadAt: new Date("2026-11-05T09:59:59Z") }, "host"), true);
  assert.equal(isUnreadFor(t, { lastReadAt: new Date("2026-11-05T10:00:00Z") }, "host"), false);
});

test("own last post is never unread", () => {
  assert.equal(isUnreadFor(thread({ lastMessageSide: "host" }), null, "host"), false);
  assert.equal(isUnreadFor(thread({ lastMessageSide: "party" }), { lastReadAt: null }, "party"), false);
});

test("party post clears completedAt; host post does not", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const done = thread({ completedAt: new Date("2026-11-05T11:00:00Z"), completedByUserId: "h" });
  const p = afterPost(done, "party", now);
  assert.equal(p.completedAt, null);
  assert.equal(p.completedByUserId, null);
  assert.equal(p.lastMessageSide, "party");
  assert.equal(p.lastMessageAt, now);
  const h = afterPost(done, "host", now);
  assert.ok(!("completedAt" in h), "a host post leaves completion alone");
  assert.equal(h.lastMessageSide, "host");
});

test("inbox/completed for host, inbox/archived for party", () => {
  assert.deepEqual(folderWhere("inbox", "host"), { completed: false });
  assert.deepEqual(folderWhere("completed", "host"), { completed: true });
  assert.equal(folderWhere("archived", "host"), null);
  assert.deepEqual(folderWhere("inbox", "party"), { archived: false });
  assert.deepEqual(folderWhere("archived", "party"), { archived: true });
  assert.equal(folderWhere("completed", "party"), null);
  assert.deepEqual(folderWhere(undefined, "host"), { completed: false }, "inbox is the default");
});
