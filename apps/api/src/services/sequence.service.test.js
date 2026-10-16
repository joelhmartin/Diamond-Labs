import { test } from "vitest";
import assert from "node:assert/strict";
import { allocateSequenceNumber } from "./sequence.service.js";

function fakeTx(max) {
  const ops = [];
  return {
    ops,
    execute: async (q) => { ops.push({ op: "execute", q }); },
    select: () => ({ from: async () => { ops.push({ op: "select" }); return [{ max }]; } }),
  };
}

test("takes the sequence's own advisory lock before reading the max", async () => {
  const tx = fakeTx(500041);
  const n = await allocateSequenceNumber(tx, { lockId: 7300422, table: {}, column: {}, start: 500000 });
  assert.equal(n, 500042);
  assert.deepEqual(tx.ops.map((o) => o.op), ["execute", "select"]);
  const lockSql = tx.ops[0].q.queryChunks.flatMap((c) => c.value ?? []).join("");
  assert.match(lockSql, /pg_advisory_xact_lock\(7300422\)/);
});

test("an empty table starts at the configured number", async () => {
  assert.equal(await allocateSequenceNumber(fakeTx(null), { lockId: 1, table: {}, column: {}, start: 500000 }), 500000);
});

test("refuses a non-integer lock id (it is interpolated into SQL)", async () => {
  await assert.rejects(allocateSequenceNumber(fakeTx(null), { lockId: "1; drop", table: {}, column: {}, start: 1 }), RangeError);
});
