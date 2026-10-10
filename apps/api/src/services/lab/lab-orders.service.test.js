import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
const source = readFileSync(fileURLToPath(new URL("./lab-orders.service.js", import.meta.url)), "utf8");
const mod = await import("./lab-orders.service.js");
const { LabOrderError } = await import("./lab-order-rules.js");
const { decryptField } = await import("../../lib/crypto.js");

test("the service exposes what the routes, release and checkout call", () => {
  for (const name of [
    "allocateOrderNumber", "releaseRxCase", "createShopLabOrder", "listLabOrders", "getLabOrderDetail",
    "labOrdersForCases", "changeStatus", "changeField", "remakeOrder", "listAssignableStaff",
  ]) assert.equal(typeof mod[name], "function", name);
});

test("every mutation is conditional on the version the caller saw (no lost updates)", () => {
  assert.match(source, /eq\(labOrders\.version, order\.version\)/);
  assert.match(source, /assertFresh\(/);
});

test("order numbers are allocated under a transaction-scoped advisory lock", () => {
  assert.match(source, /pg_advisory_xact_lock\(\d+\)/);
});

test("a release claims the case before inserting, so a double click can't make two jobs", () => {
  const body = source.slice(source.indexOf("export async function releaseRxCase"), source.indexOf("export async function createShopLabOrder"));
  assert.ok(body.indexOf('status: "released"') < body.indexOf("insertPlan("), "claim must precede the insert");
});

test("hold reasons, lab notes and event notes are sealed on write and opened on read", () => {
  assert.match(source, /SECRET_ORDER_FIELDS = \["holdReason", "labNotes"\]/);
  assert.match(source, /encryptField/);
  assert.match(source, /decryptField/);
});

test("stored values are opened before the planners compare old vs new", () => {
  const body = source.slice(source.indexOf("async function mutate"), source.indexOf("async function assertAssignable"));
  assert.ok(body.indexOf("openOrder(row)") < body.indexOf("plan(order"), "decrypt before planning");
});

test("staff roles and the board summary have one definition each", () => {
  assert.match(source, /STAFF_ROLES[^;]*from "@my-app\/shared"/s);
  assert.doesNotMatch(source, /const STAFF_ROLES/);
  assert.doesNotMatch(source, /seazona\.service|seazonaapi|fetch\(/i);
});

// ── Behaviour, against a recording fake of the drizzle transaction surface ──

/** Chainable, awaitable stub. Each select/update await pops the next queued result. */
function fakeTx({ selects = [], updates = [] } = {}) {
  const log = [];
  const chain = (kind, queue, record) => {
    const b = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (res, rej) => Promise.resolve(queue ? queue.shift() ?? [] : undefined).then(res, rej);
        return (...args) => { if (record) record(prop, args); return b; };
      },
    });
    return b;
  };
  const tx = {
    log,
    execute: async (q) => { log.push({ op: "execute" }); return q; },
    select: () => { log.push({ op: "select" }); return chain("select", selects); },
    update: () => { log.push({ op: "update" }); return chain("update", updates, (m, a) => m === "set" && log.push({ op: "set", values: a[0] })); },
    insert: () => {
      const entry = { op: "insert" };
      log.push(entry);
      return chain("insert", null, (m, a) => { if (m === "values") entry.values = a[0]; });
    },
  };
  return tx;
}
const fakeDb = (tx) => ({ transaction: (fn) => fn(tx) });
const baseRow = { id: "lo-1", orderNumber: 100001, status: "received", version: 3, holdReason: null, labNotes: null };

test("mutate: an UPDATE that matches no row (someone else won the race) throws STALE", async () => {
  const tx = fakeTx({ selects: [[baseRow]], updates: [[]] });
  const plan = () => ({ patch: { version: 4 }, event: { labOrderId: "lo-1", type: "note", note: null, at: new Date() } });
  await assert.rejects(mod.mutate("lo-1", 3, plan, fakeDb(tx)), (e) => e instanceof LabOrderError && e.code === "STALE");
  assert.equal(tx.log.filter((l) => l.op === "insert").length, 0, "no event for a lost update");
});

test("mutate: a stale expectedVersion is refused before any write", async () => {
  const tx = fakeTx({ selects: [[baseRow]] });
  await assert.rejects(mod.mutate("lo-1", 2, () => ({}), fakeDb(tx)), (e) => e instanceof LabOrderError);
  assert.equal(tx.log.filter((l) => l.op === "update" || l.op === "insert").length, 0);
});

test("mutate: patch secrets and event notes are sealed on write; the returned order is opened", async () => {
  const secret = "patient Jane Roe, remake the upper";
  const sealed = await import("../../lib/crypto.js");
  const tx = fakeTx({ selects: [[baseRow]], updates: [[{ ...baseRow, version: 4, labNotes: sealed.encryptField(secret) }]] });
  const plan = () => ({
    patch: { labNotes: secret, holdReason: secret, version: 4 },
    event: { labOrderId: "lo-1", type: "hold", note: secret, at: new Date() },
  });
  const out = await mod.mutate("lo-1", 3, plan, fakeDb(tx));
  const set = tx.log.find((l) => l.op === "set").values;
  const ins = tx.log.find((l) => l.op === "insert").values;
  for (const v of [set.labNotes, set.holdReason, ins.note]) {
    assert.notEqual(v, secret);
    assert.equal(decryptField(v), secret);
  }
  assert.equal(out.changed, true);
  assert.equal(out.order.labNotes, secret);
});

test("releaseRxCase: a claim that matches no row throws ALREADY_RELEASED and inserts nothing", async () => {
  const tx = fakeTx({ updates: [[]] });
  await assert.rejects(
    mod.releaseRxCase(tx, { caseRow: { id: "c1", status: "released" }, lines: [], byUserId: "u1" }),
    (e) => e instanceof LabOrderError && e.code === "ALREADY_RELEASED",
  );
  assert.deepEqual(tx.log.filter((l) => l.op === "insert" || l.op === "execute"), []);
});

test("createShopLabOrder: the order number is allocated under the lock and every event note is sealed", async () => {
  const tx = fakeTx({ selects: [[{ max: null }]] });
  const out = await mod.createShopLabOrder(tx, { orderId: "o1", clientUserId: null, quoteLines: [{ name: "Kit", qty: 1 }] });
  assert.ok(out.orderNumber >= 1);
  const inserts = tx.log.filter((l) => l.op === "insert");
  assert.equal(inserts.length, 3, "order, lines, events");
  for (const e of [].concat(inserts[2].values)) assert.ok(e.note == null || decryptField(e.note) !== e.note);
});

test("allocateOrderNumber takes the advisory lock before reading the max", async () => {
  const tx = fakeTx({ selects: [[{ max: 100050 }]] });
  const n = await mod.allocateOrderNumber(tx);
  assert.equal(n, 100051);
  const ops = tx.log.map((l) => l.op);
  assert.ok(ops.indexOf("execute") !== -1 && ops.indexOf("execute") < ops.indexOf("select"));
});
