import { test } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
const { onLabOrderTagsChanged } = await import("./lab-tags.js");
const { decryptField } = await import("../../lib/crypto.js");
const { fakeTx } = await import("../../test/fake-tx.js");

const tag = (label) => ({ id: `t-${label}`, label });
const eventsOf = (tx) => tx.log.filter((l) => l.op === "insert").flatMap((l) => [].concat(l.values));

test("onChange writes one sealed label event per change, by the caller", async () => {
  const tx = fakeTx();
  await onLabOrderTagsChanged(tx, [
    { recordId: "lo-1", added: [tag("Rush check")], removed: [] },
    { recordId: "lo-2", added: [], removed: [tag("Hold for Dr")] },
  ], { byUserId: "u1" });
  const events = eventsOf(tx);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => [e.labOrderId, e.type, e.to, e.byUserId]), [
    ["lo-1", "label", "Rush check", "u1"],
    ["lo-2", "label", "Hold for Dr", "u1"],
  ]);
  assert.deepEqual(events.map((e) => decryptField(e.note)), ["Label added", "Label removed"]);
  assert.ok(events.every((e) => e.id), "sealEvent assigns an id");
});

test("onChange writes nothing for an apply that changed nothing", async () => {
  const tx = fakeTx();
  await onLabOrderTagsChanged(tx, [], { byUserId: "u1" });
  await onLabOrderTagsChanged(tx, [{ recordId: "lo-1", added: [], removed: [] }], { byUserId: "u1" });
  assert.equal(eventsOf(tx).length, 0);
});

test("a label longer than the event column is cut to 128", async () => {
  const tx = fakeTx();
  await onLabOrderTagsChanged(tx, [{ recordId: "lo-1", added: [tag("x".repeat(200))], removed: [] }], {});
  assert.equal(eventsOf(tx)[0].to.length, 128);
  assert.equal(eventsOf(tx)[0].byUserId, null);
});
