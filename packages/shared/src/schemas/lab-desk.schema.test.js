import { test } from "vitest";
import assert from "node:assert/strict";
import { labOrderCreateSchema, labLineEditSchema, labPricePreviewSchema } from "./lab-desk.schema.js";

test("quick entry needs only a practice and a patient; defaults fill the rest", () => {
  const out = labOrderCreateSchema.parse({ clientUserId: "doc1", patientName: "  Jane Roe " });
  assert.deepEqual(out, { clientUserId: "doc1", patientName: "Jane Roe", rush: false, lines: [], tagIds: [] });
  assert.equal(labOrderCreateSchema.safeParse({ clientUserId: "doc1", patientName: "   " }).success, false);
  assert.equal(labOrderCreateSchema.safeParse({ patientName: "Jane" }).success, false);
});

test("full entry reuses the production-desk field rules", () => {
  const ok = labOrderCreateSchema.safeParse({
    clientUserId: "doc1", patientName: "Jane", dueDate: "2026-11-19", pan: "A12", deliveryMethod: "ups",
    enclosures: [{ kind: "model" }], lines: [{ variantId: "v1", qty: 2, arch: "upper" }, { variantId: "v2", noteOnly: true }],
  });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data.lines[1], { variantId: "v2", qty: 1, noteOnly: true });
  for (const bad of [
    { deliveryMethod: "pigeon" }, { pan: "x".repeat(31) }, { enclosures: [{ kind: "model" }, { kind: "model" }] },
    { lines: [{ variantId: "v1", qty: 100 }] }, { lines: [{ variantId: "v1", arch: "middle" }] }, { dueDate: "11/19/2026" },
  ]) assert.equal(labOrderCreateSchema.safeParse({ clientUserId: "doc1", patientName: "Jane", ...bad }).success, false, JSON.stringify(bad));
});

test("line edits carry the version they were made against", () => {
  assert.equal(labLineEditSchema.safeParse({ op: "add", variantId: "v1", expectedVersion: 3 }).data.qty, 1);
  assert.equal(labLineEditSchema.safeParse({ op: "update", lineId: "l1", qty: 2, expectedVersion: 3 }).success, true);
  assert.equal(labLineEditSchema.safeParse({ op: "update", lineId: "l1", qty: 0, expectedVersion: 3 }).success, false);
  assert.equal(labLineEditSchema.safeParse({ op: "remove", lineId: "l1" }).success, false);
  assert.equal(labPricePreviewSchema.safeParse({ clientUserId: "doc1", lines: [] }).success, false);
});
