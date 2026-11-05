import { test } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
const { applyTags } = await import("./service.js");
const { fakeTx } = await import("../../test/fake-tx.js");

test("applyTags hands onChange the changes and who made them, inside the transaction", async () => {
  const def = { id: "t1", recordType: "widget", label: "Urgent", color: "red", position: 0, active: true };
  const tx = fakeTx({ selects: [[def], []] });
  let seen;
  const out = await applyTags({
    recordType: "widget", ids: ["w1"], add: ["t1"], remove: [], byUserId: "u1",
    exists: async (ids) => new Set(ids),
    onChange: async (inTx, changes, meta) => { seen = { inTx, changes, meta }; },
  }, tx);
  assert.deepEqual(out, { ok: true, failed: [] });
  assert.equal(seen.inTx, tx);
  assert.deepEqual(seen.changes.map((c) => [c.recordId, c.added.map((t) => t.id)]), [["w1", ["t1"]]]);
  assert.deepEqual(seen.meta, { byUserId: "u1" });
});
