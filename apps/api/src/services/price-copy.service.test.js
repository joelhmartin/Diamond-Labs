import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { fakeTx, fakeDb } from "../test/fake-tx.js";

vi.mock("../config/database.js", () => ({ db: {} }));

const svc = await import("./price-copy.service.js");
const { PriceCopyError } = svc;

const inserts = (tx) => tx.log.filter((l) => l.op === "insert").map((l) => l.values);
const audits = (tx) => inserts(tx).filter((v) => v && !Array.isArray(v) && v.action);
const errCode = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof PriceCopyError, String(e)); return e.code; } assert.fail("expected PriceCopyError"); };

const USERS = [{ id: "src", role: "doctor" }, { id: "t1", role: "doctor" }, { id: "t2", role: "doctor" }];
// Select order of the batched loader: users, overrides, assignments, list items.
const loaded = ({ users = USERS, overrides = [], assigned = [], items = [] } = {}) => [users, overrides, assigned, items];
const OV = [
  { clientUserId: "src", variantId: "v1", priceCents: 500 },
  { clientUserId: "t1", variantId: "v1", priceCents: 450 },
  { clientUserId: "t1", variantId: "v9", priceCents: 100 },
];
const body = { fromClientUserId: "src", toClientUserIds: ["t1", "t2"], mode: "replace" };

test("preview diffs each target by effective price and reports lists before and after", async () => {
  const tx = fakeTx({ selects: loaded({
    overrides: OV,
    assigned: [
      { clientUserId: "src", listId: "L1", name: "Gold", archivedAt: null, position: 0 },
      { clientUserId: "t1", listId: "L2", name: "Silver", archivedAt: null, position: 0 },
    ],
    items: [{ listId: "L1", variantId: "v2", priceCents: 800 }, { listId: "L2", variantId: "v3", priceCents: 700 }],
  }) });
  const out = await svc.previewCopy(body, fakeDb(tx));
  assert.match(out.previewHash, /^[0-9a-f]{64}$/);
  const t1 = out.targets.find((t) => t.clientUserId === "t1");
  assert.deepEqual(t1.changes, [
    { variantId: "v1", beforeCents: 450, beforeSource: "client", afterCents: 500, afterSource: "client" },
    { variantId: "v2", beforeCents: null, beforeSource: "base", afterCents: 800, afterSource: "list" },
    { variantId: "v3", beforeCents: 700, beforeSource: "list", afterCents: null, afterSource: "base" },
    { variantId: "v9", beforeCents: 100, beforeSource: "client", afterCents: null, afterSource: "base" },
  ]);
  assert.deepEqual(t1.listsBefore.map((l) => l.name), ["Silver"]);
  assert.deepEqual(t1.listsAfter.map((l) => l.name), ["Gold"]);
  const t2 = out.targets.find((t) => t.clientUserId === "t2");
  assert.deepEqual(t2.changes.map((c) => c.variantId), ["v1", "v2"]);
  assert.equal(tx.log.filter((l) => l.op === "insert" || l.op === "update" || l.op === "delete").length, 0, "preview writes nothing");
});

test("merge keeps a target's archived list and reports it archived after the copy", async () => {
  const tx = fakeTx({ selects: loaded({
    assigned: [
      { clientUserId: "src", listId: "L1", name: "Gold", archivedAt: null, position: 0 },
      { clientUserId: "t1", listId: "L9", name: "Old", archivedAt: new Date(), position: 0 },
    ],
    items: [{ listId: "L1", variantId: "v2", priceCents: 800 }],
  }) });
  const out = await svc.previewCopy({ ...body, toClientUserIds: ["t1"], mode: "merge" }, fakeDb(tx));
  assert.deepEqual(out.targets[0].listsAfter.map((l) => [l.name, l.archived]), [["Old", true], ["Gold", false]]);
  assert.deepEqual(out.targets[0].changes.map((c) => [c.variantId, c.afterCents]), [["v2", 800]]);
});

test("copying a client onto itself is INVALID", async () => {
  const tx = fakeTx();
  assert.equal(await errCode(svc.previewCopy({ ...body, toClientUserIds: ["t1", "src"] }, fakeDb(tx))), "INVALID");
});

test("more than 200 targets is INVALID", async () => {
  const ids = Array.from({ length: 201 }, (_, i) => `t${i}`);
  assert.equal(await errCode(svc.previewCopy({ ...body, toClientUserIds: ids }, fakeDb(fakeTx()))), "INVALID");
});

test("apply with a stale previewHash is refused", async () => {
  const fresh = fakeTx({ selects: loaded({ overrides: OV }) });
  const { previewHash } = await svc.previewCopy(body, fakeDb(fresh));
  // The source's price moved after the preview.
  const moved = OV.map((r) => (r.clientUserId === "src" ? { ...r, priceCents: 510 } : r));
  const tx = fakeTx({ selects: loaded({ overrides: moved }) });
  assert.equal(await errCode(svc.applyCopy({ ...body, previewHash, byUserId: "admin1" }, fakeDb(tx))), "STALE");
  assert.equal(inserts(tx).length, 0, "nothing written");
  assert.equal(tx.log.filter((l) => l.op === "delete").length, 0);
});

test("apply writes copied, reviewed overrides with no note, removes target-only ones and audits per target", async () => {
  const { previewHash } = await svc.previewCopy(body, fakeDb(fakeTx({ selects: loaded({ overrides: OV }) })));
  const tx = fakeTx({ selects: loaded({ overrides: OV }) });
  const out = await svc.applyCopy({ ...body, previewHash, byUserId: "admin1" }, fakeDb(tx));
  assert.deepEqual(out, { ok: 2, failed: [] });
  const rows = inserts(tx).filter(Array.isArray).flat();
  assert.deepEqual(rows.map((r) => [r.clientUserId, r.variantId, r.priceCents, r.source, r.note, r.reviewedBy]), [
    ["t1", "v1", 500, "copied", null, "admin1"],
    ["t2", "v1", 500, "copied", null, "admin1"],
  ]);
  assert.ok(rows.every((r) => r.reviewedAt instanceof Date));
  assert.equal(tx.log.filter((l) => l.op === "delete").length, 1, "t1's target-only override is removed");
  const a = audits(tx).filter((v) => v.action === "client_price.copied");
  assert.deepEqual(a.map((v) => [v.targetId, v.metadata]), [
    ["t1", { fromClientUserId: "src", toClientUserId: "t1", mode: "replace", changeCount: 2 }],
    ["t2", { fromClientUserId: "src", toClientUserId: "t2", mode: "replace", changeCount: 1 }],
  ]);
});

test("a non-client target is reported in failed and left out of the plan", async () => {
  const users = [...USERS, { id: "s1", role: "lab" }];
  const b = { ...body, toClientUserIds: ["t1", "s1"] };
  const out = await svc.previewCopy(b, fakeDb(fakeTx({ selects: loaded({ users, overrides: OV }) })));
  assert.deepEqual(out.targets.map((t) => t.clientUserId), ["t1"]);
  assert.deepEqual(out.failed, [{ id: "s1", message: "Not a client" }]);
});
