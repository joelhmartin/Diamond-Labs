import { test } from "vitest";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/pg-proxy";
import { createDrizzleStore } from "./store.js";

// A real drizzle query builder over a recording driver: we see the exact SQL
// postgres would get, with no database.
function recordingDb(rows = []) {
  const calls = [];
  const db = drizzle(async (sql, params, method) => {
    calls.push({ sql: sql.replace(/\s+/g, " "), params, method });
    return { rows };
  });
  return { db, calls };
}

const base = { userId: "u1", side: "party", partyKeys: ["user:u1", "org:1"], folder: { archived: false }, limit: 20, offset: 0 };

test("listThreads computes unread in SQL against the caller's read state and totals with count(*) over()", async () => {
  const { db, calls } = recordingDb([]);
  await createDrizzleStore().listThreads(db, base);
  const { sql, params } = calls[0];
  assert.match(sql, /left join "message_participants" on \("message_participants"."thread_id" = "message_threads"."id" and "message_participants"."user_id" = \$\d+\)/);
  assert.match(sql, /"message_threads"."last_message_side" <> \$\d+ and "message_threads"."last_message_at" > coalesce\("message_participants"."last_read_at", '-infinity'::timestamptz\)/);
  assert.match(sql, /count\(\*\) over\(\)/);
  assert.match(sql, /"message_threads"."party_key" in \(\$\d+, \$\d+\)/);
  assert.match(sql, /"message_participants"."archived_at" is null/);
  assert.match(sql, /order by "message_threads"."last_message_at" desc/);
  assert.ok(params.includes("u1") && params.includes("party") && params.includes("org:1"));
});

test("listThreads: host folders, unread-only, record and match filters", async () => {
  const { db, calls } = recordingDb([]);
  await createDrizzleStore().listThreads(db, {
    ...base, side: "host", partyKeys: null, folder: { completed: true }, unreadOnly: true,
    recordType: "widget", recordId: "w1", party: "org:2",
    match: { partyKeys: ["org:3"], records: [{ recordType: "widget", recordId: "w9" }] },
  });
  const { sql } = calls[0];
  assert.doesNotMatch(sql, /"party_key" in \(\$\d+, \$\d+\)/, "a host sees every party");
  assert.match(sql, /"message_threads"."completed_at" is not null/);
  assert.match(sql, /"message_threads"."record_type" = \$\d+ and "message_threads"."record_id" = \$\d+/);
  assert.match(sql, /\("message_threads"."party_key" in \(\$\d+\) or \("message_threads"."record_type" = \$\d+ and "message_threads"."record_id" = \$\d+\)\)/);
  // unread-only repeats the unread predicate in the where clause
  assert.equal(sql.match(/coalesce\("message_participants"."last_read_at"/g).length, 2);
});

test("an empty match short-circuits to no rows without querying", async () => {
  const { db, calls } = recordingDb([]);
  const r = await createDrizzleStore().listThreads(db, { ...base, match: { partyKeys: [], records: [] } });
  assert.deepEqual(r, { rows: [], total: 0 });
  assert.equal(calls.length, 0);
});

test("unreadCount uses the same unread predicate and visibility", async () => {
  const { db, calls } = recordingDb([[2]]);
  assert.equal(await createDrizzleStore().unreadCount(db, { userId: "u1", side: "party", partyKeys: ["org:1"] }), 2);
  assert.match(calls[0].sql, /^select count\(\*\)::int from "message_threads" left join "message_participants"/);
  assert.match(calls[0].sql, /coalesce\("message_participants"."last_read_at", '-infinity'::timestamptz\)/);
  assert.match(calls[0].sql, /"message_threads"."party_key" in \(\$\d+\)/);
});

test("recordPost bumps message_count in SQL; touchParticipant upserts on (thread_id, user_id)", async () => {
  const store = createDrizzleStore();
  const a = recordingDb([]);
  await store.recordPost(a.db, "t1", { lastMessageAt: new Date(), lastMessageSide: "host", updatedAt: new Date() });
  assert.match(a.calls[0].sql, /"message_count" = "message_threads"."message_count" \+ 1/);
  assert.match(a.calls[1].sql, /^update "message_participants" set "archived_at" = \$1 where \("message_participants"."thread_id" = \$2 and "message_participants"."side" <> \$3 and "message_participants"."archived_at" is not null\)/);
  assert.deepEqual(a.calls[1].params, [null, "t1", "host"]);
  const b = recordingDb([]);
  await store.touchParticipant(b.db, { threadId: "t1", userId: "u1", side: "host" }, { lastReadAt: new Date() });
  assert.match(b.calls[0].sql, /^insert into "message_participants"/);
  assert.match(b.calls[0].sql, /on conflict \("thread_id","user_id"\) do update set "last_read_at" = \$\d+/);
  const c = recordingDb([]);
  await store.touchParticipant(c.db, { threadId: "t1", userId: "u1", side: "host" }, {});
  assert.match(c.calls[0].sql, /on conflict do nothing/);
});

test("listMessages is oldest first", async () => {
  const { db, calls } = recordingDb([]);
  await createDrizzleStore().listMessages(db, "t1");
  assert.match(calls[0].sql, /where "messages"."thread_id" = \$1 order by "messages"."created_at", "messages"."id"/);
});
