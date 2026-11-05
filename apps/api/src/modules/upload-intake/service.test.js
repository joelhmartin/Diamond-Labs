import { test } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
const { createIntakes, listIntakes, discardIntake, promoteIntake } = await import("./service.js");
const { IntakeError } = await import("./rules.js");
const { decryptField } = await import("../../lib/crypto.js");
const { fakeTx } = await import("../../test/fake-tx.js");

function fakeStorage() {
  const s = { uploaded: [] };
  s.upload = async (o) => { s.uploaded.push(o); return { gcsUrl: `gs://b/${s.uploaded.length}`, size: o.buffer.length }; };
  s.deleteObject = async () => {};
  return s;
}
const file = (originalName) => ({ kind: "scan", buffer: Buffer.from("abc"), originalName });

// The intake inserts are the ones whose values carry a `status`/`channel`; file rows carry `recordType`.
const intakeInserts = (tx) => tx.log.filter((e) => e.op === "insert" && e.values && "channel" in e.values).map((e) => e.values);

test("per_file split makes one intake per file", async () => {
  const tx = fakeTx();
  const out = await createIntakes({ files: [file("a.stl"), file("b.stl")], split: "per_file", byUserId: "u1", storage: fakeStorage() }, tx);
  assert.equal(out.intakes.length, 2);
  assert.equal(intakeInserts(tx).length, 2);
  assert.deepEqual(out.refused, []);
});

test("one split makes a single intake", async () => {
  const tx = fakeTx();
  const out = await createIntakes({ files: [file("a.stl"), file("b.stl"), file("c.pdf")], split: "one", storage: fakeStorage() }, tx);
  assert.equal(out.intakes.length, 1);
  assert.equal(out.intakes[0].status, "pending");
  assert.equal(out.intakes[0].channel, "upload");
});

test("a .exe is refused by name and the rest proceed", async () => {
  const tx = fakeTx();
  const storage = fakeStorage();
  const out = await createIntakes({ files: [file("a.stl"), file("evil.exe")], split: "one", storage }, tx);
  assert.equal(out.intakes.length, 1);
  assert.deepEqual(out.refused.map((r) => r.name), ["evil.exe"]);
  assert.equal(storage.uploaded.length, 1);
});

test("hints are sealed at rest", async () => {
  const tx = fakeTx();
  await createIntakes({ files: [file("jane-doe-upper.stl")], split: "one", storage: fakeStorage() }, tx);
  const [row] = intakeInserts(tx);
  assert.ok(!String(row.hints).includes("jane-doe"), "the stored hints must not contain the file name");
  assert.deepEqual(JSON.parse(decryptField(row.hints)), { files: ["jane-doe-upper.stl"] });
});

test("a failed upload leaves no intake row behind and is reported by name", async () => {
  const tx = fakeTx();
  const storage = fakeStorage();
  storage.upload = async () => { throw new Error("bucket down"); };
  const out = await createIntakes({ files: [file("a.stl")], split: "one", storage }, tx);
  assert.equal(out.intakes.length, 0);
  assert.deepEqual(out.refused.map((r) => r.name), ["a.stl"]);
  assert.equal(intakeInserts(tx).length, 0, "no pending row when the upload fails");
});

test("a failed upload is logged without file names", async () => {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a);
  try {
    const storage = fakeStorage();
    storage.upload = async () => { throw new Error("bucket down"); };
    await createIntakes({ files: [file("jane-doe.stl")], split: "one", storage }, fakeTx());
  } finally { console.error = orig; }
  assert.equal(logged.length, 1);
  assert.ok(!JSON.stringify(logged).includes("jane-doe"));
  assert.match(JSON.stringify(logged), /bucket down/);
});

test("promote claims a pending intake and relinks its files", async () => {
  const tx = fakeTx({ updates: [[{ id: "i1" }], [{ id: "f1" }]] });
  await promoteIntake(tx, "i1", { recordType: "widget", recordId: "w1", byUserId: "u1" });
  const sets = tx.log.filter((e) => e.op === "set").map((e) => e.values);
  assert.equal(sets[0].status, "promoted");
  assert.equal(sets[0].promotedRecordType, "widget");
  assert.equal(sets[0].promotedRecordId, "w1");
  assert.equal(sets[0].decidedBy, "u1");
  assert.deepEqual(sets[1], { recordType: "widget", recordId: "w1" });
});

test("promote twice fails the second time", async () => {
  // The conditional update matches nothing (already promoted); the row is then read to say why.
  const tx = fakeTx({ updates: [[]], selects: [[{ status: "promoted" }]] });
  await assert.rejects(() => promoteIntake(tx, "i1", { recordType: "widget", recordId: "w2" }), (e) => e instanceof IntakeError && /Already used/.test(e.message));
  assert.ok(!tx.log.some((e) => e.op === "set" && e.values.recordType), "files must not be relinked");
});

test("discarded intake cannot be promoted", async () => {
  const tx = fakeTx({ updates: [[]], selects: [[{ status: "discarded" }]] });
  await assert.rejects(() => promoteIntake(tx, "i1", { recordType: "widget", recordId: "w1" }), (e) => e instanceof IntakeError && e.code === "CONFLICT" && /discarded/.test(e.message));
});

test("promoting an unknown intake is NOT_FOUND", async () => {
  const tx = fakeTx({ updates: [[]], selects: [[]] });
  await assert.rejects(() => promoteIntake(tx, "nope", { recordType: "widget", recordId: "w1" }), (e) => e.code === "NOT_FOUND");
});

test("discard seals the reason and only touches pending intakes", async () => {
  const tx = fakeTx({ updates: [[{ id: "i1" }]] });
  await discardIntake("i1", { reason: "duplicate of Jane Doe", byUserId: "u1" }, tx);
  const set = tx.log.find((e) => e.op === "set").values;
  assert.equal(set.status, "discarded");
  assert.ok(!set.discardReason.includes("Jane"));
  assert.equal(decryptField(set.discardReason), "duplicate of Jane Doe");
});

test("discarding an already-decided intake is a conflict", async () => {
  const tx = fakeTx({ updates: [[]], selects: [[{ status: "promoted" }]] });
  await assert.rejects(() => discardIntake("i1", {}, tx), (e) => e.code === "CONFLICT");
});

test("listIntakes returns opened hints, files and the total", async () => {
  const { encryptField } = await import("../../lib/crypto.js");
  const row = { id: "i1", channel: "upload", status: "pending", parserKey: "generic", hints: encryptField(JSON.stringify({ files: ["a.stl"] })), createdBy: "u1", createdAt: new Date(0), discardReason: null };
  const tx = fakeTx({ selects: [[row], [{ total: 7 }], [{ id: "f1", recordType: "intake", recordId: "i1", kind: "scan", originalName: "a.stl", size: 3, createdAt: new Date(0) }]] });
  const out = await listIntakes({ status: "pending", limit: 20, offset: 0 }, tx);
  assert.equal(out.total, 7);
  assert.deepEqual(out.rows[0].hints, { files: ["a.stl"] });
  assert.equal(out.rows[0].files.length, 1);
  assert.equal("discardReason" in out.rows[0], false);
});
