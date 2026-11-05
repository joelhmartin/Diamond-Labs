import { test } from "vitest";
import assert from "node:assert/strict";

process.env.PHI_ENCRYPTION_KEY ??= "a".repeat(64);
const { planLineChange, changeLines } = await import("./lab-order-lines.service.js");
const { LabOrderError } = await import("./lab-order-rules.js");
const { InvoiceError } = await import("../billing/invoice-rules.js");
const { decryptField } = await import("../../lib/crypto.js");
const { fakeTx } = await import("../../test/fake-tx.js");

const now = new Date("2026-11-06T15:00:00Z");
const order = (over = {}) => ({
  id: "lo1", orderNumber: 100001, status: "in_production", source: "staff", version: 3, isRemake: false, clientUserId: "doc1", ...over,
});
const benchLine = { id: "l0", labOrderId: "lo1", position: 0, variantId: "v0", code: "1000", name: "Night guard", arch: null, qty: 1, noteOnly: false };
const variant = { id: "v1", code: "2608", name: "DDSO Nylon", basePriceCents: 45000, taxable: false };
const opts = (over = {}) => ({ variant, lineId: "l-new", byUserId: "staff1", now, ...over });
const code = (c) => (e) => e instanceof LabOrderError && e.code === c;

// ── planLineChange (pure) ─────────────────────────────────────────────────

test("add: a catalog line at the end, named from the catalog, with a product-names-only event", () => {
  const p = planLineChange(order(), [benchLine], { op: "add", variantId: "v1", qty: 2, name: "ignored" }, opts());
  assert.deepEqual(p.lineOp.insert, {
    id: "l-new", labOrderId: "lo1", position: 1, variantId: "v1", code: "2608", name: "DDSO Nylon", arch: null, qty: 2, noteOnly: false, sourceLabel: null,
  });
  assert.deepEqual(p.patch, { version: 4, updatedAt: now });
  assert.deepEqual([p.event.type, p.event.note, p.event.byUserId, p.event.labOrderId], ["lines", "Added 2× DDSO Nylon", "staff1", "lo1"]);
  assert.deepEqual(p.sync, { op: "add", line: p.lineOp.insert });
});

test("update qty and remove: notes name the product only", () => {
  const q = planLineChange(order(), [benchLine], { op: "update", lineId: "l0", qty: 2 }, opts());
  assert.deepEqual(q.lineOp.update, { id: "l0", qty: 2 });
  assert.equal(q.event.note, "Qty Night guard 1→2");
  assert.deepEqual(q.sync, { op: "qty", line: { ...benchLine, qty: 2 } });
  assert.equal(planLineChange(order(), [benchLine], { op: "update", lineId: "l0", qty: 1 }, opts()), null, "same qty is no change");
  const r = planLineChange(order(), [benchLine], { op: "remove", lineId: "l0" }, opts());
  assert.equal(r.lineOp.delete, "l0");
  assert.equal(r.event.note, "Removed Night guard");
  assert.deepEqual(r.sync, { op: "remove", line: benchLine });
});

test("refuses legacy, shipped and cancelled orders, and keeps qty in 1–99", () => {
  const add = { op: "add", variantId: "v1", qty: 1 };
  assert.throws(() => planLineChange(order({ source: "legacy" }), [], add, opts()), code("INVALID"));
  assert.throws(() => planLineChange(order({ status: "shipped" }), [], add, opts()), code("INVALID"));
  assert.throws(() => planLineChange(order({ status: "cancelled" }), [], add, opts()), code("INVALID"));
  assert.throws(() => planLineChange(order(), [], { ...add, qty: 0 }, opts()), code("INVALID"));
  assert.throws(() => planLineChange(order(), [benchLine], { op: "update", lineId: "l0", qty: 100 }, opts()), code("INVALID"));
  assert.throws(() => planLineChange(order(), [], add, opts({ variant: null })), code("INVALID"));
  assert.throws(() => planLineChange(order(), [benchLine], { op: "remove", lineId: "nope" }, opts()), code("NOT_FOUND"));
});

// ── changeLines (service, fake transaction) ───────────────────────────────

const draftInvoice = { id: "inv1", invoiceNumber: 500001, status: "draft", version: 2, totalCents: 10000, labOrderId: "lo1" };
const invoiceLine = { id: "il0", invoiceId: "inv1", position: 0, kind: "item", labOrderLineId: "l0", description: "Night guard", qty: 1, unitCents: 10000, lineCents: 10000, taxable: false, priceSource: "base" };

// Reads in order: the order, its lines, then `rest` (the variant for an add, the locked invoice, pricing, the invoice's lines).
function harness({ orderRow = order(), rest = [] } = {}) {
  const tx = fakeTx({
    selects: [[orderRow], [benchLine], ...rest],
    updates: [[{ ...orderRow, version: orderRow.version + 1 }], [{ ...draftInvoice, version: draftInvoice.version + 1 }]],
  });
  let rolledBack = false;
  const database = {
    transaction: async (fn) => {
      try { return await fn(tx); } catch (err) { rolledBack = true; throw err; }
    },
  };
  return { tx, database, rolledBack: () => rolledBack };
}
const inserts = (tx) => tx.log.filter((l) => l.op === "insert").map((l) => l.values);

