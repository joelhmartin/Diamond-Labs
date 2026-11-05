import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
// The generic modules and the draft sync have their own tests; here only the seams are pinned.
const tags = vi.hoisted(() => ({ tagsFor: vi.fn(), applyTags: vi.fn() }));
const files = vi.hoisted(() => ({ relinkFiles: vi.fn() }));
const billing = vi.hoisted(() => ({ syncDraftLine: vi.fn(), voidForCancelledLabOrder: vi.fn() }));
vi.mock("../../modules/record-tags/index.js", async (orig) => ({ ...(await orig()), ...tags }));
vi.mock("../../modules/record-files/index.js", async (orig) => ({ ...(await orig()), ...files }));
vi.mock("../billing/invoices.service.js", async (orig) => ({ ...(await orig()), ...billing }));
beforeEach(() => {
  tags.tagsFor.mockReset().mockResolvedValue(new Map());
  tags.applyTags.mockReset().mockResolvedValue({ ok: true, failed: [] });
  files.relinkFiles.mockReset().mockResolvedValue(0);
  billing.syncDraftLine.mockReset().mockResolvedValue({ synced: true });
  billing.voidForCancelledLabOrder.mockReset().mockResolvedValue({ voided: true });
});

const { mergeOrders } = await import("./merge.service.js");
const { LabOrderError } = await import("./lab-order-rules.js");
const { sealOrder } = await import("./lab-order-crypto.js");
const { fakeTx, fakeDb } = await import("../../test/fake-tx.js");
const { InvoiceError } = await import("../billing/invoice-rules.js");
const { invoiceErrorReply } = await import("../billing/invoice-errors.js");

const row = (id, n, extra = {}) => sealOrder({
  id, orderNumber: n, source: "staff", sourceId: id, clientUserId: "doc1", status: "received", heldFrom: null,
  shipmentId: null, dueDate: null, rush: false, rushTier: null, isRemake: false, version: 3, patientName: "Jane Roe", ...extra,
});
const P = row("p", 100, { dueDate: "2026-11-20" });
const A = row("a", 101, { dueDate: "2026-11-12", patientName: " jane  ROE" });
const lines = [
  { id: "p0", labOrderId: "p", position: 0, variantId: "v1", name: "Guard", qty: 1, noteOnly: false },
  { id: "a0", labOrderId: "a", position: 0, variantId: "v2", name: "Splint", qty: 1, noteOnly: false },
];
const writes = (tx) => tx.log.filter((l) => ["insert", "update", "delete", "set"].includes(l.op));

test("stale version on any order refuses with nothing planned", async () => {
  const tx = fakeTx({ selects: [[A, P]] });
  await assert.rejects(
    mergeOrders({ primaryId: "p", otherIds: ["a"], versions: { p: 3, a: 2 }, byUserId: "s1" }, fakeDb(tx)),
    (e) => e instanceof LabOrderError && e.code === "STALE",
  );
  assert.deepEqual(writes(tx), []);
  assert.equal(tx.log.filter((l) => l.op === "select").length, 1, "nothing read past the orders: no patients, invoices or lines");
  // A version missing for one order is stale too.
  const tx2 = fakeTx({ selects: [[A, P]] });
  await assert.rejects(mergeOrders({ primaryId: "p", otherIds: ["a"], versions: { p: 3 } }, fakeDb(tx2)), (e) => e.code === "STALE");
  assert.deepEqual(writes(tx2), []);
});

test("an order that no longer exists refuses before anything is written", async () => {
  const tx = fakeTx({ selects: [[P]] });
  await assert.rejects(mergeOrders({ primaryId: "p", otherIds: ["a"], versions: { p: 3, a: 3 } }, fakeDb(tx)), (e) => e.code === "NOT_FOUND");
  assert.deepEqual(writes(tx), []);
});

const drafts = [{ labOrderId: "a", status: "draft" }, { labOrderId: "p", status: "draft" }];

