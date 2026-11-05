import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { fakeTx, fakeDb } from "../test/fake-tx.js";

vi.mock("../config/database.js", () => ({ db: {} }));

const svc = await import("./price-lists.service.js");
const { PriceListError } = svc;

const inserts = (tx) => tx.log.filter((l) => l.op === "insert").map((l) => l.values);
const audits = (tx) => inserts(tx).filter((v) => v && !Array.isArray(v) && v.action);
const errCode = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof PriceListError, String(e)); return e.code; } assert.fail("expected PriceListError"); };

const LIST = { id: "L9", name: "Remake", archivedAt: null };

test("bulk assign add appends at lowest precedence and skips a duplicate", async () => {
  const tx = fakeTx({ selects: [
    [LIST],                                                     // the list
    [{ id: "c1", role: "doctor" }, { id: "c2", role: "doctor" }, { id: "c3", role: "doctor" }],
    [                                                           // existing assignments
      { clientUserId: "c1", priceListId: "L1", position: 0 },
      { clientUserId: "c1", priceListId: "L2", position: 1 },
      { clientUserId: "c2", priceListId: "L9", position: 0 },   // already on it
    ],
  ] });
  const out = await svc.assignListToClients({ listId: "L9", clientUserIds: ["c1", "c2", "c3"], mode: "add", byUserId: "admin1" }, fakeDb(tx));
  assert.deepEqual(out, { ok: 3, failed: [] });
  assert.equal(tx.log.filter((l) => l.op === "delete").length, 0, "add never removes an assignment");
  const [rows] = inserts(tx);
  assert.deepEqual(rows.map((r) => [r.clientUserId, r.priceListId, r.position, r.assignedBy]), [
    ["c1", "L9", 2, "admin1"],
    ["c3", "L9", 0, "admin1"],
  ]);
  const [audit] = audits(tx);
  assert.equal(audit.action, "price_list.assigned");
  assert.deepEqual(audit.metadata, { listId: "L9", mode: "add", clientUserIds: ["c1", "c2", "c3"], added: 2, failed: 0 });
});

test("bulk assign replace leaves only that list", async () => {
  const tx = fakeTx({ selects: [
    [LIST],
    [{ id: "c1", role: "doctor" }, { id: "c2", role: "doctor" }],
    [{ clientUserId: "c1", priceListId: "L1", position: 0 }, { clientUserId: "c2", priceListId: "L9", position: 3 }],
  ] });
  const out = await svc.assignListToClients({ listId: "L9", clientUserIds: ["c1", "c2"], mode: "replace", byUserId: "admin1" }, fakeDb(tx));
  assert.deepEqual(out, { ok: 2, failed: [] });
  const ops = tx.log.map((l) => l.op);
  assert.ok(ops.indexOf("delete") >= 0 && ops.indexOf("delete") < ops.indexOf("insert"), "old assignments go first");
  const [rows] = inserts(tx);
  assert.deepEqual(rows.map((r) => [r.clientUserId, r.priceListId, r.position]), [["c1", "L9", 0], ["c2", "L9", 0]]);
});

test("a non-doctor target is reported in failed, others apply", async () => {
  const tx = fakeTx({ selects: [
    [LIST],
    [{ id: "c1", role: "doctor" }, { id: "s1", role: "lab" }],   // "ghost" does not exist
    [],
  ] });
  const out = await svc.assignListToClients({ listId: "L9", clientUserIds: ["c1", "s1", "ghost"], mode: "add", byUserId: "a" }, fakeDb(tx));
  assert.deepEqual(out, { ok: 1, failed: [{ id: "s1", message: "Not a client" }, { id: "ghost", message: "Not a client" }] });
  assert.deepEqual(inserts(tx)[0].map((r) => r.clientUserId), ["c1"]);
});

test("bulk assign refuses an archived or missing list", async () => {
  const archived = fakeTx({ selects: [[{ ...LIST, archivedAt: new Date() }]] });
  assert.equal(await errCode(svc.assignListToClients({ listId: "L9", clientUserIds: ["c1"], mode: "add", byUserId: "a" }, fakeDb(archived))), "INVALID");
  const missing = fakeTx({ selects: [[]] });
  assert.equal(await errCode(svc.assignListToClients({ listId: "L9", clientUserIds: ["c1"], mode: "add", byUserId: "a" }, fakeDb(missing))), "NOT_FOUND");
});

test("setItems refuses more than 500 and negative cents", async () => {
  const many = Array.from({ length: 501 }, (_, i) => ({ variantId: `v${i}`, priceCents: 100 }));
  assert.equal(await errCode(svc.setItems("L1", many, "a", fakeDb(fakeTx()))), "INVALID");
  assert.equal(await errCode(svc.setItems("L1", [{ variantId: "v1", priceCents: -1 }], "a", fakeDb(fakeTx()))), "INVALID");
  assert.equal(await errCode(svc.setItems("L1", [{ variantId: "v1", priceCents: 1.5 }], "a", fakeDb(fakeTx()))), "INVALID");
  assert.equal(await errCode(svc.setItems("L1", [{ variantId: "v1", priceCents: 1 }, { variantId: "v1", priceCents: 2 }], "a", fakeDb(fakeTx()))), "INVALID");
});

