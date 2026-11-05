import { test } from "vitest";
import assert from "node:assert/strict";
import { attachFiles, filesFor, relinkFiles, signedUrlFor, removeFile, FileError } from "./service.js";

// Minimal drizzle-shaped fake: records calls, returns canned rows.
function fakeDb({ insertFails = false, rows = [], updated = [] } = {}) {
  const calls = { inserted: [], set: null };
  const chain = (result) => {
    const c = { from: () => c, where: () => c, orderBy: () => c, returning: () => c, then: (res, rej) => Promise.resolve(result).then(res, rej) };
    return c;
  };
  return {
    calls,
    insert: () => ({
      values: (v) => {
        calls.inserted = v;
        return { returning: async () => { if (insertFails) throw new Error("insert boom"); return v.map((r) => ({ ...r, createdAt: new Date(0) })); } };
      },
    }),
    select: () => chain(rows),
    update: () => ({ set: (s) => { calls.set = s; return chain(updated); } }),
    delete: () => chain(rows),
  };
}

const row = { id: "f1", recordType: "widget", recordId: "w1", kind: "scan", originalName: "a.stl", storageUrl: "gs://b/secret", contentType: "model/stl", size: 3, createdAt: new Date(0) };

function fakeStorage() {
  const s = { uploaded: [], deleted: [] };
  s.upload = async (o) => { s.uploaded.push(o); return { gcsUrl: `gs://b/${s.uploaded.length}`, size: o.buffer.length }; };
  s.deleteObject = async (u) => { s.deleted.push(u); };
  return s;
}

const file = { kind: "scan", buffer: Buffer.from("abc"), originalName: "a.stl", contentType: "model/stl" };

test("attachFiles deletes uploaded objects when the insert fails", async () => {
  const storage = fakeStorage();
  await assert.rejects(
    () => attachFiles({ recordType: "widget", recordId: "w1", files: [file, file], byUserId: "u1", storage }, fakeDb({ insertFails: true })),
    /insert boom/,
  );
  assert.equal(storage.uploaded.length, 2);
  assert.deepEqual(storage.deleted, ["gs://b/1", "gs://b/2"]);
});

test("attachFiles uploads under the record id, inserts, and returns clean rows", async () => {
  const storage = fakeStorage();
  const db = fakeDb();
  const out = await attachFiles({ recordType: "widget", recordId: "w1", files: [file], byUserId: "u1", storage }, db);
  assert.equal(storage.uploaded[0].ownerId, "w1");
  assert.equal(db.calls.inserted[0].createdBy, "u1");
  assert.equal(out.length, 1);
  assert.equal("storageUrl" in out[0], false);
});

test("attachFiles cleans up objects already uploaded when a later upload fails", async () => {
  const storage = fakeStorage();
  let n = 0;
  const inner = storage.upload;
  storage.upload = async (o) => { if (++n === 2) throw new Error("gcs down"); return inner(o); };
  await assert.rejects(() => attachFiles({ recordType: "widget", recordId: "w1", files: [file, file], storage }, fakeDb()), /gcs down/);
  assert.deepEqual(storage.deleted, ["gs://b/1"]);
});

test("relinkFiles moves rows without touching storage", async () => {
  const db = fakeDb({ updated: [{ id: "f1" }, { id: "f2" }] });
  const count = await relinkFiles(db, { fromType: "a", fromId: "1", toType: "b", toId: "2" });
  assert.equal(count, 2);
  assert.deepEqual(db.calls.set, { recordType: "b", recordId: "2" });
});

test("rows returned never include storageUrl", async () => {
  const map = await filesFor("widget", ["w1"], fakeDb({ rows: [row] }));
  assert.equal(map.get("w1").length, 1);
  assert.equal("storageUrl" in map.get("w1")[0], false);
  assert.equal((await filesFor("widget", [], fakeDb())).size, 0);
});

test("signedUrlFor signs the stored url and returns the clean file; unknown id is NOT_FOUND", async () => {
  const signed = [];
  const out = await signedUrlFor("f1", { sign: async (u, ttl) => { signed.push([u, ttl]); return "https://signed"; } }, fakeDb({ rows: [row] }));
  assert.equal(out.url, "https://signed");
  assert.deepEqual(signed, [["gs://b/secret", 300]]);
  assert.equal("storageUrl" in out.file, false);
  await assert.rejects(() => signedUrlFor("nope", {}, fakeDb({ rows: [] })), (e) => e instanceof FileError && e.code === "NOT_FOUND");
});

test("removeFile deletes the row then the object", async () => {
  const storage = fakeStorage();
  await removeFile("f1", { storage }, fakeDb({ rows: [row] }));
  assert.deepEqual(storage.deleted, ["gs://b/secret"]);
  await assert.rejects(() => removeFile("nope", { storage }, fakeDb({ rows: [] })), (e) => e.code === "NOT_FOUND");
});
