import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
const source = readFileSync(fileURLToPath(new URL("./lab-orders.service.js", import.meta.url)), "utf8");
const mod = await import("./lab-orders.service.js");
const { LabOrderError } = await import("./lab-order-rules.js");
const { decryptField } = await import("../../lib/crypto.js");
const { fakeTx, fakeDb } = await import("../../test/fake-tx.js");

test("the service exposes what the routes, release and checkout call", () => {
  for (const name of [
    "allocateOrderNumber", "releaseRxCase", "createShopLabOrder", "listLabOrders", "getLabOrderDetail",
    "labOrdersForCases", "changeStatus", "changeField", "remakeOrder", "listAssignableStaff", "mutateIn",
  ]) assert.equal(typeof mod[name], "function", name);
});

test("every mutation is conditional on the version the caller saw (no lost updates)", () => {
  assert.match(source, /eq\(labOrders\.version, order\.version\)/);
  assert.match(source, /assertFresh\(/);
});

test("order numbers are allocated under a transaction-scoped advisory lock", () => {
  assert.match(source, /allocateSequenceNumber\(tx, \{\s*lockId: LAB_ORDER_NUMBER_LOCK/);
  assert.equal(mod.LAB_ORDER_NUMBER_LOCK, 7300421);
});

test("a release claims the case before inserting, so a double click can't make two jobs", () => {
  const body = source.slice(source.indexOf("export async function releaseRxCase"), source.indexOf("export async function createShopLabOrder"));
  assert.ok(body.indexOf('status: "released"') < body.indexOf("insertPlan("), "claim must precede the insert");
});

test("hold reasons, lab notes and event notes are sealed on write and opened on read", () => {
  assert.match(source, /SECRET_ORDER_FIELDS = \["holdReason", "labNotes", "legacyPatient"\]/);
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

test("allocateOrderNumber takes the advisory lock before reading the max", async () => {
  const tx = fakeTx({ selects: [[{ max: 100050 }]] });
  const n = await mod.allocateOrderNumber(tx);
  assert.equal(n, 100051);
  const ops = tx.log.map((l) => l.op);
  assert.ok(ops.indexOf("execute") !== -1 && ops.indexOf("execute") < ops.indexOf("select"));
});

test("build notes and the ticket banner share one rush source", async () => {
  const { compileNotesMulti } = await import("../rx/case-notes.js");
  const { rushFromCase } = await import("./lab-order-rules.js");
  const c = { rush: false, rushTier: null, formData: { rushCase: ["Yes"], rushChargeNylon: "Expedited" } };
  assert.doesNotMatch(compileNotesMulti(c, []), /RUSH/, "the raw column alone misses a live-form rush");
  assert.match(compileNotesMulti({ ...c, ...rushFromCase(c) }, []), /RUSH \(Expedited\)/);
  assert.match(source, /compileNotesMulti\(\{ \.\.\.c, \.\.\.rushFromCase\(c\) \}/);
});

test("releaseRxCase plans from the lines re-read after the claim, not a caller's copy", async () => {
  // The caller's pre-transaction copy would have passed; the stored lines now have an open one.
  const tx = fakeTx({ updates: [[{ id: "c1" }]], selects: [[{ status: "open", noteOnly: false, name: "Crown" }]] });
  await assert.rejects(
    mod.releaseRxCase(tx, { caseRow: { id: "c1", userId: "u1", status: "in_review", formData: {} }, lines: [{ status: "confirmed", noteOnly: false }], byUserId: "u1" }),
    (e) => e instanceof LabOrderError && e.code === "RELEASE_BLOCKED",
  );
  assert.equal(tx.log.filter((l) => l.op === "insert").length, 0);
  const body = source.slice(source.indexOf("export async function releaseRxCase"), source.indexOf("export async function createShopLabOrder"));
  assert.ok(body.indexOf("rxCaseLines") > body.indexOf('status: "released"'), "lines are read after the claim");
});

test("a search looks through shipped history; the board's shipped window only applies without one", () => {
  const body = source.slice(source.indexOf("function boardWhere"), source.indexOf("export const LIST_LIMIT") > 0 ? source.indexOf("export async function listLabOrders") : undefined);
  assert.match(body, /!f\.includeClosed && !f\.q/);
});

test("Admin > Orders is newest-received-first and says when the cap trimmed it; the board keeps rush/due order", () => {
  assert.equal(mod.LIST_LIMIT, 1000);
  assert.notDeepEqual(mod.listOrder({ includeClosed: true }), mod.listOrder({ includeClosed: false }));
  assert.equal(mod.listOrder({ includeClosed: true }).length, 2);
  assert.equal(mod.listOrder({}).length, 3);
  assert.match(source, /truncated: rows\.length >= LIST_LIMIT/);
  assert.match(source, /\.limit\(LIST_LIMIT\)/);
});

test("createShopLabOrder: the job and its paid shop invoice are written in one transaction", async () => {
  const tx = fakeTx({ selects: [[{ max: null }], [{ max: null }]] });
  const quote = {
    lines: [{ variantId: "v1", code: "61", name: "Kit", qty: 1, unitCents: 500, lineCents: 500, taxable: false, priceSource: "base" }],
    subtotalCents: 500, taxCents: 0, shippingCents: 1200, totalCents: 1700,
  };
  await mod.createShopLabOrder(tx, { orderId: "o1", clientUserId: null, quote, transactionId: "t1" });
  const ins = tx.log.filter((l) => l.op === "insert").map((l) => l.values);
  assert.equal(ins.length, 7, "lab order, lines, events, invoice, invoice lines, ledger row, audit");
  const events = [].concat(ins[2]);
  assert.deepEqual(events.map((e) => [e.type, e.to, typeof e.id]), [["release", "received", "string"]], "the job's release event is written, with an id");
  assert.equal(ins[5].source, "shop_card");
  assert.equal(ins[5].appliedCents, 1700);
});

test("mutate runs the plan's follow-up inside the transaction, with the updated order", async () => {
  const seen = [];
  const tx = fakeTx({ selects: [[baseRow]], updates: [[{ ...baseRow, version: 4, status: "shipped" }]] });
  const plan = () => ({
    patch: { status: "shipped", version: 4 },
    event: { labOrderId: "lo-1", type: "status", note: null, at: new Date() },
    after: async (t, order) => { seen.push([t === tx, order.status, order.version]); },
  });
  await mod.mutate("lo-1", 3, plan, fakeDb(tx));
  assert.deepEqual(seen, [[true, "shipped", 4]]);
});

test("billing follows the bench and never blocks it: ship issues, cancel voids, failures are logged", async () => {
  assert.equal(mod.billingFollowUp("in_production", "u1"), undefined);
  const errors = [];
  const original = console.error;
  console.error = (m) => errors.push(String(m));
  try {
    const failing = { transaction: async () => { throw new Error("db down"); } };
    await mod.billingFollowUp("shipped", "u1")(failing, { id: "lo-1", shippedAt: new Date() });
    await mod.billingFollowUp("cancelled", "u1")(failing, { id: "lo-1" });
  } finally {
    console.error = original;
  }
  assert.match(errors[0], /^\[BILLING\]\[ISSUE_FAILED\] labOrder=lo-1/);
  assert.match(errors[1], /^\[BILLING\]\[VOID_FAILED\] labOrder=lo-1/);
});

test("release and remake draft an invoice inside their transaction, after the job's lines exist", () => {
  const release = source.slice(source.indexOf("export async function releaseRxCase"), source.indexOf("export async function createShopLabOrder"));
  assert.ok(release.indexOf("insertPlan(") < release.indexOf("createDraftForLabOrder(tx,"), "release");
  const remake = source.slice(source.indexOf("export function remakeOrder"), source.indexOf("export function listAssignableStaff"));
  assert.ok(remake.indexOf("insertPlan(") < remake.indexOf("createDraftForLabOrder(tx,"), "remake");
  const shop = source.slice(source.indexOf("export async function createShopLabOrder"), source.indexOf("function boardWhere"));
  assert.match(shop, /createShopInvoice\(tx, \{ labOrderId: plan\.labOrder\.id, clientUserId, quote, transactionId \}\)/);
  assert.match(source, /tx\.transaction\(\(sp\) => step\(sp, order\)\)/, "billing runs in a savepoint");
});

test("mutateIn runs inside the caller's transaction; mutate is its one-line wrapper", () => {
  assert.equal(typeof mod.mutateIn, "function");
  assert.match(source, /export function mutate\(id, expectedVersion, plan, database = db\) \{\s*return database\.transaction\(\(tx\) => mutateIn\(tx, id, expectedVersion, plan\)\);/);
});

const notePlan = () => ({ patch: { version: 4 }, event: { labOrderId: "lo-1", type: "note", note: null, at: new Date() } });
const isStale = (e) => e instanceof LabOrderError && e.code === "STALE";

test("mutateIn: a system move (null version) skips the freshness check and applies when the conditional UPDATE matches", async () => {
  const tx = fakeTx({ selects: [[baseRow]], updates: [[{ ...baseRow, version: 4 }]] });
  const out = await mod.mutateIn(tx, "lo-1", null, notePlan);
  assert.equal(out.changed, true);
  assert.equal(out.order.version, 4);
  assert.equal(tx.log.filter((l) => l.op === "insert").length, 1, "the event was written");
});

test("mutateIn: a mismatched integer version is refused by the freshness check, before any write", async () => {
  const tx = fakeTx({ selects: [[baseRow]], updates: [[{ ...baseRow, version: 4 }]] });
  await assert.rejects(mod.mutateIn(tx, "lo-1", 2, notePlan), isStale);
  assert.equal(tx.log.filter((l) => l.op === "update" || l.op === "insert").length, 0);
});

test("mutateIn: even a system move can't lose an update (conditional UPDATE matching no row is STALE)", async () => {
  const tx = fakeTx({ selects: [[baseRow]], updates: [[]] });
  await assert.rejects(mod.mutateIn(tx, "lo-1", null, notePlan), isStale);
  assert.equal(tx.log.filter((l) => l.op === "insert").length, 0);
});

test("the order page's shipment block comes from the summary map (SUMMARY has no label image)", async () => {
  const { SUMMARY } = await import("../shipping/shipments.service.js");
  assert.equal("labelData" in SUMMARY, false);
  const body = source.slice(source.indexOf("export async function getLabOrderDetail"), source.indexOf("export async function labOrdersForCases"));
  assert.match(body, /shipmentSummaries\(\[order\.shipmentId\]\)/);
});

test("the doctor view's lab orders carry the current shipment's public facts only", () => {
  const body = source.slice(source.indexOf("export async function labOrdersForCases"), source.indexOf("export async function mutateIn"));
  assert.match(body, /leftJoin\(shipments, eq\(shipments\.id, labOrders\.shipmentId\)\)/);
  assert.doesNotMatch(body, /labelData|shipTo|chargeCents|trackingError/);
});