test("setItems upserts every row in one transaction and audits a count", async () => {
  const tx = fakeTx({ selects: [[LIST], [{ id: "v1" }, { id: "v2" }]] });
  const out = await svc.setItems("L9", [{ variantId: "v1", priceCents: 1200 }, { variantId: "v2", priceCents: 0 }], "admin1", fakeDb(tx));
  assert.deepEqual(out, { count: 2 });
  const [rows, audit] = inserts(tx);
  assert.deepEqual(rows.map((r) => [r.priceListId, r.variantId, r.priceCents, r.updatedBy]), [["L9", "v1", 1200, "admin1"], ["L9", "v2", 0, "admin1"]]);
  assert.equal(audit.action, "price_list.items_set");
  assert.deepEqual(audit.metadata, { listId: "L9", count: 2 });
});

test("setItems refuses a variant that does not exist", async () => {
  const tx = fakeTx({ selects: [[LIST], [{ id: "v1" }]] });
  assert.equal(await errCode(svc.setItems("L9", [{ variantId: "v1", priceCents: 1 }, { variantId: "nope", priceCents: 1 }], "a", fakeDb(tx))), "INVALID");
  assert.equal(inserts(tx).length, 0);
});

test("a duplicate name (any case) is NAME_TAKEN", async () => {
  const tx = fakeTx({ selects: [[{ id: "L1" }]] });
  assert.equal(await errCode(svc.createPriceList({ name: "standard", byUserId: "a" }, fakeDb(tx))), "NAME_TAKEN");
  const rename = fakeTx({ selects: [[{ id: "L2", name: "Remake", archivedAt: null }], [{ id: "L1" }]] });
  assert.equal(await errCode(svc.updatePriceList("L2", { name: "Standard" }, "a", fakeDb(rename))), "NAME_TAKEN");
});

test("create and archive are audited with ids only", async () => {
  const tx = fakeTx({ selects: [[]] });
  const created = await svc.createPriceList({ name: "Standard", description: "Base list", byUserId: "admin1" }, fakeDb(tx));
  assert.equal(created.name, "Standard");
  const [row, audit] = inserts(tx);
  assert.equal(row.createdBy, "admin1");
  assert.deepEqual([audit.action, audit.targetType, audit.targetId], ["price_list.created", "price_list", row.id]);

  const up = fakeTx({ selects: [[{ id: "L1", name: "Standard", archivedAt: null }]], updates: [[{ id: "L1", name: "Standard", archivedAt: new Date() }]] });
  await svc.updatePriceList("L1", { archived: true }, "admin1", fakeDb(up));
  assert.ok(up.log.find((l) => l.op === "set").values.archivedAt instanceof Date);
  assert.deepEqual(audits(up)[0].metadata, { fields: ["archived"], archived: true });
});

test("setClientLists replaces the assignment with positions in array order", async () => {
  const tx = fakeTx({ selects: [
    [{ id: "c1", role: "doctor" }],
    [{ id: "L2", archivedAt: null }, { id: "L1", archivedAt: null }],
    [],                                                         // current assignment
  ] });
  await svc.setClientLists("c1", ["L2", "L1"], "admin1", fakeDb(tx));
  const [rows, audit] = inserts(tx);
  assert.deepEqual(rows.map((r) => [r.priceListId, r.position]), [["L2", 0], ["L1", 1]]);
  assert.deepEqual(audit.metadata, { clientUserId: "c1", listIds: ["L2", "L1"] });
  assert.equal(await errCode(svc.setClientLists("c1", ["L1", "L1"], "a", fakeDb(fakeTx()))), "INVALID");
  const lab = fakeTx({ selects: [[{ id: "s1", role: "lab" }]] });
  assert.equal(await errCode(svc.setClientLists("s1", ["L1"], "a", fakeDb(lab))), "INVALID");
});

test("setClientLists keeps an archived list already assigned but refuses adding one", async () => {
  const keep = fakeTx({ selects: [[{ id: "c1", role: "doctor" }], [{ id: "L1", archivedAt: new Date() }], [{ priceListId: "L1" }]] });
  await svc.setClientLists("c1", ["L1"], "a", fakeDb(keep));
  const add = fakeTx({ selects: [[{ id: "c1", role: "doctor" }], [{ id: "L1", archivedAt: new Date() }], []] });
  assert.equal(await errCode(svc.setClientLists("c1", ["L1"], "a", fakeDb(add))), "INVALID");
});

/** A db whose awaited select chains pop queued results. */
function queuedDb(selects) {
  const chain = () => new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (res, rej) => Promise.resolve(selects.shift() ?? []).then(res, rej);
      return () => chain();
    },
  });
  return { select: () => chain() };
}

test("clients on a list carry name, account number and first active practice", async () => {
  const out = await svc.listClients("L1", queuedDb([
    [LIST],
    [
      { id: "c1", name: "Ana", email: "a@x.test", accountNumber: "10", position: 0, assignedAt: "t" },
      { id: "c2", name: null, email: "b@x.test", accountNumber: null, position: 1, assignedAt: "t" },
    ],
    [{ userId: "c1", practice: "Ruiz Dental" }, { userId: "c1", practice: "Second" }],
  ]));
  assert.deepEqual(out.map((r) => [r.id, r.name, r.practice, r.accountNumber]), [
    ["c1", "Ana", "Ruiz Dental", "10"],
    ["c2", "b@x.test", null, null],
  ]);
});

test("clients of an unknown list is NOT_FOUND", async () => {
  assert.equal(await errCode(svc.listClients("zz", queuedDb([[]]))), "NOT_FOUND");
});
