import { test } from "vitest";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/pg-proxy";
import { createDrizzleStore } from "./store.js";

// A real drizzle query builder over a recording driver: we see the exact SQL
// postgres would get, with no database.
function recordingDb(rows = []) {
  const calls = [];
  const db = drizzle(async (sql, params, method) => {
    calls.push({ sql, params, method });
    return { rows };
  });
  return { db, calls };
}

test("upsertInApp collapses on the unread partial unique index and reports whether it inserted", async () => {
  const { db, calls } = recordingDb([["n1", true]]);
  const store = createDrizzleStore();
  const r = await store.upsertInApp(db, {
    id: "n1", userId: "u1", event: "thing.happened", recordType: "widget", recordId: "w1",
    title: "Thing 7 happened", link: "/things/7", collapseKey: "thing.happened:widget:w1",
  });
  assert.deepEqual(r, { id: "n1", inserted: true });
  const sql = calls[0].sql.replace(/\s+/g, " ");
  assert.match(sql, /^insert into "notifications"/);
  assert.match(sql, /on conflict \("user_id","collapse_key"\) where read_at is null do update set/);
  assert.match(sql, /"count" = "notifications"."count" \+ 1/);
  assert.match(sql, /"updated_at" = now\(\)/);
  assert.match(sql, /returning "id", \(xmax = 0\)/);
});

test("upsertInApp reports a collapse (xmax <> 0) as not inserted", async () => {
  const { db } = recordingDb([["n0", false]]);
  const r = await createDrizzleStore().upsertInApp(db, {
    id: "n1", userId: "u1", event: "e.x", recordType: null, recordId: null, title: "t", link: null, collapseKey: "e.x::",
  });
  assert.deepEqual(r, { id: "n0", inserted: false });
});

test("markUnread refuses when another unread row holds the same collapse key", async () => {
  const { db, calls } = recordingDb([]);
  const ok = await createDrizzleStore().markUnread(db, "u1", "n1");
  assert.equal(ok, false);
  assert.match(calls[0].sql.replace(/\s+/g, " "), /not exists \(select 1 from "notifications" "n2" where/);
});

test("pruneDeliveries deletes rows older than the given days", async () => {
  const { db, calls } = recordingDb([]);
  await createDrizzleStore().pruneDeliveries(db, 90);
  assert.match(calls[0].sql, /^delete from "notification_deliveries" where "notification_deliveries"."created_at" < now\(\) - /);
  assert.ok(calls[0].params.includes(90));
});
