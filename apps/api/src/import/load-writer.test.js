import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";
import { insertMissing } from "./load-writer.js";

const rows = [{ id: "1", key: "a" }, { id: "2", key: "b" }, { id: "3", key: "c" }];
const keyOf = (r) => r.key;

test("only rows whose key is not already there are inserted", async () => {
  const tx = fakeTx();
  const r = await insertMissing(tx, {}, rows, { keyOf, existingKeys: new Set(["b"]) });
  const inserts = tx.log.filter((e) => e.op === "insert");
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].values.map((v) => v.key), ["a", "c"]);
  assert.deepEqual([...r.insertedIds], ["1", "3"]);
  assert.equal(r.skipped, 1);
});

test("a re-run inserts nothing new", async () => {
  const tx = fakeTx();
  const r = await insertMissing(tx, {}, rows, { keyOf, existingKeys: new Set(["a", "b", "c"]) });
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.equal(r.insertedIds.size, 0);
  assert.equal(r.skipped, 3);
});

test("batches, and counts rows the database refused as conflicts", async () => {
  const many = Array.from({ length: 1100 }, (_, i) => ({ id: String(i), key: `k${i}` }));
  const tx = fakeTx();
  await insertMissing(tx, {}, many, { keyOf, existingKeys: new Set(), batch: 500 });
  assert.equal(tx.log.filter((e) => e.op === "insert").length, 3);

  const returning = { insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: "1" }] }) }) }) };
  const r = await insertMissing(returning, { id: "id" }, rows, { keyOf, existingKeys: new Set() });
  assert.deepEqual([...r.insertedIds], ["1"]);
  assert.equal(r.conflicts, 2);
});
