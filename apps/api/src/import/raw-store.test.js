process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";

const { encryptJson, encryptField } = await import("../lib/crypto.js");
const store = await import("./raw-store.js");

test("upsert seals each payload whole and batches by 500", async () => {
  const tx = fakeTx();
  const records = Array.from({ length: 1200 }, (_, i) => ({ seazonaId: `s${i}`, payload: { id: `s${i}`, patient: "Test Patient" }, lastModified: "2026-10-01T00:00:00" }));
  assert.equal(await store.upsertRecords(tx, { entity: "invoice", records, runId: "r1" }), 1200);
  const inserts = tx.log.filter((e) => e.op === "insert");
  assert.equal(inserts.length, 3);
  const first = inserts[0].values[0];
  assert.equal(first.entity, "invoice");
  assert.equal(first.seazonaId, "s0");
  assert.equal(first.fetchRunId, "r1");
  assert.match(first.payload, /^enc:v1:/);
  assert.ok(!JSON.stringify(inserts).includes("Test Patient"), "no plaintext payload reaches the insert");
});

test("records open on read; the index opens nothing", async () => {
  const tx = fakeTx({ selects: [[{ seazonaId: "s1", payload: encryptJson({ id: "s1", total: 12.5 }), lastModified: "x", fetchedAt: new Date(0) }]] });
  const [r] = await store.readRecords(tx, "invoice");
  assert.deepEqual(r.payload, { id: "s1", total: 12.5 });
  const idx = await store.recordIndex(fakeTx({ selects: [[{ seazonaId: "s1", lastModified: "x" }, { seazonaId: "s2", lastModified: null }]] }), "invoice");
  assert.deepEqual([...idx], [["s1", "x"], ["s2", null]]);
});

test("an export file is stored sealed, once per content", async () => {
  const bytes = Buffer.from("<table><tr><td>1324</td></tr></table>");
  const fresh = fakeTx({ selects: [[]] });
  const id = await store.saveFile(fresh, { kind: "balances_invoice", bytes });
  const insert = fresh.log.find((e) => e.op === "insert");
  assert.equal(insert.values.id, id);
  assert.match(insert.values.content, /^enc:v1:/);
  assert.match(insert.values.sha256, /^[0-9a-f]{64}$/);

  const again = fakeTx({ selects: [[{ id: "f-existing" }]] });
  assert.equal(await store.saveFile(again, { kind: "balances_invoice", bytes }), "f-existing");
  assert.equal(again.log.some((e) => e.op === "insert"), false);

  const read = await store.readFile(fakeTx({ selects: [[{ kind: "balances_invoice", content: encryptField(bytes.toString("base64")) }]] }), "f1");
  assert.equal(read.bytes.toString(), bytes.toString());
});

test("a fetch run records counts and its resume cursor", async () => {
  const tx = fakeTx();
  const id = await store.startRun(tx, { entity: "invoice_detail", mode: "detail", plannedIds: ["a", "b"] });
  await store.saveProgress(tx, id, { cursor: 1, requestCount: 1, errorCount: 0 });
  await store.finishRun(tx, id, { status: "blocked", cursor: 1, requestCount: 2, errorCount: 1, lastStatus: 403 });
  const insert = tx.log.find((e) => e.op === "insert");
  assert.deepEqual(insert.values.plannedIds, ["a", "b"]);
  assert.equal(insert.values.status, "running");
  const sets = tx.log.filter((e) => e.op === "set").map((e) => e.values);
  assert.equal(sets[0].cursor, 1);
  assert.equal(sets[1].status, "blocked");
  assert.equal(sets[1].lastStatus, 403);
  assert.ok(sets[1].finishedAt instanceof Date);
});
