import { test } from "vitest";
import assert from "node:assert/strict";
import { createMemoryFavoritesStore } from "../modules/reports/favorites.service.js";
import { createRecordStarsFavoritesStore, REPORT_RECORD_TYPE } from "./report-favorites.js";

/** record-tags stars in memory, logging every call with the db it was given. */
function fakeStars() {
  const calls = [];
  const starred = new Map();
  return {
    calls,
    async starsFor(recordType, ids, userId, db) {
      calls.push({ op: "starsFor", recordType, ids, userId, db });
      const mine = starred.get(`${recordType}|${userId}`) ?? new Set();
      return new Set(ids.filter((id) => mine.has(id)));
    },
    async setStar({ recordType, recordId, userId, starred: on }, db) {
      calls.push({ op: "setStar", recordType, recordId, userId, starred: on, db });
      const k = `${recordType}|${userId}`;
      if (!starred.has(k)) starred.set(k, new Set());
      if (on) starred.get(k).add(recordId); else starred.get(k).delete(recordId);
      return { starred: on };
    },
  };
}

test("favorites adapter stars reports as record type \"report\" with the report key as id, in the caller's db", async () => {
  const stars = fakeStars();
  const store = createRecordStarsFavoritesStore({ keys: () => ["a.one", "a.two", "b.three"], stars });
  const db = { name: "tx" };
  assert.equal(REPORT_RECORD_TYPE, "report");

  await store.set(db, "u1", "a.two", true);
  await store.set(db, "u1", "b.three", 1);
  await store.set(db, "u2", "a.one", true);
  await store.set(db, "u1", "b.three", false);
  assert.deepEqual(await store.listKeys(db, "u1"), new Set(["a.two"]));
  assert.deepEqual(await store.listKeys(db, "u2"), new Set(["a.one"]));

  assert.deepEqual(stars.calls[0], { op: "setStar", recordType: "report", recordId: "a.two", userId: "u1", starred: true, db });
  assert.equal(stars.calls[1].starred, true, "truthy values become a real boolean");
  const list = stars.calls.find((c) => c.op === "starsFor");
  assert.deepEqual(list.ids, ["a.one", "a.two", "b.three"], "every registered key is looked up");
  assert.ok(stars.calls.every((c) => c.db === db && c.recordType === "report"));
});

test("favorites adapter keeps the memory store's contract", async () => {
  const stars = fakeStars();
  const keys = ["k1", "k2"];
  for (const store of [createMemoryFavoritesStore(), createRecordStarsFavoritesStore({ keys: () => keys, stars })]) {
    assert.deepEqual(await store.listKeys({}, "u"), new Set());
    await store.set({}, "u", "k2", true);
    assert.deepEqual(await store.listKeys({}, "u"), new Set(["k2"]));
    await store.set({}, "u", "k2", false);
    assert.deepEqual(await store.listKeys({}, "u"), new Set());
  }
});