test("line add refuses when the draft is issued and writes nothing", async () => {
  const h = harness({ rest: [[variant], [{ ...draftInvoice, status: "issued" }]] });
  await assert.rejects(
    changeLines("lo1", { edit: { op: "add", variantId: "v1", qty: 1 }, expectedVersion: 3, byUserId: "staff1" }, h.database),
    (e) => e instanceof InvoiceError && e.code === "INVALID_TRANSITION" && e.message === "Invoice already issued — edit it with a credit.",
  );
  assert.equal(h.rolledBack(), true, "the refusal escapes the transaction, so the order bump and event roll back");
  assert.ok(!inserts(h.tx).some((v) => v && "labOrderLineId" in v), "no invoice line");
  assert.ok(!inserts(h.tx).some((v) => v && v.name === "DDSO Nylon"), "no lab order line");
  assert.equal(h.tx.log.filter((l) => l.op === "delete").length, 0);
});

test("remove deletes the invoice line linked by labOrderLineId", async () => {
  const h = harness({ rest: [[draftInvoice], [invoiceLine]] });
  await changeLines("lo1", { edit: { op: "remove", lineId: "l0" }, expectedVersion: 3, byUserId: "staff1" }, h.database);
  assert.equal(h.tx.log.filter((l) => l.op === "delete").length, 2, "the invoice line and the bench line");
  const invoicePatch = h.tx.log.filter((l) => l.op === "set")[1].values;
  assert.deepEqual([invoicePatch.totalCents, invoicePatch.version], [0, 3]);
  const event = inserts(h.tx).find((v) => v?.type === "lines");
  assert.equal(decryptField(event.note), "Removed Night guard");
  const audit = inserts(h.tx).find((v) => v?.action === "invoice.edited");
  assert.deepEqual(audit.metadata, { invoiceNumber: 500001, op: "remove", lineId: "il0", labOrderLineId: "l0" });
});

test("a remake order's added line is priced as remake", async () => {
  const h = harness({
    orderRow: order({ isRemake: true }),
    rest: [[variant], [draftInvoice], [variant], [{ variantId: "v1", priceCents: 40500 }], [], [invoiceLine]],
  });
  await changeLines("lo1", { edit: { op: "add", variantId: "v1", qty: 2 }, expectedVersion: 3, byUserId: "staff1" }, h.database);
  const added = inserts(h.tx).find((v) => v && "priceSource" in v);
  assert.deepEqual([added.unitCents, added.priceSource, added.qty, added.description], [0, "remake", 2, "DDSO Nylon"]);
  const bench = inserts(h.tx).find((v) => v?.name === "DDSO Nylon");
  assert.equal(bench.id, added.labOrderLineId, "the invoice line points at the new bench line");
});

test("a line added later to a 50% remake is priced at 50% off (ruling R6)", async () => {
  const reason = { id: "r1", appliesTo: "remake", label: "Change of occlusion", discountPercent: 50, active: true, position: 0 };
  const h = harness({
    orderRow: order({ isRemake: true, remakeReasonId: "r1" }),
    rest: [[variant], [draftInvoice], [variant], [{ variantId: "v1", priceCents: 40500 }], [], [reason], [invoiceLine]],
  });
  await changeLines("lo1", { edit: { op: "add", variantId: "v1", qty: 1 }, expectedVersion: 3, byUserId: "staff1" }, h.database);
  const added = inserts(h.tx).find((v) => v && "priceSource" in v);
  assert.deepEqual([added.unitCents, added.priceSource], [20250, "remake"]);
});

test("a note-only line is not billed: nothing is added to the invoice", async () => {
  const h = harness({ rest: [[variant]] });
  await changeLines("lo1", { edit: { op: "add", variantId: "v1", qty: 1, noteOnly: true }, expectedVersion: 3, byUserId: "staff1" }, h.database);
  assert.ok(!inserts(h.tx).some((v) => v && "labOrderLineId" in v), "no invoice line");
  assert.ok(inserts(h.tx).some((v) => v?.name === "DDSO Nylon" && v.noteOnly === true), "bench line written");
});

test("a bench remove that would leave a discount uncovered refuses and rolls the bench edit back", async () => {
  const discount = { id: "il-d", invoiceId: "inv1", position: 1, kind: "adjustment", labOrderLineId: null, description: "Courtesy", qty: 1, unitCents: -5000, lineCents: -5000, taxable: false, priceSource: "manual" };
  const h = harness({ rest: [[draftInvoice], [invoiceLine, discount]] });
  await assert.rejects(
    changeLines("lo1", { edit: { op: "remove", lineId: "l0" }, expectedVersion: 3, byUserId: "staff1" }, h.database),
    (e) => e instanceof InvoiceError && e.code === "INVALID" && e.message === "Remove the discount first.",
  );
  assert.equal(h.rolledBack(), true, "the order bump and event roll back with it");
  assert.equal(h.tx.log.filter((l) => l.op === "delete").length, 0, "neither the invoice line nor the bench line is deleted");
});
