import { test } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
const { promoteIntakeIn } = await import("./lab-intake.js");
const { LabOrderError } = await import("./lab-order-rules.js");
const { fakeTx } = await import("../../test/fake-tx.js");

test("promoteIntakeIn claims the intake for the lab order and relinks its files", async () => {
  const tx = fakeTx({ updates: [[{ id: "i1" }], []] });
  await promoteIntakeIn(tx, "i1", { labOrderId: "o1", byUserId: "u1" });
  const sets = tx.log.filter((e) => e.op === "set").map((e) => e.values);
  assert.equal(sets[0].promotedRecordType, "lab_order");
  assert.equal(sets[0].promotedRecordId, "o1");
  assert.deepEqual(sets[1], { recordType: "lab_order", recordId: "o1" });
});

test("a used intake refuses the order entry with Already used", async () => {
  const tx = fakeTx({ updates: [[]], selects: [[{ status: "promoted" }]] });
  await assert.rejects(() => promoteIntakeIn(tx, "i1", { labOrderId: "o1" }), (e) => e instanceof LabOrderError && e.code === "INVALID" && /Already used/.test(e.message));
});

test("an unknown intake is NOT_FOUND", async () => {
  const tx = fakeTx({ updates: [[]], selects: [[]] });
  await assert.rejects(() => promoteIntakeIn(tx, "x", { labOrderId: "o1" }), (e) => e instanceof LabOrderError && e.code === "NOT_FOUND");
});