test("a merge cancels the others, moves their lines onto the primary's draft, unions tags and relinks files", async () => {
  const tx = fakeTx({
    selects: [[A, P], drafts, lines],
    updates: [[{ ...P, version: 4, dueDate: "2026-11-12" }], [{ ...A, version: 4, status: "cancelled" }]],
  });
  tags.tagsFor.mockResolvedValue(new Map([
    ["p", [{ id: "t1", active: true }]],
    ["a", [{ id: "t1", active: true }, { id: "t2", active: true }, { id: "t3", active: false }]],
  ]));
  const out = await mergeOrders({ primaryId: "p", otherIds: ["a"], versions: { p: 3, a: 3 }, byUserId: "s1" }, fakeDb(tx));
  assert.deepEqual(out, { primary: { id: "p", orderNumber: 100, version: 4 }, merged: [{ id: "a", orderNumber: 101 }] });

  const sets = tx.log.filter((l) => l.op === "set").map((l) => l.values);
  assert.deepEqual([sets[0].dueDate, sets[0].version], ["2026-11-12", 4]);
  assert.deepEqual([sets[1].status, sets[1].mergedIntoOrderId], ["cancelled", "p"]);
  assert.deepEqual(sets[2], { labOrderId: "p", position: 1 }, "a's line moves after the primary's last position");
  assert.deepEqual(sets[3], { labOrderId: "p" }, "its materials and lots move with it");

  const events = tx.log.find((l) => l.op === "insert").values;
  assert.deepEqual(events.map((e) => [e.labOrderId, e.type]), [["p", "merge"], ["p", "due"], ["a", "status"]]);
  assert.ok(events.every((e) => !/jane|roe/i.test(JSON.stringify(e))), "no patient name in events");

  assert.deepEqual(billing.voidForCancelledLabOrder.mock.calls.map(([, a]) => a.labOrderId), ["a"], "only the merged-away draft is voided");
  assert.equal(billing.voidForCancelledLabOrder.mock.calls[0][0], tx, "directly in the merge's transaction (no savepoint)");
  const invoiceRead = tx.log.filter((l) => l.op === "select")[1];
  assert.ok(invoiceRead.calls.includes("for") && invoiceRead.calls.includes("orderBy"), "the invoices are row-locked in a fixed order");
  const [[, sync]] = billing.syncDraftLine.mock.calls;
  assert.deepEqual([sync.labOrder.id, sync.op, sync.line.id, sync.line.labOrderId], ["p", "add", "a0", "p"]);
  assert.deepEqual(files.relinkFiles.mock.calls.map(([, a]) => a), [{ fromType: "lab_order", fromId: "a", toType: "lab_order", toId: "p" }]);
});

test("tag labels are unioned onto the primary (only the active ones it lacks)", async () => {
  const tx = fakeTx({
    selects: [[A, P], [], lines],
    updates: [[{ ...P, version: 4 }], [{ ...A, version: 4, status: "cancelled" }]],
  });
  tags.tagsFor.mockResolvedValue(new Map([
    ["p", [{ id: "t1", active: true }]],
    ["a", [{ id: "t1", active: true }, { id: "t2", active: true }, { id: "t3", active: false }]],
  ]));
  await mergeOrders({ primaryId: "p", otherIds: ["a"], versions: { p: 3, a: 3 }, byUserId: "s1" }, fakeDb(tx));
  const [[args, database]] = tags.applyTags.mock.calls;
  assert.deepEqual([args.recordType, args.ids, args.add, args.remove, args.byUserId], ["lab_order", ["p"], ["t2"], [], "s1"]);
  assert.equal(database, tx, "in the merge's transaction");
  assert.deepEqual([...(await args.exists(["p", "x"]))], ["p"]);
});

test("a refusal (different practices) writes nothing", async () => {
  const tx = fakeTx({ selects: [[row("a", 101, { clientUserId: "doc2" }), P], [], lines] });
  await assert.rejects(
    mergeOrders({ primaryId: "p", otherIds: ["a"], versions: { p: 3, a: 3 } }, fakeDb(tx)),
    (e) => e.code === "INVALID" && /practice/.test(e.message),
  );
  assert.deepEqual(writes(tx), []);
});

test("a merged-away order whose invoice is no longer a draft at void time refuses (409 STALE) and writes nothing", async () => {
  const tx = fakeTx({ selects: [[A, P], drafts, lines] });
  billing.voidForCancelledLabOrder.mockResolvedValue({ voided: false }); // issued between the read and the void
  await assert.rejects(
    mergeOrders({ primaryId: "p", otherIds: ["a"], versions: { p: 3, a: 3 }, byUserId: "s1" }, fakeDb(tx)),
    (e) => e instanceof InvoiceError && e.code === "STALE" && invoiceErrorReply(e).status === 409,
  );
  assert.deepEqual(writes(tx), [], "no order cancelled, no line moved");
  assert.equal(billing.syncDraftLine.mock.calls.length, 0, "nothing added to the primary's draft");
  assert.equal(files.relinkFiles.mock.calls.length, 0);
});

test("an order with no invoice yet is not voided and the merge goes ahead", async () => {
  const tx = fakeTx({
    selects: [[A, P], [], lines],
    updates: [[{ ...P, version: 4 }], [{ ...A, version: 4, status: "cancelled" }]],
  });
  await mergeOrders({ primaryId: "p", otherIds: ["a"], versions: { p: 3, a: 3 }, byUserId: "s1" }, fakeDb(tx));
  assert.equal(billing.voidForCancelledLabOrder.mock.calls.length, 0);
});
