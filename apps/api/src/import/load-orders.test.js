process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeTx } from "../test/fake-tx.js";

const { loadOrders, reattachPlan } = await import("./load-orders.js");
const { ImportRefusal } = await import("./import-errors.js");
const { decryptField } = await import("../lib/crypto.js");
const load = (n) => JSON.parse(readFileSync(new URL(`../../test-fixtures/seazona/${n}`, import.meta.url), "utf8"));
const asRecords = (list) => list.map((p) => ({ seazonaId: p.id, payload: p }));
const known = load("orders.json").filter((o) => o.id !== "ord-4");
const rawWith = (orders) => ({ records: async (e) => ({ order: asRecords(orders), order_detail: asRecords(load("order-details.json")) })[e] ?? [] });
const doctor = (id, client, account) => ({
  id, seazonaClientId: client, seazonaAccountNumber: account, role: "doctor", approvalStatus: "approved", status: "active",
  emailVerifiedAt: new Date(0), hasPassword: true, createdAt: new Date(0),
});
const users = [doctor("u-1324", "c-1324", "1324"), doctor("u-2001", "c-2001", "2001")];
// Select order: seed counts (invoices, lab orders), owners, existing legacy orders, variants by code.
const db = (existing = [], owners = users) => fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], owners, existing, [{ id: "v-2608", code: "2608" }]] });
const lock = () => {
  const calls = [];
  return { calls, tryLock: async () => true, assertHeld: () => calls.push("assert"), close: async () => calls.push("close") };
};

test("live: orders sealed with the live sealer, lines linked to catalog variants by code, lock held", async () => {
  const tx = db();
  const l = lock();
  await loadOrders({ raw: rawWith(known), db: tx, live: true, target: "rehearsal", starts: {}, lock: l });
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  const orders = inserts.find((v) => v[0]?.source === "legacy");
  assert.equal(orders.length, 4);
  assert.ok(orders.every((o) => /^enc:v1:/.test(o.legacyPatient)));
  assert.equal(decryptField(orders.find((o) => o.sourceId === "ord-1").legacyPatient), "Test Patient B");
  const lines = inserts.find((v) => v[0]?.name === "DDSO Nylon");
  assert.equal(lines[0].variantId, "v-2608");
  assert.equal(lines[1].variantId, null);
  assert.ok(!JSON.stringify(inserts).includes("Test Patient"));
  assert.ok(l.calls.includes("assert") && l.calls.at(-1) === "close");
});

test("a live run needs the load lock and refuses when another load holds it", async () => {
  await assert.rejects(loadOrders({ raw: rawWith(known), db: db(), live: true, target: "rehearsal" }), TypeError);
  const held = { tryLock: async () => false, assertHeld() {}, close: async () => {} };
  await assert.rejects(loadOrders({ raw: rawWith(known), db: db(), live: true, target: "rehearsal", lock: held }), ImportRefusal);
});

test("a live run refuses while a Seazona state is unmapped; a dry run reports it and writes nothing", async () => {
  const tx = db();
  const dry = await loadOrders({ raw: rawWith(load("orders.json")), db: tx, live: false, target: "rehearsal", starts: {} });
  assert.ok(dry.problems.some((p) => p.kind === "unknown_status"));
  assert.equal(tx.log.some((e) => e.op === "insert" || e.op === "update"), false);
  await assert.rejects(loadOrders({ raw: rawWith(load("orders.json")), db: db(), live: true, target: "rehearsal", starts: {}, lock: lock() }), ImportRefusal);
});

test("a re-run skips orders already loaded", async () => {
  const existing = known.map((o) => ({ sourceId: o.id, number: Number(o.orderNumber), clientUserId: "u-x" }));
  const tx = db(existing);
  const report = await loadOrders({ raw: rawWith(known), db: tx, live: true, target: "rehearsal", starts: {}, lock: lock() });
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.equal(report.counts.alreadyLoaded, 4);
});

test("a client with two eligible doctors loads its orders unowned and is reported by client id", async () => {
  const tx = db([], [...users, doctor("u-2001b", "c-2001", "2001")]);
  const report = await loadOrders({ raw: rawWith(known), db: tx, live: true, target: "rehearsal", starts: {}, lock: lock() });
  const orders = tx.log.filter((e) => e.op === "insert").map((e) => e.values).find((v) => v[0]?.source === "legacy");
  assert.deepEqual(orders.filter((o) => o.clientUserId === null).map((o) => o.sourceId).sort(), ["ord-2", "ord-3"]);
  assert.deepEqual(report.problems.find((p) => p.kind === "client_has_multiple_owners").seazonaIds, ["c-2001"]);
});

test("every run reattaches loaded unowned orders once the client resolves to one owner (guarded, audited)", async () => {
  const existing = [{ sourceId: "ord-2", number: 97950, clientUserId: null }, { sourceId: "ord-1", number: 98000, clientUserId: "u-1324" }];
  const plan = reattachPlan(existing, asRecords(known), new Map([["c-2001", "u-2001"], ["c-1324", "u-1324"]]));
  assert.deepEqual([...plan], [["u-2001", ["ord-2"]]], "an order that already has an owner is never touched");

  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing, []], updates: [[{ id: "lo-2" }]] });
  const report = await loadOrders({ raw: rawWith(known), db: tx, live: true, target: "rehearsal", starts: {}, lock: lock() });
  assert.equal(report.counts.reattached, 1);
  const set = tx.log.find((e) => e.op === "set").values;
  assert.equal(set.clientUserId, "u-2001");
  const audit = tx.log.filter((e) => e.op === "insert").map((e) => e.values).find((v) => v.action === "import.legacy_orders_reattached");
  assert.deepEqual(audit.metadata, { ownerUserId: "u-2001", planned: 1, changed: 1, legacyOrderIds: ["ord-2"] });

  // The guard: if the row was owned meanwhile the update matches nothing, and nothing is claimed or audited.
  const raced = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing, []], updates: [[]] });
  const r2 = await loadOrders({ raw: rawWith(known), db: raced, live: true, target: "rehearsal", starts: {}, lock: lock() });
  assert.equal(r2.counts.reattached, 0);
  assert.equal(raced.log.some((e) => e.op === "insert" && e.values?.action), false);
});
